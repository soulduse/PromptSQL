use mysql_async::prelude::*;
use mysql_async::{Opts, Pool, Row, Value, consts::ColumnType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Convert MySQL ColumnType enum to short, readable type name
fn column_type_to_short_name(ct: ColumnType) -> &'static str {
    match ct {
        ColumnType::MYSQL_TYPE_DECIMAL => "decimal",
        ColumnType::MYSQL_TYPE_TINY => "tinyint",
        ColumnType::MYSQL_TYPE_SHORT => "smallint",
        ColumnType::MYSQL_TYPE_LONG => "int",
        ColumnType::MYSQL_TYPE_FLOAT => "float",
        ColumnType::MYSQL_TYPE_DOUBLE => "double",
        ColumnType::MYSQL_TYPE_NULL => "null",
        ColumnType::MYSQL_TYPE_TIMESTAMP => "timestamp",
        ColumnType::MYSQL_TYPE_LONGLONG => "bigint",
        ColumnType::MYSQL_TYPE_INT24 => "mediumint",
        ColumnType::MYSQL_TYPE_DATE => "date",
        ColumnType::MYSQL_TYPE_TIME => "time",
        ColumnType::MYSQL_TYPE_DATETIME => "datetime",
        ColumnType::MYSQL_TYPE_YEAR => "year",
        ColumnType::MYSQL_TYPE_NEWDATE => "date",
        ColumnType::MYSQL_TYPE_VARCHAR => "varchar",
        ColumnType::MYSQL_TYPE_BIT => "bit",
        ColumnType::MYSQL_TYPE_TIMESTAMP2 => "timestamp",
        ColumnType::MYSQL_TYPE_DATETIME2 => "datetime",
        ColumnType::MYSQL_TYPE_TIME2 => "time",
        ColumnType::MYSQL_TYPE_JSON => "json",
        ColumnType::MYSQL_TYPE_NEWDECIMAL => "decimal",
        ColumnType::MYSQL_TYPE_ENUM => "enum",
        ColumnType::MYSQL_TYPE_SET => "set",
        ColumnType::MYSQL_TYPE_TINY_BLOB => "tinyblob",
        ColumnType::MYSQL_TYPE_MEDIUM_BLOB => "mediumblob",
        ColumnType::MYSQL_TYPE_LONG_BLOB => "longblob",
        ColumnType::MYSQL_TYPE_BLOB => "blob",
        ColumnType::MYSQL_TYPE_VAR_STRING => "varchar",
        ColumnType::MYSQL_TYPE_STRING => "char",
        ColumnType::MYSQL_TYPE_GEOMETRY => "geometry",
        _ => "unknown",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConnectionResult {
    pub success: bool,
    pub message: String,
    pub connection_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub column_types: Vec<String>,
    pub column_tables: Vec<String>,      // Original table name for each column
    pub column_org_names: Vec<String>,   // Original column name for each column
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected_rows: u64,
    pub execution_time_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct TableInfo {
    pub name: String,
    pub columns: Vec<ColumnInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub field: String,
    pub column_type: String,
    pub is_nullable: String,
    pub key: String,
    pub default_value: Option<String>,
    pub extra: String,
    pub character_set: Option<String>,
    pub collation: Option<String>,
    pub column_comment: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TableDetailInfo {
    pub created: Option<String>,
    pub updated: Option<String>,
    pub engine: Option<String>,
    pub rows: u64,
    pub row_format: Option<String>,
    pub avg_row_length: u64,
    pub data_length: u64,
    pub max_data_length: u64,
    pub index_length: u64,
    pub data_free: u64,
    pub table_collation: Option<String>,
    pub character_set: Option<String>,
    pub auto_increment: Option<u64>,
    pub table_comment: Option<String>,
    pub index_count: u32,
    pub column_count: u32,
}

#[derive(Debug, Serialize)]
pub struct TableSummary {
    pub rows: u64,
    pub data_length: u64,
    pub index_length: u64,
    pub engine: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct IndexInfo {
    pub non_unique: bool,
    pub key_name: String,
    pub seq_in_index: u32,
    pub column_name: String,
    pub collation: Option<String>,
    pub cardinality: Option<u64>,
    pub sub_part: Option<u32>,
    pub packed: Option<String>,
    pub index_comment: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateColumnRequest {
    pub column_name: String,
    pub new_column_name: Option<String>,
    pub column_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
}

pub struct ConnectionManager {
    pools: HashMap<String, Pool>,
    configs: HashMap<String, ConnectionConfig>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            pools: HashMap::new(),
            configs: HashMap::new(),
        }
    }

    pub fn get_pool(&self, id: &str) -> Option<&Pool> {
        self.pools.get(id)
    }

    pub fn get_config(&self, id: &str) -> Option<&ConnectionConfig> {
        self.configs.get(id)
    }

    pub async fn test_connection(&self, config: &ConnectionConfig) -> ConnectionResult {
        let opts = build_opts(config);

        match Pool::new(opts) {
            pool => {
                match pool.get_conn().await {
                    Ok(mut conn) => {
                        match conn.query_drop("SELECT 1").await {
                            Ok(_) => {
                                drop(conn);
                                pool.disconnect().await.ok();
                                ConnectionResult {
                                    success: true,
                                    message: "Connection successful!".to_string(),
                                    connection_id: None,
                                }
                            }
                            Err(e) => {
                                pool.disconnect().await.ok();
                                ConnectionResult {
                                    success: false,
                                    message: format!("Query test failed: {}", e),
                                    connection_id: None,
                                }
                            }
                        }
                    }
                    Err(e) => {
                        pool.disconnect().await.ok();
                        ConnectionResult {
                            success: false,
                            message: format!("Connection failed: {}", e),
                            connection_id: None,
                        }
                    }
                }
            }
        }
    }

    pub async fn connect(&mut self, id: String, config: &ConnectionConfig) -> ConnectionResult {
        let opts = build_opts(config);

        let pool = Pool::new(opts);

        // Test connection
        match pool.get_conn().await {
            Ok(conn) => {
                drop(conn);
                self.pools.insert(id.clone(), pool);
                self.configs.insert(id.clone(), config.clone());
                ConnectionResult {
                    success: true,
                    message: "Connected successfully!".to_string(),
                    connection_id: Some(id),
                }
            }
            Err(e) => {
                pool.disconnect().await.ok();
                ConnectionResult {
                    success: false,
                    message: format!("Connection failed: {}", e),
                    connection_id: None,
                }
            }
        }
    }

    pub async fn disconnect(&mut self, id: &str) -> bool {
        if let Some(pool) = self.pools.remove(id) {
            self.configs.remove(id);
            pool.disconnect().await.ok();
            true
        } else {
            false
        }
    }

    pub async fn execute_query(&self, id: &str, database: Option<&str>, query: &str) -> Result<QueryResult, String> {
        let pool = self.pools.get(id).ok_or("Connection not found")?;
        execute_query_impl(pool, database, query).await
    }

    pub async fn get_databases(&self, id: &str) -> Result<Vec<String>, String> {
        let pool = self.pools.get(id).ok_or("Connection not found")?;

        let mut conn = pool.get_conn().await.map_err(|e| format!("Failed to get connection: {}", e))?;

        let databases: Vec<String> = conn
            .query("SELECT CAST(SCHEMA_NAME AS CHAR) FROM INFORMATION_SCHEMA.SCHEMATA ORDER BY SCHEMA_NAME")
            .await
            .map_err(|e| format!("Failed to get databases: {}", e))?;

        Ok(databases)
    }

    pub async fn get_tables(&self, id: &str, database: &str) -> Result<Vec<String>, String> {
        let pool = self.pools.get(id).ok_or("Connection not found")?;

        let mut conn = pool.get_conn().await.map_err(|e| format!("Failed to get connection: {}", e))?;

        let query = format!(
            "SELECT CAST(TABLE_NAME AS CHAR) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '{}' ORDER BY TABLE_NAME",
            escape_string(database)
        );
        let tables: Vec<String> = conn
            .query(&query)
            .await
            .map_err(|e| format!("Failed to get tables: {}", e))?;

        Ok(tables)
    }

    pub async fn get_table_schema(&self, id: &str, database: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
        let pool = self.pools.get(id).ok_or("Connection not found")?;

        let mut conn = pool.get_conn().await.map_err(|e| format!("Failed to get connection: {}", e))?;

        let query = format!(
            r#"SELECT
                CAST(COLUMN_NAME AS CHAR) as field,
                CAST(COLUMN_TYPE AS CHAR) as column_type,
                CAST(IS_NULLABLE AS CHAR) as is_nullable,
                CAST(IFNULL(COLUMN_KEY, '') AS CHAR) as `key`,
                COLUMN_DEFAULT as default_value,
                CAST(IFNULL(EXTRA, '') AS CHAR) as extra,
                CAST(CHARACTER_SET_NAME AS CHAR) as character_set,
                CAST(COLLATION_NAME AS CHAR) as collation,
                CAST(COLUMN_COMMENT AS CHAR) as column_comment
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'
            ORDER BY ORDINAL_POSITION"#,
            escape_string(database), escape_string(table)
        );

        let rows: Vec<Row> = conn.query(&query).await
            .map_err(|e| format!("Failed to get table schema: {}", e))?;

        let columns: Vec<ColumnInfo> = rows
            .iter()
            .map(|row| ColumnInfo {
                field: row.get::<String, _>("field").unwrap_or_default(),
                column_type: row.get::<String, _>("column_type").unwrap_or_default(),
                is_nullable: row.get::<String, _>("is_nullable").unwrap_or_default(),
                key: row.get::<String, _>("key").unwrap_or_default(),
                default_value: row.get::<Option<String>, _>("default_value").unwrap_or(None),
                extra: row.get::<String, _>("extra").unwrap_or_default(),
                character_set: row.get::<Option<String>, _>("character_set").unwrap_or(None),
                collation: row.get::<Option<String>, _>("collation").unwrap_or(None),
                column_comment: row.get::<Option<String>, _>("column_comment").unwrap_or(None),
            })
            .collect();

        Ok(columns)
    }

    pub async fn get_table_detail_info(&self, id: &str, database: &str, table: &str) -> Result<TableDetailInfo, String> {
        let pool = self.pools.get(id).ok_or("Connection not found")?;

        let mut conn = pool.get_conn().await.map_err(|e| format!("Failed to get connection: {}", e))?;

        let query = format!(
            r#"SELECT
                CAST(CREATE_TIME AS CHAR) as created,
                CAST(UPDATE_TIME AS CHAR) as updated,
                CAST(ENGINE AS CHAR) as engine,
                TABLE_ROWS as rows_count,
                CAST(ROW_FORMAT AS CHAR) as row_format,
                AVG_ROW_LENGTH as avg_row_length,
                DATA_LENGTH as data_length,
                MAX_DATA_LENGTH as max_data_length,
                INDEX_LENGTH as index_length,
                DATA_FREE as data_free,
                CAST(TABLE_COLLATION AS CHAR) as table_collation,
                AUTO_INCREMENT as auto_increment,
                CAST(TABLE_COMMENT AS CHAR) as table_comment
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'"#,
            escape_string(database), escape_string(table)
        );

        let row: Row = conn.query_first(&query).await
            .map_err(|e| format!("Failed to get table info: {}", e))?
            .ok_or("Table not found")?;

        // Get column count
        let column_count_query = format!(
            "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'",
            escape_string(database), escape_string(table)
        );
        let column_count: i64 = conn.query_first(&column_count_query).await
            .map_err(|e| format!("Failed to get column count: {}", e))?
            .unwrap_or(0);

        // Get index count
        let index_count_query = format!(
            "SELECT COUNT(DISTINCT INDEX_NAME) as cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'",
            escape_string(database), escape_string(table)
        );
        let index_count: i64 = conn.query_first(&index_count_query).await
            .map_err(|e| format!("Failed to get index count: {}", e))?
            .unwrap_or(0);

        let table_collation: Option<String> = row.get("table_collation").unwrap_or(None);
        let character_set = table_collation.as_ref().and_then(|c| c.split('_').next().map(String::from));

        Ok(TableDetailInfo {
            created: row.get("created").unwrap_or(None),
            updated: row.get("updated").unwrap_or(None),
            engine: row.get("engine").unwrap_or(None),
            rows: row.get::<Option<u64>, _>("rows_count").unwrap_or(None).unwrap_or(0),
            row_format: row.get("row_format").unwrap_or(None),
            avg_row_length: row.get::<Option<u64>, _>("avg_row_length").unwrap_or(None).unwrap_or(0),
            data_length: row.get::<Option<u64>, _>("data_length").unwrap_or(None).unwrap_or(0),
            max_data_length: row.get::<Option<u64>, _>("max_data_length").unwrap_or(None).unwrap_or(0),
            index_length: row.get::<Option<u64>, _>("index_length").unwrap_or(None).unwrap_or(0),
            data_free: row.get::<Option<u64>, _>("data_free").unwrap_or(None).unwrap_or(0),
            table_collation,
            character_set,
            auto_increment: row.get("auto_increment").unwrap_or(None),
            table_comment: row.get("table_comment").unwrap_or(None),
            index_count: index_count as u32,
            column_count: column_count as u32,
        })
    }

    pub async fn get_table_indexes(&self, id: &str, database: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let pool = self.pools.get(id).ok_or("Connection not found")?;

        let mut conn = pool.get_conn().await.map_err(|e| format!("Failed to get connection: {}", e))?;

        let query = format!(
            r#"SELECT
                NON_UNIQUE as non_unique,
                CAST(INDEX_NAME AS CHAR) as key_name,
                SEQ_IN_INDEX as seq_in_index,
                CAST(COLUMN_NAME AS CHAR) as column_name,
                CAST(COLLATION AS CHAR) as collation,
                CARDINALITY as cardinality,
                SUB_PART as sub_part,
                CAST(PACKED AS CHAR) as packed,
                CAST(INDEX_COMMENT AS CHAR) as index_comment
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'
            ORDER BY INDEX_NAME, SEQ_IN_INDEX"#,
            escape_string(database), escape_string(table)
        );

        let rows: Vec<Row> = conn.query(&query).await
            .map_err(|e| format!("Failed to get table indexes: {}", e))?;

        let indexes: Vec<IndexInfo> = rows
            .iter()
            .map(|row| IndexInfo {
                non_unique: row.get::<i64, _>("non_unique").unwrap_or(1) != 0,
                key_name: row.get::<String, _>("key_name").unwrap_or_default(),
                seq_in_index: row.get::<u32, _>("seq_in_index").unwrap_or(1),
                column_name: row.get::<String, _>("column_name").unwrap_or_default(),
                collation: row.get("collation").unwrap_or(None),
                cardinality: row.get("cardinality").unwrap_or(None),
                sub_part: row.get("sub_part").unwrap_or(None),
                packed: row.get("packed").unwrap_or(None),
                index_comment: row.get("index_comment").unwrap_or(None),
            })
            .collect();

        Ok(indexes)
    }

    pub async fn get_create_table(&self, id: &str, database: &str, table: &str) -> Result<String, String> {
        let pool = self.pools.get(id).ok_or("Connection not found")?;

        let mut conn = pool.get_conn().await.map_err(|e| format!("Failed to get connection: {}", e))?;

        let query = format!("SHOW CREATE TABLE `{}`.`{}`", database, table);
        let row: Row = conn.query_first(&query).await
            .map_err(|e| format!("Failed to get CREATE TABLE: {}", e))?
            .ok_or("Table not found")?;

        // The second column contains the CREATE TABLE statement
        let create_sql: String = row.get(1).ok_or("Failed to extract CREATE TABLE")?;

        Ok(create_sql)
    }

    pub async fn get_table_summary(&self, id: &str, database: &str, table: &str) -> Result<TableSummary, String> {
        let pool = self.pools.get(id).ok_or("Connection not found")?;

        let mut conn = pool.get_conn().await.map_err(|e| format!("Failed to get connection: {}", e))?;

        let query = format!(
            r#"SELECT
                TABLE_ROWS as rows_count,
                DATA_LENGTH as data_length,
                INDEX_LENGTH as index_length,
                CAST(ENGINE AS CHAR) as engine
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'"#,
            escape_string(database), escape_string(table)
        );

        let row: Row = conn.query_first(&query).await
            .map_err(|e| format!("Failed to get table summary: {}", e))?
            .ok_or("Table not found")?;

        Ok(TableSummary {
            rows: row.get::<Option<u64>, _>("rows_count").unwrap_or(None).unwrap_or(0),
            data_length: row.get::<Option<u64>, _>("data_length").unwrap_or(None).unwrap_or(0),
            index_length: row.get::<Option<u64>, _>("index_length").unwrap_or(None).unwrap_or(0),
            engine: row.get("engine").unwrap_or(None),
        })
    }

    pub async fn update_column(
        &self,
        id: &str,
        database: &str,
        table: &str,
        request: &UpdateColumnRequest,
    ) -> Result<(), String> {
        let pool = self.pools.get(id).ok_or("Connection not found")?;

        let mut conn = pool.get_conn().await.map_err(|e| format!("Failed to get connection: {}", e))?;

        let sql = generate_alter_column_sql(database, table, request);

        conn.query_drop(&sql).await
            .map_err(|e| format!("Failed to update column: {}", e))?;

        Ok(())
    }

    pub async fn cancel_query(&self, id: &str) -> Result<u32, String> {
        let pool = self.pools.get(id).ok_or("Connection not found")?;
        cancel_query_impl(pool).await
    }
}

/// Cancel running queries on a pool (standalone function that doesn't require manager lock)
pub async fn cancel_query_on_pool(pool: &Pool) -> Result<u32, String> {
    cancel_query_impl(pool).await
}

async fn cancel_query_impl(pool: &Pool) -> Result<u32, String> {
    let mut conn = pool.get_conn().await.map_err(|e| format!("Failed to get connection: {}", e))?;

    let rows: Vec<Row> = conn.query(
        r#"SELECT ID, TIME, INFO
           FROM INFORMATION_SCHEMA.PROCESSLIST
           WHERE COMMAND IN ('Query', 'Execute')
           AND INFO IS NOT NULL
           AND INFO NOT LIKE '%INFORMATION_SCHEMA.PROCESSLIST%'
           ORDER BY TIME DESC"#
    ).await.map_err(|e| format!("Failed to get process list: {}", e))?;

    let mut killed_count = 0u32;

    for row in rows {
        let process_id: u64 = row.get("ID").unwrap_or(0);

        if process_id > 0 {
            let kill_sql = format!("KILL QUERY {}", process_id);
            if conn.query_drop(&kill_sql).await.is_ok() {
                killed_count += 1;
            }
        }
    }

    Ok(killed_count)
}

/// Execute query on a pool (standalone function that doesn't require manager lock)
pub async fn execute_query_on_pool(
    pool: &Pool,
    database: Option<&str>,
    query: &str,
) -> Result<QueryResult, String> {
    execute_query_impl(pool, database, query).await
}

async fn execute_query_impl(
    pool: &Pool,
    database: Option<&str>,
    query: &str,
) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();

    let mut conn = pool.get_conn().await
        .map_err(|e| format!("Failed to acquire connection: {}", e))?;

    // Execute USE database
    if let Some(db) = database {
        conn.query_drop(format!("USE `{}`", db)).await
            .map_err(|e| format!("Failed to select database: {}", e))?;
    }

    // Check if it's a SELECT query (strip leading comments first)
    let stripped = strip_leading_sql_comments(query);
    let trimmed = stripped.to_uppercase();
    if trimmed.starts_with("SELECT")
        || trimmed.starts_with("SHOW")
        || trimmed.starts_with("DESCRIBE")
        || trimmed.starts_with("EXPLAIN")
    {
        // Execute query and get result with metadata
        let mut result = conn.query_iter(query).await
            .map_err(|e| format!("Query failed: {}", e))?;

        // Get column metadata BEFORE consuming rows
        let columns_meta: Vec<_> = result.columns_ref().iter().map(|c| {
            (
                c.name_str().to_string(),
                column_type_to_short_name(c.column_type()).to_string(),
                c.org_table_str().to_string(),  // Original table name!
                c.org_name_str().to_string(),   // Original column name!
            )
        }).collect();

        // Now collect rows
        let rows: Vec<Row> = result.collect().await
            .map_err(|e| format!("Failed to collect rows: {}", e))?;

        let execution_time_ms = start.elapsed().as_millis() as u64;

        if rows.is_empty() && columns_meta.is_empty() {
            return Ok(QueryResult {
                columns: vec![],
                column_types: vec![],
                column_tables: vec![],
                column_org_names: vec![],
                rows: vec![],
                affected_rows: 0,
                execution_time_ms,
            });
        }

        let columns: Vec<String> = columns_meta.iter().map(|(name, _, _, _)| name.clone()).collect();
        let column_types: Vec<String> = columns_meta.iter().map(|(_, t, _, _)| t.clone()).collect();
        let column_tables: Vec<String> = columns_meta.iter().map(|(_, _, table, _)| table.clone()).collect();
        let column_org_names: Vec<String> = columns_meta.iter().map(|(_, _, _, org_name)| org_name.clone()).collect();

        // Convert rows to JSON values
        let result_rows: Vec<Vec<serde_json::Value>> = rows
            .iter()
            .map(|row| {
                (0..columns.len())
                    .map(|i| row_value_to_json(row, i, &column_types[i]))
                    .collect()
            })
            .collect();

        Ok(QueryResult {
            columns,
            column_types,
            column_tables,
            column_org_names,
            rows: result_rows,
            affected_rows: 0,
            execution_time_ms,
        })
    } else {
        // Non-SELECT query (INSERT, UPDATE, DELETE, etc.)
        let mut result = conn.query_iter(query).await
            .map_err(|e| format!("Query failed: {}", e))?;

        let affected_rows = result.affected_rows();

        // Consume the result
        let _: Vec<Row> = result.collect().await
            .map_err(|e| format!("Failed to complete query: {}", e))?;

        let execution_time_ms = start.elapsed().as_millis() as u64;

        Ok(QueryResult {
            columns: vec![],
            column_types: vec![],
            column_tables: vec![],
            column_org_names: vec![],
            rows: vec![],
            affected_rows,
            execution_time_ms,
        })
    }
}

pub fn generate_alter_column_sql(
    database: &str,
    table: &str,
    request: &UpdateColumnRequest,
) -> String {
    let default_clause = match &request.default_value {
        Some(val) if !val.is_empty() => {
            if val.to_uppercase() == "NULL"
                || val.to_uppercase() == "CURRENT_TIMESTAMP"
                || val.to_uppercase().starts_with("CURRENT_TIMESTAMP")
                || val.starts_with('(')
            {
                format!(" DEFAULT {}", val)
            } else {
                format!(" DEFAULT '{}'", val.replace('\'', "''"))
            }
        }
        _ => String::new(),
    };

    let comment_clause = match &request.comment {
        Some(c) if !c.is_empty() => format!(" COMMENT '{}'", c.replace('\'', "''")),
        _ => String::new(),
    };

    if let Some(new_name) = &request.new_column_name {
        if new_name != &request.column_name {
            return format!(
                "ALTER TABLE `{}`.`{}` CHANGE COLUMN `{}` `{}` {}{}{}{}",
                database,
                table,
                request.column_name,
                new_name,
                request.column_type,
                if request.is_nullable { " NULL" } else { " NOT NULL" },
                default_clause,
                comment_clause
            );
        }
    }

    format!(
        "ALTER TABLE `{}`.`{}` MODIFY COLUMN `{}` {}{}{}{}",
        database,
        table,
        request.column_name,
        request.column_type,
        if request.is_nullable { " NULL" } else { " NOT NULL" },
        default_clause,
        comment_clause
    )
}

fn build_opts(config: &ConnectionConfig) -> Opts {
    // Build MySQL connection URL
    let db_part = config.database.as_ref()
        .filter(|db| !db.is_empty())
        .map(|db| format!("/{}", db))
        .unwrap_or_default();

    let url = format!(
        "mysql://{}:{}@{}:{}{}",
        urlencoding::encode(&config.user),
        urlencoding::encode(&config.password),
        config.host,
        config.port,
        db_part
    );

    Opts::from_url(&url).expect("Failed to parse MySQL URL")
}

fn escape_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

/// Strip leading SQL comments (-- and /* */) from query to find the actual statement type
fn strip_leading_sql_comments(query: &str) -> &str {
    let mut s = query.trim();
    loop {
        // Skip single-line comments (-- ...)
        if s.starts_with("--") {
            if let Some(newline_pos) = s.find('\n') {
                s = s[newline_pos + 1..].trim_start();
                continue;
            } else {
                // Entire remaining string is a comment
                return "";
            }
        }
        // Skip multi-line comments (/* ... */)
        if s.starts_with("/*") {
            if let Some(end_pos) = s.find("*/") {
                s = s[end_pos + 2..].trim_start();
                continue;
            } else {
                // Unclosed comment
                return "";
            }
        }
        break;
    }
    s
}

// Convert 16 bytes to UUID format string
fn bytes_to_uuid_string(bytes: &[u8]) -> String {
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

// Convert bytes to HEX string
fn bytes_to_hex_string(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02X}", b)).collect()
}

fn row_value_to_json(row: &Row, index: usize, column_type: &str) -> serde_json::Value {
    // Get raw value
    let value: Value = match row.get(index) {
        Some(v) => v,
        None => return serde_json::Value::Null,
    };

    let type_upper = column_type.to_uppercase();

    match value {
        Value::NULL => serde_json::Value::Null,
        Value::Bytes(bytes) => {
            // Handle BIT type - convert bytes to integer
            if type_upper == "BIT" {
                // BIT values are stored as bytes, convert to integer
                let mut result: u64 = 0;
                for byte in bytes.iter() {
                    result = (result << 8) | (*byte as u64);
                }
                return serde_json::Value::Number(result.into());
            }

            // Try to parse as string first
            if let Ok(s) = String::from_utf8(bytes.clone()) {
                serde_json::Value::String(s)
            } else {
                // Binary data
                if type_upper.contains("BINARY") && bytes.len() == 16 {
                    serde_json::Value::String(bytes_to_uuid_string(&bytes))
                } else if bytes.is_empty() {
                    serde_json::Value::String("0x".to_string())
                } else {
                    serde_json::Value::String(format!("0x{}", bytes_to_hex_string(&bytes)))
                }
            }
        }
        Value::Int(i) => serde_json::Value::Number(i.into()),
        Value::UInt(u) => serde_json::Value::Number(u.into()),
        Value::Float(f) => {
            serde_json::Number::from_f64(f as f64)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null)
        }
        Value::Double(d) => {
            serde_json::Number::from_f64(d)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null)
        }
        Value::Date(year, month, day, hour, min, sec, micro) => {
            if hour == 0 && min == 0 && sec == 0 && micro == 0 {
                // Date only
                serde_json::Value::String(format!("{:04}-{:02}-{:02}", year, month, day))
            } else {
                // DateTime
                serde_json::Value::String(format!(
                    "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                    year, month, day, hour, min, sec
                ))
            }
        }
        Value::Time(negative, days, hours, minutes, seconds, micro) => {
            let total_hours = days * 24 + hours as u32;
            let sign = if negative { "-" } else { "" };
            if micro > 0 {
                serde_json::Value::String(format!(
                    "{}{:02}:{:02}:{:02}.{:06}",
                    sign, total_hours, minutes, seconds, micro
                ))
            } else {
                serde_json::Value::String(format!(
                    "{}{:02}:{:02}:{:02}",
                    sign, total_hours, minutes, seconds
                ))
            }
        }
    }
}

pub type SharedConnectionManager = Arc<Mutex<ConnectionManager>>;

pub fn create_connection_manager() -> SharedConnectionManager {
    Arc::new(Mutex::new(ConnectionManager::new()))
}
