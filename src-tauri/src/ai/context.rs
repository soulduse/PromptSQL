use crate::db::ColumnInfo;
use super::conversations::ConversationContext;

/// Build schema context string for AI prompt
pub fn build_schema_context(tables: &[(String, Vec<ColumnInfo>)]) -> String {
    let mut context = String::new();

    for (table_name, columns) in tables {
        context.push_str(&format!("Table: `{}`\n", table_name));
        context.push_str("Columns:\n");

        for col in columns {
            let nullable = if col.is_nullable == "YES" {
                "NULL"
            } else {
                "NOT NULL"
            };
            let key_info = if !col.key.is_empty() {
                format!(" [{}]", col.key)
            } else {
                String::new()
            };
            let default_info = col
                .default_value
                .as_ref()
                .map(|d| format!(" DEFAULT {}", d))
                .unwrap_or_default();

            context.push_str(&format!(
                "  - `{}` {} {}{}{}\n",
                col.field, col.column_type, nullable, key_info, default_info
            ));
        }
        context.push('\n');
    }

    context
}

/// Build schema context for specific mentioned tables
pub fn build_mentioned_tables_context(
    mentioned_tables: &[String],
    all_tables: &[(String, Vec<ColumnInfo>)],
) -> String {
    let filtered: Vec<_> = all_tables
        .iter()
        .filter(|(name, _)| mentioned_tables.iter().any(|m| m.eq_ignore_ascii_case(name)))
        .cloned()
        .collect();

    if filtered.is_empty() {
        return String::new();
    }

    build_schema_context(&filtered)
}

/// 후속 질문 패턴 (API 호출 스킵 가능) - 다국어 지원
const FOLLOWUP_PATTERNS: &[&str] = &[
    // === 한국어 ===
    // 수정/변경
    "수정", "변경", "바꿔", "고쳐", "다시", "재작성",
    // 지시어
    "이 쿼리", "이거", "위 쿼리", "방금", "아까", "그거", "저거",
    // 추가/제한
    "추가해", "더 ", "만 ", "까지", "부터", "개만", "빼고",
    // === 영어 ===
    "modify", "change", "fix", "again", "rewrite",
    "this query", "that query", "above", "previous",
    "add more", "only", "limit to", "except",
    // === 일본어 ===
    "修正", "変更", "直して", "もう一度", "再度",
    "このクエリ", "これ", "上の", "さっき",
    "追加", "だけ", "まで", "から",
    // === 중국어 ===
    "修改", "更改", "再来", "重新",
    "这个查询", "这个", "上面", "刚才",
    "添加", "只要", "到", "从",
];

/// 새 주제 패턴 (테이블 재선택 필요) - 다국어 지원
const NEW_TOPIC_PATTERNS: &[&str] = &[
    // 한국어
    "테이블", "새로운", "다른 테이블", "스키마",
    // 영어
    "table", "new query", "different table", "schema",
    // 일본어
    "テーブル", "新しい", "別の", "スキーマ",
    // 중국어
    "表", "新的", "另一个", "架构",
];

/// 후속 질문인지 판단 (이전 테이블 재사용 가능 여부)
pub fn is_followup_question(message: &str, context: &ConversationContext) -> bool {
    // 이전에 사용된 테이블이 없으면 후속 질문 아님
    if context.used_tables.is_empty() {
        return false;
    }

    // 긴 메시지는 새 주제일 가능성 높음
    if message.chars().count() > 150 {
        return false;
    }

    let msg_lower = message.to_lowercase();

    // 새 주제 패턴 감지 시 false
    for pattern in NEW_TOPIC_PATTERNS {
        if msg_lower.contains(&pattern.to_lowercase()) {
            return false;
        }
    }

    // 후속 질문 패턴 매칭
    for pattern in FOLLOWUP_PATTERNS {
        if msg_lower.contains(&pattern.to_lowercase()) {
            return true;
        }
    }

    // 짧은 메시지는 후속 질문 가능성 높음 (30자 미만)
    message.chars().count() < 30
}

/// Extract @mentioned table names from user message
/// Returns (has_all, table_names) where has_all is true if @all was mentioned
pub fn extract_mentioned_tables(message: &str) -> (bool, Vec<String>) {
    let mut tables = Vec::new();
    let mut has_all = false;
    let mut chars = message.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '@' {
            let mut table_name = String::new();
            while let Some(&next_c) = chars.peek() {
                // Only allow ASCII alphanumeric and underscore for table names
                if next_c.is_ascii_alphanumeric() || next_c == '_' {
                    table_name.push(chars.next().unwrap());
                } else {
                    break;
                }
            }
            if table_name.eq_ignore_ascii_case("all") {
                has_all = true;
            } else if !table_name.is_empty() {
                tables.push(table_name);
            }
        }
    }

    (has_all, tables)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_context(tables: Vec<&str>) -> ConversationContext {
        ConversationContext {
            used_tables: tables.into_iter().map(String::from).collect(),
            tables_selected_at: 0,
            summary: None,
        }
    }

    // === 후속 질문 판단 테스트 ===

    #[test]
    fn test_followup_modification_korean() {
        let ctx = make_context(vec!["users", "orders"]);
        assert!(is_followup_question("이 쿼리를 수정해줘", &ctx));
        assert!(is_followup_question("10일치만 보이게 해줘", &ctx));
        assert!(is_followup_question("다시 작성해줘", &ctx));
    }

    #[test]
    fn test_followup_modification_english() {
        let ctx = make_context(vec!["users"]);
        assert!(is_followup_question("modify this query", &ctx));
        assert!(is_followup_question("change to limit 10", &ctx));
        assert!(is_followup_question("fix the error", &ctx));
    }

    #[test]
    fn test_new_topic_detection() {
        let ctx = make_context(vec!["users"]);
        assert!(!is_followup_question("products 테이블에서 조회해줘", &ctx));
        assert!(!is_followup_question("새로운 쿼리 작성해줘", &ctx));
        assert!(!is_followup_question("show me the schema", &ctx));
    }

    #[test]
    fn test_short_message_is_followup() {
        let ctx = make_context(vec!["users"]);
        assert!(is_followup_question("정렬 추가", &ctx));
        assert!(is_followup_question("limit 10", &ctx));
        assert!(is_followup_question("DESC로", &ctx));
    }

    #[test]
    fn test_no_context_is_not_followup() {
        let ctx = make_context(vec![]);
        assert!(!is_followup_question("수정해줘", &ctx));
    }

    #[test]
    fn test_long_message_is_not_followup() {
        let ctx = make_context(vec!["users"]);
        let long_msg = "a".repeat(200);
        assert!(!is_followup_question(&long_msg, &ctx));
    }

    // === 멘션 추출 테스트 ===

    #[test]
    fn test_extract_mentioned_tables() {
        let message = "@users 테이블에서 @orders와 조인해서 조회해줘";
        let (has_all, tables) = extract_mentioned_tables(message);
        assert!(!has_all);
        assert_eq!(tables, vec!["users", "orders"]);
    }

    #[test]
    fn test_extract_mentioned_tables_with_underscore() {
        let message = "@user_profiles의 모든 데이터";
        let (has_all, tables) = extract_mentioned_tables(message);
        assert!(!has_all);
        assert_eq!(tables, vec!["user_profiles"]);
    }

    #[test]
    fn test_extract_mentioned_tables_with_all() {
        let message = "@all 데이터베이스 구조 설명해줘";
        let (has_all, tables) = extract_mentioned_tables(message);
        assert!(has_all);
        assert!(tables.is_empty());
    }

    #[test]
    fn test_extract_mentioned_tables_all_case_insensitive() {
        let message = "@ALL 전체 스키마 보여줘";
        let (has_all, tables) = extract_mentioned_tables(message);
        assert!(has_all);
        assert!(tables.is_empty());
    }

    #[test]
    fn test_extract_mentioned_tables_all_with_specific() {
        let message = "@all @users 테이블도 같이";
        let (has_all, tables) = extract_mentioned_tables(message);
        assert!(has_all);
        assert_eq!(tables, vec!["users"]);
    }
}
