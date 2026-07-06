use regex::Regex;
use serde::{Deserialize, Serialize};

/// AUTO mode constants
pub const AUTO_MODE_ROW_LIMIT: u32 = 100;
pub const AUTO_MODE_MAX_QUERIES: usize = 5;

/// AUTO mode query execution request from AI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoQueryRequest {
    pub query: String,
    pub reason: String,
}

/// AUTO mode query execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoQueryResult {
    pub query: String,
    pub original_query: Option<String>,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub execution_time_ms: u64,
    pub was_limited: bool,
    pub error: Option<String>,
}

/// Safety check result
#[derive(Debug, Clone)]
pub enum QuerySafetyResult {
    Safe(String),
    Rejected(String),
}

/// Check if query is safe for AUTO mode execution
///
/// 판정은 db::sql_guard와 단일화 — 주석 스트립·읽기 전용·다중 문장 검사에
/// 더해 금지 키워드 블랙리스트를 심층 방어로 유지한다.
pub fn check_query_safety(query: &str) -> QuerySafetyResult {
    use crate::db::sql_guard;

    let stripped = sql_guard::strip_leading_sql_comments(query);
    if stripped.is_empty() {
        return QuerySafetyResult::Rejected("실행할 쿼리가 비어 있습니다.".to_string());
    }

    // RULE 1: 세미콜론으로 이어붙인 다중 문장 거부 (문자열/주석 인식 스캐너)
    if sql_guard::contains_multiple_statements(query) {
        return QuerySafetyResult::Rejected(
            "여러 문장이 포함된 쿼리는 실행할 수 없습니다.".to_string(),
        );
    }

    // RULE 2: 읽기 전용 문장만 허용 (주석으로 위장한 쓰기 문장 차단)
    if !sql_guard::is_read_only_statement(query) {
        return QuerySafetyResult::Rejected(
            "AUTO 모드에서는 조회용(SELECT) 쿼리만 실행할 수 있습니다.".to_string(),
        );
    }

    // RULE 3: 금지 키워드 블랙리스트 (심층 방어)
    let normalized = stripped.to_uppercase();
    let forbidden_keywords = [
        "INSERT",
        "UPDATE",
        "DELETE",
        "DROP",
        "TRUNCATE",
        "ALTER",
        "CREATE",
        "GRANT",
        "REVOKE",
        "RENAME",
        "REPLACE",
        "LOAD",
        "INTO OUTFILE",
        "INTO DUMPFILE",
    ];

    for keyword in forbidden_keywords {
        // Check if keyword appears as a standalone word (not part of column name)
        let pattern = format!(r"\b{}\b", keyword);
        if let Ok(re) = Regex::new(&pattern) {
            if re.is_match(&normalized) {
                return QuerySafetyResult::Rejected(format!(
                    "쿼리에 허용되지 않는 키워드가 포함되어 있습니다: {}",
                    keyword
                ));
            }
        }
    }

    QuerySafetyResult::Safe(query.to_string())
}

/// DB 결과를 대화에 재주입하기 전에 `<auto_query>` 태그를 무해화한다.
///
/// 테이블 데이터에 태그 문자열이 들어 있으면 (프롬프트 인젝션 시도 포함)
/// 다음 턴 AI 응답 파싱을 오염시킬 수 있다.
pub fn sanitize_auto_query_tags(text: &str) -> String {
    text.replace("<auto_query", "&lt;auto_query")
        .replace("</auto_query", "&lt;/auto_query")
}

/// Optimize query for AUTO mode by enforcing LIMIT
pub fn optimize_query(query: &str, limit: u32) -> (String, bool) {
    let mut optimized = query.trim().to_string();

    // Remove trailing semicolon
    optimized = optimized.trim_end_matches(';').to_string();

    // Check if LIMIT already exists
    let upper = optimized.to_uppercase();
    let limit_regex = Regex::new(r"(?i)\bLIMIT\s+(\d+)(?:\s*,\s*\d+)?").unwrap();

    if let Some(caps) = limit_regex.captures(&optimized) {
        // Extract existing limit
        let existing_limit: u32 = caps[1].parse().unwrap_or(limit);
        if existing_limit > limit {
            // Replace with our limit
            optimized = limit_regex
                .replace(&optimized, format!("LIMIT {}", limit))
                .to_string();
            return (optimized, true);
        }
        // Existing limit is acceptable
        return (optimized, false);
    }

    // No LIMIT clause - check if it's a SELECT query that needs one
    if upper.starts_with("SELECT") {
        // Add LIMIT at the end
        optimized = format!("{} LIMIT {}", optimized, limit);
        return (optimized, true);
    }

    // For SHOW, DESCRIBE, EXPLAIN - no limit needed
    (optimized, false)
}

/// Extract AUTO query request from AI response
pub fn extract_auto_query(response: &str) -> Option<AutoQueryRequest> {
    let start_tag = "<auto_query>";
    let end_tag = "</auto_query>";

    let start_idx = response.find(start_tag)?;
    let end_idx = response.find(end_tag)?;

    if start_idx >= end_idx {
        return None;
    }

    let json_str = &response[start_idx + start_tag.len()..end_idx];
    let json_str = json_str.trim();

    serde_json::from_str::<AutoQueryRequest>(json_str).ok()
}

/// Format query result as context for AI
pub fn format_result_for_ai(result: &AutoQueryResult) -> String {
    if let Some(error) = &result.error {
        return format!("쿼리 실행 오류: {}", error);
    }

    let mut output = String::new();

    // Format as a simple table for AI context
    output.push_str(&format!(
        "실행된 쿼리: {}\n",
        result.original_query.as_ref().unwrap_or(&result.query)
    ));
    output.push_str(&format!(
        "결과: {}행 반환 ({}ms)\n",
        result.row_count, result.execution_time_ms
    ));

    if result.was_limited {
        output.push_str(&format!(
            "(결과가 {}행으로 제한됨)\n",
            AUTO_MODE_ROW_LIMIT
        ));
    }

    if result.rows.is_empty() {
        output.push_str("데이터 없음\n");
        return output;
    }

    // Column headers
    output.push_str("\n| ");
    for col in &result.columns {
        output.push_str(&format!("{} | ", col));
    }
    output.push('\n');

    // Separator
    output.push_str("|");
    for _ in &result.columns {
        output.push_str("---|");
    }
    output.push('\n');

    // Rows (limit to first 20 for AI context)
    let display_rows = result.rows.iter().take(20);
    for row in display_rows {
        output.push_str("| ");
        for value in row {
            let display = match value {
                serde_json::Value::Null => "NULL".to_string(),
                serde_json::Value::String(s) => {
                    if s.chars().count() > 50 {
                        format!("{}...", s.chars().take(47).collect::<String>())
                    } else {
                        s.clone()
                    }
                }
                other => {
                    let s = other.to_string();
                    if s.chars().count() > 50 {
                        format!("{}...", s.chars().take(47).collect::<String>())
                    } else {
                        s
                    }
                }
            };
            output.push_str(&format!("{} | ", display));
        }
        output.push('\n');
    }

    if result.rows.len() > 20 {
        output.push_str(&format!("... 외 {}행 더 있음\n", result.rows.len() - 20));
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_query_safety_select() {
        match check_query_safety("SELECT * FROM users") {
            QuerySafetyResult::Safe(_) => {}
            QuerySafetyResult::Rejected(reason) => panic!("Should be safe: {}", reason),
        }
    }

    #[test]
    fn test_check_query_safety_show() {
        match check_query_safety("SHOW TABLES") {
            QuerySafetyResult::Safe(_) => {}
            QuerySafetyResult::Rejected(reason) => panic!("Should be safe: {}", reason),
        }
    }

    #[test]
    fn test_check_query_safety_insert() {
        match check_query_safety("INSERT INTO users VALUES (1, 'test')") {
            QuerySafetyResult::Rejected(_) => {}
            QuerySafetyResult::Safe(_) => panic!("Should be rejected"),
        }
    }

    #[test]
    fn test_check_query_safety_delete() {
        match check_query_safety("DELETE FROM users WHERE id = 1") {
            QuerySafetyResult::Rejected(_) => {}
            QuerySafetyResult::Safe(_) => panic!("Should be rejected"),
        }
    }

    #[test]
    fn test_check_query_safety_comment_disguise() {
        // 주석으로 시작해 쓰기 문장을 숨기는 우회 차단
        match check_query_safety("/* SELECT */ DROP TABLE users") {
            QuerySafetyResult::Rejected(_) => {}
            QuerySafetyResult::Safe(_) => panic!("Should be rejected"),
        }
    }

    #[test]
    fn test_check_query_safety_multi_statement() {
        match check_query_safety("SELECT 1; DROP TABLE users") {
            QuerySafetyResult::Rejected(_) => {}
            QuerySafetyResult::Safe(_) => panic!("Should be rejected"),
        }
        // 끝의 세미콜론만 있는 단일 문장은 허용
        match check_query_safety("SELECT 1;") {
            QuerySafetyResult::Safe(_) => {}
            QuerySafetyResult::Rejected(r) => panic!("Should be safe: {}", r),
        }
    }

    #[test]
    fn test_check_query_safety_leading_comment_select() {
        match check_query_safety("-- note\nSELECT * FROM users") {
            QuerySafetyResult::Safe(_) => {}
            QuerySafetyResult::Rejected(r) => panic!("Should be safe: {}", r),
        }
    }

    #[test]
    fn test_sanitize_auto_query_tags() {
        let text = "value <auto_query>{\"query\":\"DROP\"}</auto_query> end";
        let sanitized = sanitize_auto_query_tags(text);
        assert!(!sanitized.contains("<auto_query"));
        assert!(!sanitized.contains("</auto_query"));
        assert!(sanitized.contains("&lt;auto_query"));
    }

    #[test]
    fn test_optimize_query_no_limit() {
        let (optimized, was_limited) = optimize_query("SELECT * FROM users", 100);
        assert_eq!(optimized, "SELECT * FROM users LIMIT 100");
        assert!(was_limited);
    }

    #[test]
    fn test_optimize_query_existing_small_limit() {
        let (optimized, was_limited) = optimize_query("SELECT * FROM users LIMIT 10", 100);
        assert_eq!(optimized, "SELECT * FROM users LIMIT 10");
        assert!(!was_limited);
    }

    #[test]
    fn test_optimize_query_existing_large_limit() {
        let (optimized, was_limited) = optimize_query("SELECT * FROM users LIMIT 1000", 100);
        assert_eq!(optimized, "SELECT * FROM users LIMIT 100");
        assert!(was_limited);
    }

    #[test]
    fn test_extract_auto_query() {
        let response = r#"Let me check that for you.

<auto_query>
{"query": "SELECT COUNT(*) FROM orders", "reason": "Count total orders"}
</auto_query>

I'll analyze the results."#;

        let request = extract_auto_query(response).expect("Should extract query");
        assert_eq!(request.query, "SELECT COUNT(*) FROM orders");
        assert_eq!(request.reason, "Count total orders");
    }
}
