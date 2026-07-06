//! 테이블 브라우징/편집용 파라미터 바인딩 쿼리.
//!
//! 프론트엔드가 문자열로 SQL을 조립해 execute_query로 보내던 경로를
//! 대체한다 — 식별자는 quote_ident, 값은 전부 플레이스홀더 바인딩.
//! PK 판정은 KEY_COLUMN_USAGE 조회로 백엔드가 흡수한다.

use mysql_async::prelude::*;
use mysql_async::{Params, Pool, TxOpts, Value};
use serde::Deserialize;

use super::connection::{collect_query_result, get_conn_timeout, register_active_query, QueryResult};
use super::sql_guard::quote_ident;

/// (컬럼명, JSON 값) 쌍 — 행 식별(WHERE)과 쓰기 값(SET/INSERT) 공용
#[derive(Debug, Clone, Deserialize)]
pub struct ColumnValue {
    pub column: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TableFilter {
    pub column: String,
    pub operator: String,
    #[serde(default)]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TableSort {
    pub column: String,
    pub direction: String,
}

const DEFAULT_FETCH_LIMIT: u32 = 1000;
// connection::MAX_RESULT_ROWS와 정합 — 그 이상 요청해도 결과가 잘린다
const MAX_FETCH_LIMIT: u32 = 5000;

const BINARY_OPERATORS: &[&str] = &["=", "!=", "<>", ">", "<", ">=", "<=", "LIKE"];
const UNARY_OPERATORS: &[&str] = &["IS NULL", "IS NOT NULL"];

/// 결과 그리드의 JSON 셀 값을 MySQL 파라미터로 변환한다.
///
/// `row_value_to_json`의 역방향 — 문자열은 바이트로 바인딩되어
/// MySQL이 컬럼 타입(DATETIME 등)으로 강제 변환한다.
fn json_to_mysql_value(v: &serde_json::Value) -> Result<Value, String> {
    match v {
        serde_json::Value::Null => Ok(Value::NULL),
        serde_json::Value::Bool(b) => Ok(Value::Int(i64::from(*b))),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(Value::Int(i))
            } else if let Some(u) = n.as_u64() {
                Ok(Value::UInt(u))
            } else if let Some(f) = n.as_f64() {
                Ok(Value::Double(f))
            } else {
                Err(format!("Unsupported number value: {}", n))
            }
        }
        serde_json::Value::String(s) => Ok(Value::Bytes(s.clone().into_bytes())),
        other => Err(format!(
            "Unsupported value type for SQL parameter: {}",
            other
        )),
    }
}

fn to_params(values: Vec<Value>) -> Params {
    if values.is_empty() {
        Params::Empty
    } else {
        Params::Positional(values)
    }
}

/// SELECT 문과 바인딩 파라미터를 조립한다 (테스트 가능하도록 분리).
fn build_select_sql(
    database: &str,
    table: &str,
    filter: Option<&TableFilter>,
    sort: Option<&TableSort>,
    limit: Option<u32>,
) -> Result<(String, Vec<Value>), String> {
    let mut sql = format!(
        "SELECT * FROM {}.{}",
        quote_ident(database),
        quote_ident(table)
    );
    let mut params: Vec<Value> = Vec::new();

    if let Some(f) = filter {
        let op = f.operator.trim().to_uppercase();
        if UNARY_OPERATORS.contains(&op.as_str()) {
            sql.push_str(&format!(" WHERE {} {}", quote_ident(&f.column), op));
        } else if BINARY_OPERATORS.contains(&op.as_str()) {
            let raw = f
                .value
                .clone()
                .ok_or_else(|| format!("Filter value is required for operator {}", op))?;
            let bound = if op == "LIKE" {
                format!("%{}%", raw)
            } else {
                raw
            };
            sql.push_str(&format!(" WHERE {} {} ?", quote_ident(&f.column), op));
            params.push(Value::Bytes(bound.into_bytes()));
        } else {
            return Err(format!("Unsupported filter operator: {}", f.operator));
        }
    }

    if let Some(s) = sort {
        let dir = match s.direction.to_lowercase().as_str() {
            "asc" => "ASC",
            "desc" => "DESC",
            other => return Err(format!("Unsupported sort direction: {}", other)),
        };
        sql.push_str(&format!(" ORDER BY {} {}", quote_ident(&s.column), dir));
    }

    let limit = limit.unwrap_or(DEFAULT_FETCH_LIMIT).min(MAX_FETCH_LIMIT);
    sql.push_str(&format!(" LIMIT {}", limit));

    Ok((sql, params))
}

/// PK가 있으면 PK 컬럼만, 없으면 전달된 모든 컬럼으로 WHERE를 만든다.
///
/// PK 컬럼이 `row`에 없으면 에러 — 잘못된 행을 매칭하느니 거부한다.
fn build_where_clause(
    pk_columns: &[String],
    row: &[ColumnValue],
) -> Result<(String, Vec<Value>), String> {
    let targets: Vec<&ColumnValue> = if pk_columns.is_empty() {
        row.iter().collect()
    } else {
        pk_columns
            .iter()
            .map(|pk| {
                row.iter()
                    .find(|cv| &cv.column == pk)
                    .ok_or_else(|| format!("Primary key column '{}' not present in row data", pk))
            })
            .collect::<Result<Vec<_>, String>>()?
    };

    if targets.is_empty() {
        return Err("Cannot build WHERE clause: no identifying columns".to_string());
    }

    let mut conditions = Vec::with_capacity(targets.len());
    let mut params = Vec::new();
    for cv in targets {
        if cv.value.is_null() {
            conditions.push(format!("{} IS NULL", quote_ident(&cv.column)));
        } else {
            conditions.push(format!("{} = ?", quote_ident(&cv.column)));
            params.push(json_to_mysql_value(&cv.value)?);
        }
    }

    Ok((conditions.join(" AND "), params))
}

/// 테이블의 PRIMARY KEY 컬럼 목록 (순서 보존)
pub async fn get_primary_key_columns(
    pool: &Pool,
    database: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let mut conn = get_conn_timeout(pool).await?;

    conn.exec(
        r#"SELECT CAST(COLUMN_NAME AS CHAR)
           FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
           ORDER BY ORDINAL_POSITION"#,
        (database, table),
    )
    .await
    .map_err(|e| format!("Failed to get primary key columns: {}", e))
}

/// 필터/정렬/상한이 적용된 테이블 내용 조회
pub async fn fetch_table_rows(
    pool: &Pool,
    database: &str,
    table: &str,
    filter: Option<&TableFilter>,
    sort: Option<&TableSort>,
    limit: Option<u32>,
    cancel_key: Option<&str>,
) -> Result<QueryResult, String> {
    let (sql, params) = build_select_sql(database, table, filter, sort, limit)?;

    let start = std::time::Instant::now();
    let mut conn = get_conn_timeout(pool).await?;
    let _cancel_guard = cancel_key.map(|key| register_active_query(key, conn.id()));

    let result = conn
        .exec_iter(sql, to_params(params))
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    collect_query_result(result, start).await
}

/// 단일 셀 UPDATE (PK 기반 WHERE + LIMIT 1)
pub async fn update_table_cell(
    pool: &Pool,
    database: &str,
    table: &str,
    column: &str,
    value: &serde_json::Value,
    row: &[ColumnValue],
) -> Result<u64, String> {
    let pk_columns = get_primary_key_columns(pool, database, table).await?;
    let (where_sql, where_params) = build_where_clause(&pk_columns, row)?;

    let sql = format!(
        "UPDATE {}.{} SET {} = ? WHERE {} LIMIT 1",
        quote_ident(database),
        quote_ident(table),
        quote_ident(column),
        where_sql
    );

    let mut params = vec![json_to_mysql_value(value)?];
    params.extend(where_params);

    let mut conn = get_conn_timeout(pool).await?;
    conn.exec_drop(sql, to_params(params))
        .await
        .map_err(|e| format!("Update failed: {}", e))?;

    Ok(conn.affected_rows())
}

/// 행 INSERT — null 값은 명시적 NULL로 바인딩
pub async fn insert_table_row(
    pool: &Pool,
    database: &str,
    table: &str,
    values: &[ColumnValue],
) -> Result<u64, String> {
    if values.is_empty() {
        return Err("No values to insert".to_string());
    }

    let columns = values
        .iter()
        .map(|cv| quote_ident(&cv.column))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = vec!["?"; values.len()].join(", ");
    let sql = format!(
        "INSERT INTO {}.{} ({}) VALUES ({})",
        quote_ident(database),
        quote_ident(table),
        columns,
        placeholders
    );

    let params = values
        .iter()
        .map(|cv| json_to_mysql_value(&cv.value))
        .collect::<Result<Vec<_>, _>>()?;

    let mut conn = get_conn_timeout(pool).await?;
    conn.exec_drop(sql, to_params(params))
        .await
        .map_err(|e| format!("Insert failed: {}", e))?;

    Ok(conn.affected_rows())
}

/// 여러 행 삭제 — 행별 DELETE ... LIMIT 1을 단일 트랜잭션으로.
///
/// 어느 한 행이라도 실패하면 전체 롤백된다 (부분 삭제 없음).
pub async fn delete_table_rows(
    pool: &Pool,
    database: &str,
    table: &str,
    rows: &[Vec<ColumnValue>],
) -> Result<u64, String> {
    if rows.is_empty() {
        return Ok(0);
    }

    let pk_columns = get_primary_key_columns(pool, database, table).await?;

    let mut conn = get_conn_timeout(pool).await?;
    let mut tx = conn
        .start_transaction(TxOpts::default())
        .await
        .map_err(|e| format!("Failed to start transaction: {}", e))?;

    let mut deleted = 0u64;
    for row in rows {
        // 에러 시 tx가 drop되며 자동 롤백
        let (where_sql, params) = build_where_clause(&pk_columns, row)?;
        let sql = format!(
            "DELETE FROM {}.{} WHERE {} LIMIT 1",
            quote_ident(database),
            quote_ident(table),
            where_sql
        );
        tx.exec_drop(sql, to_params(params))
            .await
            .map_err(|e| format!("Delete failed: {}", e))?;
        deleted += tx.affected_rows();
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit deletes: {}", e))?;

    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cv(column: &str, value: serde_json::Value) -> ColumnValue {
        ColumnValue {
            column: column.to_string(),
            value,
        }
    }

    #[test]
    fn test_json_to_mysql_value() {
        assert_eq!(json_to_mysql_value(&json!(null)).unwrap(), Value::NULL);
        assert_eq!(json_to_mysql_value(&json!(true)).unwrap(), Value::Int(1));
        assert_eq!(json_to_mysql_value(&json!(42)).unwrap(), Value::Int(42));
        assert_eq!(
            json_to_mysql_value(&json!(1.5)).unwrap(),
            Value::Double(1.5)
        );
        assert_eq!(
            json_to_mysql_value(&json!("a'b")).unwrap(),
            Value::Bytes(b"a'b".to_vec())
        );
        assert!(json_to_mysql_value(&json!([1, 2])).is_err());
    }

    #[test]
    fn test_build_select_sql_plain() {
        let (sql, params) = build_select_sql("db", "users", None, None, None).unwrap();
        assert_eq!(sql, "SELECT * FROM `db`.`users` LIMIT 1000");
        assert!(params.is_empty());
    }

    #[test]
    fn test_build_select_sql_filter_and_sort() {
        let filter = TableFilter {
            column: "name".into(),
            operator: "LIKE".into(),
            value: Some("kim".into()),
        };
        let sort = TableSort {
            column: "id".into(),
            direction: "desc".into(),
        };
        let (sql, params) =
            build_select_sql("db", "users", Some(&filter), Some(&sort), Some(500)).unwrap();
        assert_eq!(
            sql,
            "SELECT * FROM `db`.`users` WHERE `name` LIKE ? ORDER BY `id` DESC LIMIT 500"
        );
        assert_eq!(params, vec![Value::Bytes(b"%kim%".to_vec())]);
    }

    #[test]
    fn test_build_select_sql_unary_operator() {
        let filter = TableFilter {
            column: "deleted_at".into(),
            operator: "IS NULL".into(),
            value: None,
        };
        let (sql, params) = build_select_sql("db", "t", Some(&filter), None, None).unwrap();
        assert_eq!(
            sql,
            "SELECT * FROM `db`.`t` WHERE `deleted_at` IS NULL LIMIT 1000"
        );
        assert!(params.is_empty());
    }

    #[test]
    fn test_build_select_sql_rejects_bad_operator_and_direction() {
        let filter = TableFilter {
            column: "a".into(),
            operator: "= 1 OR 1=1 --".into(),
            value: Some("x".into()),
        };
        assert!(build_select_sql("db", "t", Some(&filter), None, None).is_err());

        let sort = TableSort {
            column: "a".into(),
            direction: "desc; DROP TABLE t".into(),
        };
        assert!(build_select_sql("db", "t", None, Some(&sort), None).is_err());
    }

    #[test]
    fn test_build_select_sql_caps_limit() {
        let (sql, _) = build_select_sql("db", "t", None, None, Some(999_999)).unwrap();
        assert!(sql.ends_with("LIMIT 5000"));
    }

    #[test]
    fn test_build_where_uses_pk_only() {
        let pk = vec!["id".to_string()];
        let row = vec![cv("id", json!(7)), cv("name", json!("kim"))];
        let (sql, params) = build_where_clause(&pk, &row).unwrap();
        assert_eq!(sql, "`id` = ?");
        assert_eq!(params, vec![Value::Int(7)]);
    }

    #[test]
    fn test_build_where_falls_back_to_all_columns() {
        let row = vec![cv("a", json!(1)), cv("b", json!(null))];
        let (sql, params) = build_where_clause(&[], &row).unwrap();
        assert_eq!(sql, "`a` = ? AND `b` IS NULL");
        assert_eq!(params, vec![Value::Int(1)]);
    }

    #[test]
    fn test_build_where_missing_pk_column_errors() {
        let pk = vec!["id".to_string()];
        let row = vec![cv("name", json!("kim"))];
        assert!(build_where_clause(&pk, &row).is_err());
    }

    #[test]
    fn test_build_where_empty_row_errors() {
        assert!(build_where_clause(&[], &[]).is_err());
    }
}
