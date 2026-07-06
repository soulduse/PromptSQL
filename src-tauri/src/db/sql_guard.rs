//! SQL 안전성 유틸 — 식별자 인용, 리터럴 이스케이프, 주석 스트립,
//! 다중 문장 감지, 읽기 전용 판정의 단일 소스.
//!
//! execute_query / AUTO 모드 / ALTER 생성이 모두 이 모듈을 거쳐
//! 판정·인용 로직이 갈라지지 않도록 한다.

use once_cell::sync::Lazy;
use regex::Regex;

/// MySQL 식별자를 백틱으로 인용한다 (내부 백틱은 이중화).
pub fn quote_ident(ident: &str) -> String {
    format!("`{}`", ident.replace('`', "``"))
}

/// MySQL 문자열 리터럴 이스케이프 (backslash + 작은따옴표).
///
/// `NO_BACKSLASH_ESCAPES` 모드가 꺼진 기본 MySQL을 가정한다 —
/// 백슬래시를 이중화하지 않으면 `...\'` 로 닫는 따옴표가 무력화된다.
pub fn escape_string_literal(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "''")
}

/// 선행 SQL 주석(`--`, `#`, `/* */`)을 제거해 실제 문장 시작을 찾는다.
pub fn strip_leading_sql_comments(query: &str) -> &str {
    let mut s = query.trim_start();
    loop {
        if s.starts_with("--") || s.starts_with('#') {
            match s.find('\n') {
                Some(pos) => {
                    s = s[pos + 1..].trim_start();
                    continue;
                }
                // Entire remaining string is a comment
                None => return "",
            }
        }
        if s.starts_with("/*") {
            match s.find("*/") {
                Some(pos) => {
                    s = s[pos + 2..].trim_start();
                    continue;
                }
                // Unclosed comment
                None => return "",
            }
        }
        break;
    }
    s
}

/// 읽기 전용(결과셋 반환) 문장인지 판정한다. 선행 주석은 무시.
pub fn is_read_only_statement(query: &str) -> bool {
    let stripped = strip_leading_sql_comments(query);
    let upper = stripped.trim_start().to_uppercase();
    upper.starts_with("SELECT")
        || upper.starts_with("SHOW")
        || upper.starts_with("DESCRIBE")
        || upper.starts_with("DESC ")
        || upper.starts_with("EXPLAIN")
}

/// 문자열·식별자·주석을 인식하며 세미콜론으로 구분된 문장이
/// 두 개 이상인지 검사한다.
///
/// 끝의 `;`(뒤에 공백/주석만 남는 경우)는 단일 문장으로 취급.
pub fn contains_multiple_statements(query: &str) -> bool {
    #[derive(PartialEq)]
    enum State {
        Normal,
        SingleQuote,
        DoubleQuote,
        Backtick,
        LineComment,
        BlockComment,
    }

    let mut state = State::Normal;
    let mut seen_terminator = false;
    let mut chars = query.chars().peekable();

    while let Some(c) = chars.next() {
        match state {
            State::Normal => match c {
                '\'' => state = State::SingleQuote,
                '"' => state = State::DoubleQuote,
                '`' => state = State::Backtick,
                '#' => state = State::LineComment,
                '-' if chars.peek() == Some(&'-') => {
                    chars.next();
                    state = State::LineComment;
                }
                '/' if chars.peek() == Some(&'*') => {
                    chars.next();
                    state = State::BlockComment;
                }
                ';' => seen_terminator = true,
                _ if c.is_whitespace() => {}
                _ => {
                    if seen_terminator {
                        // 세미콜론 뒤에 의미 있는 토큰 → 두 번째 문장
                        return true;
                    }
                }
            },
            State::SingleQuote => match c {
                '\\' => {
                    chars.next(); // escaped char
                }
                '\'' => {
                    if chars.peek() == Some(&'\'') {
                        chars.next(); // doubled quote ('')
                    } else {
                        state = State::Normal;
                    }
                }
                _ => {}
            },
            State::DoubleQuote => match c {
                '\\' => {
                    chars.next();
                }
                '"' => {
                    if chars.peek() == Some(&'"') {
                        chars.next();
                    } else {
                        state = State::Normal;
                    }
                }
                _ => {}
            },
            State::Backtick => {
                if c == '`' {
                    if chars.peek() == Some(&'`') {
                        chars.next(); // doubled backtick
                    } else {
                        state = State::Normal;
                    }
                }
            }
            State::LineComment => {
                if c == '\n' {
                    state = State::Normal;
                }
            }
            State::BlockComment => {
                if c == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    state = State::Normal;
                }
            }
        }
    }

    false
}

/// MySQL 컬럼 타입 정의 화이트리스트.
///
/// `INT`, `INT(11)`, `DECIMAL(10,2)`, `VARCHAR(255)`, `ENUM('a','b')`,
/// `INT UNSIGNED ZEROFILL`, `VARCHAR(64) CHARACTER SET utf8mb4 COLLATE ...`
/// 형태만 허용해 ALTER 문에 원문 삽입 가능한 표면을 차단한다.
static COLUMN_TYPE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^[a-z][a-z0-9_]*(\s*\(\s*(\d+(\s*,\s*\d+)?|'(?:[^']|'')*'(\s*,\s*'(?:[^']|'')*')*)\s*\))?(\s+(unsigned|zerofill|binary|character\s+set\s+[a-z0-9_]+|collate\s+[a-z0-9_]+))*\s*$",
    )
    .expect("COLUMN_TYPE_RE is a valid regex")
});

/// 컬럼 타입 문자열이 화이트리스트 형식에 맞는지 검증한다.
pub fn validate_column_type(column_type: &str) -> Result<(), String> {
    let trimmed = column_type.trim();
    if trimmed.is_empty() {
        return Err("Column type cannot be empty".to_string());
    }
    if COLUMN_TYPE_RE.is_match(trimmed) {
        Ok(())
    } else {
        Err(format!("Invalid column type: {}", column_type))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quote_ident_plain() {
        assert_eq!(quote_ident("users"), "`users`");
    }

    #[test]
    fn test_quote_ident_with_backtick() {
        assert_eq!(quote_ident("we`ird"), "`we``ird`");
    }

    #[test]
    fn test_escape_string_literal() {
        assert_eq!(escape_string_literal("it's"), "it''s");
        assert_eq!(escape_string_literal(r"a\b"), r"a\\b");
        // 백슬래시로 닫는 따옴표를 무력화하는 고전 패턴
        assert_eq!(escape_string_literal(r"x\"), r"x\\");
    }

    #[test]
    fn test_strip_leading_comments() {
        assert_eq!(
            strip_leading_sql_comments("-- c\nSELECT 1"),
            "SELECT 1"
        );
        assert_eq!(
            strip_leading_sql_comments("/* c */ SELECT 1"),
            "SELECT 1"
        );
        assert_eq!(
            strip_leading_sql_comments("# c\nSELECT 1"),
            "SELECT 1"
        );
        assert_eq!(strip_leading_sql_comments("-- only comment"), "");
        assert_eq!(strip_leading_sql_comments("/* unclosed"), "");
    }

    #[test]
    fn test_is_read_only_statement() {
        assert!(is_read_only_statement("SELECT 1"));
        assert!(is_read_only_statement("  show tables"));
        assert!(is_read_only_statement("DESC users"));
        assert!(is_read_only_statement("-- note\nEXPLAIN SELECT 1"));
        // 주석으로 위장한 쓰기 문장
        assert!(!is_read_only_statement("/* SELECT */ DELETE FROM t"));
        assert!(!is_read_only_statement("UPDATE t SET a = 1"));
        assert!(!is_read_only_statement("-- only comment"));
    }

    #[test]
    fn test_multiple_statements_detected() {
        assert!(contains_multiple_statements("SELECT 1; DROP TABLE t"));
        assert!(contains_multiple_statements("SELECT 1;DELETE FROM t;"));
    }

    #[test]
    fn test_single_statement_with_trailing_semicolon() {
        assert!(!contains_multiple_statements("SELECT 1;"));
        assert!(!contains_multiple_statements("SELECT 1; -- comment"));
        assert!(!contains_multiple_statements("SELECT 1; /* c */  "));
    }

    #[test]
    fn test_semicolon_inside_string_or_ident() {
        assert!(!contains_multiple_statements("SELECT ';' AS s"));
        assert!(!contains_multiple_statements("SELECT \";\" AS s"));
        assert!(!contains_multiple_statements("SELECT `a;b` FROM t;"));
        assert!(!contains_multiple_statements(r"SELECT 'a\';b' AS s"));
        assert!(!contains_multiple_statements("SELECT 'a''b;c' AS s"));
    }

    #[test]
    fn test_semicolon_inside_comment() {
        assert!(!contains_multiple_statements("SELECT 1 -- ; DROP TABLE t"));
        assert!(!contains_multiple_statements("SELECT 1 /* ; DROP */ + 1"));
        assert!(!contains_multiple_statements("SELECT 1 # ; DROP"));
        // 주석 뒤 실제 문장은 감지
        assert!(contains_multiple_statements(
            "SELECT 1; /* c */ DROP TABLE t"
        ));
    }

    #[test]
    fn test_validate_column_type_accepts_common_types() {
        for t in [
            "INT",
            "int(11)",
            "DECIMAL(10,2)",
            "varchar(255)",
            "ENUM('a','b')",
            "SET('x')",
            "enum('it''s','ok')",
            "INT UNSIGNED ZEROFILL",
            "datetime",
            "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci",
        ] {
            assert!(validate_column_type(t).is_ok(), "should accept: {}", t);
        }
    }

    #[test]
    fn test_validate_column_type_rejects_injection() {
        for t in [
            "",
            "INT; DROP TABLE users",
            "INT) DEFAULT (SLEEP(10)",
            "VARCHAR(255)'",
            "INT -- comment",
        ] {
            assert!(validate_column_type(t).is_err(), "should reject: {}", t);
        }
    }
}
