use super::provider::ChatMessage;

/// AUTO mode system prompt - AI can execute SELECT queries directly
pub const AUTO_MODE_SYSTEM_PROMPT: &str = r#"당신은 사용자의 MySQL 데이터베이스에서 SELECT 쿼리를 실행하여 정보를 수집할 수 있는 AI 어시스턴트입니다.

## 쿼리 실행 프로토콜

데이터베이스에서 정보를 조회해야 할 때, 다음 형식으로 쿼리를 요청하세요:

<auto_query>
{"query": "SELECT ...", "reason": "필요한 데이터에 대한 간단한 설명"}
</auto_query>

## 규칙:
1. SELECT 쿼리만 실행할 수 있습니다 (SHOW, DESCRIBE도 가능)
2. 필요한 컬럼만 선택하세요 (SELECT * 지양)
3. LIMIT을 포함하세요 (최대 100행으로 제한됨)
4. 한 번에 하나의 쿼리만 요청하세요
5. 최대 5개의 쿼리까지 실행할 수 있습니다
6. 쿼리 결과를 받으면 그 데이터를 활용하여 사용자 질문에 답변하세요

## 비-SELECT 요청 처리:
사용자가 INSERT, UPDATE, DELETE, DROP 등 데이터 변경 쿼리를 요청하면:
- 직접 실행하지 말고 쿼리만 제안하세요
- 다음과 같이 안내하세요: "AUTO 모드에서는 조회용(SELECT) 쿼리만 실행할 수 있습니다. 데이터 변경이 필요한 경우, 아래 쿼리를 직접 실행해 주세요."

## 응답 형식:
- 쿼리 결과를 받은 후, 데이터를 자연스럽게 설명에 통합하세요
- 결과를 표로 정리하거나 요약해서 보여주세요
- 불충분한 결과가 나온 경우, 추가 쿼리를 요청할 수 있습니다

## 예시:

사용자: "orders 테이블에 현재 몇 개의 주문이 있어?"

AI: orders 테이블의 주문 수를 확인해보겠습니다.

<auto_query>
{"query": "SELECT COUNT(*) as total_orders FROM orders", "reason": "전체 주문 수 조회"}
</auto_query>

[결과 수신 후]

**orders** 테이블에는 현재 총 **1,234개**의 주문이 있습니다.

데이터베이스 스키마:
{schema}"#;

/// Build messages for AUTO mode conversation
pub fn build_auto_mode_messages(
    history: &[ChatMessage],
    new_message: &str,
    schema_context: &str,
) -> Vec<ChatMessage> {
    let system_prompt = AUTO_MODE_SYSTEM_PROMPT.replace("{schema}", schema_context);

    let mut messages = vec![ChatMessage {
        role: "system".to_string(),
        content: system_prompt,
    }];

    // Add conversation history, cleaning <auto_query_result> tags from assistant messages
    // to prevent AI from getting confused between <auto_query> and <auto_query_result>
    for msg in history {
        if msg.role == "assistant" {
            // Remove <auto_query_result>...</auto_query_result> blocks from history
            let cleaned_content = clean_auto_query_result_tags(&msg.content);
            messages.push(ChatMessage {
                role: msg.role.clone(),
                content: cleaned_content,
            });
        } else {
            messages.push(msg.clone());
        }
    }

    // Add new user message
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: new_message.to_string(),
    });

    messages
}

/// Remove <auto_query_result> tags from content to prevent AI confusion
fn clean_auto_query_result_tags(content: &str) -> String {
    let re = regex::Regex::new(r"<auto_query_result[^>]*>[\s\S]*?</auto_query_result>\s*")
        .unwrap_or_else(|_| regex::Regex::new(r"$^").unwrap());
    re.replace_all(content, "").trim().to_string()
}

/// Build messages for AUTO mode with query results context
pub fn build_auto_mode_with_results(
    history: &[ChatMessage],
    schema_context: &str,
    query_result_context: &str,
) -> Vec<ChatMessage> {
    let system_prompt = AUTO_MODE_SYSTEM_PROMPT.replace("{schema}", schema_context);

    let mut messages = vec![ChatMessage {
        role: "system".to_string(),
        content: system_prompt,
    }];

    // Add conversation history
    messages.extend(history.iter().cloned());

    // Add query result as system message
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: format!(
            "[시스템: 쿼리 실행 결과]\n{}\n\n위 결과를 바탕으로 사용자의 질문에 답변해주세요.",
            query_result_context
        ),
    });

    messages
}

/// System prompt for table selection (used in 2-step AI flow)
pub const TABLE_SELECTION_SYSTEM_PROMPT: &str = r#"You are a database table selector. Given a user's question and available tables, select which tables are likely needed to answer the question.

Rules:
1. Return ONLY a JSON array of table names, nothing else
2. Select tables that are directly relevant to the question
3. Include related tables if JOINs might be needed
4. If unsure, include more rather than fewer tables
5. Maximum 10 tables
6. If no tables seem relevant, return an empty array []

Example responses:
- ["users", "orders", "products"]
- ["customers"]
- []"#;

/// Build messages for table selection (first step of 2-step AI flow)
pub fn build_table_selection_messages(
    user_message: &str,
    available_tables: &[String],
) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: TABLE_SELECTION_SYSTEM_PROMPT.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!(
                "Available tables: {}\n\nUser question: {}",
                available_tables.join(", "),
                user_message
            ),
        },
    ]
}

/// System prompt for SQL generation
pub const SQL_GENERATION_SYSTEM_PROMPT: &str = r#"당신은 MySQL 데이터베이스 전문가 AI 어시스턴트입니다. 사용자의 자연어 요청을 정확한 MySQL SQL 쿼리로 변환합니다.

규칙:
1. 항상 유효한 MySQL 문법을 사용하세요
2. 테이블명과 컬럼명은 백틱(`)으로 감싸세요
3. 데이터 타입과 NULL 처리에 주의하세요
4. 여러 테이블이 관련된 경우 적절한 JOIN을 사용하세요
5. SQL 쿼리는 반드시 ```sql 코드 블록으로 감싸서 제공하세요
6. 쿼리에 대한 간단한 설명을 한글로 추가하세요
7. DELETE, UPDATE, DROP 같은 위험한 쿼리는 주의 메시지와 함께 제공하세요
8. 사용자가 쿼리를 "직접 실행해줘", "조회해봐", "확인해봐" 등을 요청하면 다음과 같이 안내하세요:
   "AUTO 모드를 활성화하면 제가 SELECT 쿼리를 직접 실행하고 결과를 분석할 수 있습니다. 입력창에서 Tab 키를 누르거나 AUTO 버튼을 클릭하세요."

데이터베이스 스키마:
{schema}"#;

/// System prompt for SQL explanation
pub const SQL_EXPLANATION_SYSTEM_PROMPT: &str = r#"당신은 MySQL 데이터베이스 전문가 AI 어시스턴트입니다. SQL 쿼리를 분석하고 이해하기 쉽게 설명합니다.

규칙:
1. 쿼리의 목적을 먼저 설명하세요
2. 각 절(SELECT, FROM, WHERE, JOIN 등)의 역할을 설명하세요
3. 복잡한 부분은 단계별로 나눠서 설명하세요
4. 성능 관련 조언이 있다면 추가하세요
5. 모든 설명은 한글로 작성하세요"#;

/// System prompt for query optimization
pub const SQL_OPTIMIZATION_SYSTEM_PROMPT: &str = r#"당신은 MySQL 데이터베이스 성능 최적화 전문가입니다. SQL 쿼리를 분석하고 최적화 방안을 제안합니다.

분석 항목:
1. 인덱스 사용 여부 및 권장 인덱스
2. 쿼리 구조 개선 방안
3. 잠재적인 성능 문제
4. 대안 쿼리 제안

모든 설명은 한글로 작성하세요."#;

/// Build messages for natural language to SQL conversion
pub fn build_nl_to_sql_messages(user_message: &str, schema_context: &str) -> Vec<ChatMessage> {
    let system_prompt = SQL_GENERATION_SYSTEM_PROMPT.replace("{schema}", schema_context);

    vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
        },
        ChatMessage {
            role: "user".to_string(),
            content: user_message.to_string(),
        },
    ]
}

/// Build messages for SQL explanation
pub fn build_sql_explanation_messages(sql_query: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: SQL_EXPLANATION_SYSTEM_PROMPT.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("다음 SQL 쿼리를 설명해주세요:\n\n```sql\n{}\n```", sql_query),
        },
    ]
}

/// Build messages for query optimization
pub fn build_optimization_messages(sql_query: &str, schema_context: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "{}\n\n데이터베이스 스키마:\n{}",
                SQL_OPTIMIZATION_SYSTEM_PROMPT, schema_context
            ),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!(
                "다음 SQL 쿼리를 분석하고 최적화 방안을 제안해주세요:\n\n```sql\n{}\n```",
                sql_query
            ),
        },
    ]
}

/// Build messages for continuing a conversation
pub fn build_conversation_messages(
    history: &[ChatMessage],
    new_message: &str,
    schema_context: &str,
) -> Vec<ChatMessage> {
    let system_prompt = SQL_GENERATION_SYSTEM_PROMPT.replace("{schema}", schema_context);

    let mut messages = vec![ChatMessage {
        role: "system".to_string(),
        content: system_prompt,
    }];

    // Add conversation history
    messages.extend(history.iter().cloned());

    // Add new user message
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: new_message.to_string(),
    });

    messages
}

// ============================================================
// 대화 요약 관련 (Conversation Summary Buffer Memory)
// ============================================================

/// 대화 요약 프롬프트 (경량 모델 사용)
pub const CONVERSATION_SUMMARY_PROMPT: &str = r#"아래 SQL 관련 대화를 요약해주세요.

## 반드시 포함할 정보:
1. 사용된 테이블명 (정확히)
2. 적용된 필터/조건 (WHERE, HAVING 등)
3. 사용자의 비즈니스 의도
4. 합의된 사항이나 제약조건

## 출력 형식 (JSON만 출력):
{
  "summary": "200자 이내 요약",
  "tables": ["table1", "table2"],
  "key_conditions": ["status='active'", "date >= '2024-01-01'"]
}

## 주의사항:
- 구체적인 테이블명, 컬럼명을 반드시 유지
- "데이터" 같은 추상적 표현 금지
- SQL 코드 자체보다 '의도'와 '조건' 위주로
- JSON만 출력하고 다른 텍스트는 출력하지 마세요"#;

/// 대화 요약을 위한 메시지 빌드
pub fn build_summary_messages(messages_to_summarize: &[ChatMessage]) -> Vec<ChatMessage> {
    let conversation_text: String = messages_to_summarize
        .iter()
        .map(|m| {
            let role_label = match m.role.as_str() {
                "user" => "사용자",
                "assistant" => "AI",
                _ => &m.role,
            };
            // 메시지가 너무 길면 자르기 (UTF-8 문자 경계 안전하게 처리)
            let content = {
                let chars: Vec<char> = m.content.chars().collect();
                if chars.len() > 500 {
                    format!("{}...", chars[..500].iter().collect::<String>())
                } else {
                    m.content.clone()
                }
            };
            format!("[{}]: {}", role_label, content)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    vec![
        ChatMessage {
            role: "system".to_string(),
            content: CONVERSATION_SUMMARY_PROMPT.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("요약할 대화:\n\n{}", conversation_text),
        },
    ]
}

/// 요약이 포함된 대화 메시지 빌드 (Summary Buffer Memory 패턴)
pub fn build_conversation_messages_with_summary(
    summary: Option<&str>,
    recent_history: &[ChatMessage],
    new_message: &str,
    schema_context: &str,
) -> Vec<ChatMessage> {
    let mut system_content = SQL_GENERATION_SYSTEM_PROMPT.replace("{schema}", schema_context);

    // 요약이 있으면 시스템 프롬프트에 추가
    if let Some(summary_text) = summary {
        system_content = format!(
            "{}\n\n## 이전 대화 맥락 (요약):\n{}",
            system_content, summary_text
        );
    }

    let mut messages = vec![ChatMessage {
        role: "system".to_string(),
        content: system_content,
    }];

    // 최근 대화 히스토리 추가
    messages.extend(recent_history.iter().cloned());

    // 새 사용자 메시지 추가
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: new_message.to_string(),
    });

    messages
}
