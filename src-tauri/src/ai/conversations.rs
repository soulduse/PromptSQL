use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::provider::ChatMessage;

const APP_NAME: &str = "promptsql";
const CONVERSATIONS_DIR: &str = "conversations";

/// 대화에서 사용된 테이블 및 맥락 정보
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConversationContext {
    /// 대화에서 사용된 테이블 목록
    pub used_tables: Vec<String>,
    /// 마지막 테이블 선택 시점 (메시지 인덱스)
    pub tables_selected_at: usize,
    /// 대화 요약 (긴 대화 압축용)
    pub summary: Option<ChatSummary>,
}

/// 대화 요약 정보 (Conversation Summary Buffer Memory)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSummary {
    /// 요약 텍스트
    pub text: String,
    /// 요약이 커버하는 메시지 범위 (0..summarized_until)
    pub summarized_until: usize,
    /// 요약에 포함된 테이블들
    pub tables: Vec<String>,
    /// 핵심 조건/의도 (예: "status='active'", "date >= '2024-01-01'")
    pub key_conditions: Vec<String>,
    /// 요약 생성 시점
    pub created_at: i64,
}

/// Conversation data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub messages: Vec<ChatMessage>,
    pub connection_id: Option<String>,
    pub database: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// 대화 맥락 정보 (테이블, 요약 등)
    #[serde(default)]
    pub context: Option<ConversationContext>,
}

/// Conversation summary (for listing)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub message_count: usize,
    pub connection_id: Option<String>,
    pub database: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<&Conversation> for ConversationSummary {
    fn from(conv: &Conversation) -> Self {
        Self {
            id: conv.id.clone(),
            title: conv.title.clone(),
            message_count: conv.messages.len(),
            connection_id: conv.connection_id.clone(),
            database: conv.database.clone(),
            created_at: conv.created_at,
            updated_at: conv.updated_at,
        }
    }
}

/// Get the conversations directory
fn get_conversations_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir()
        .ok_or("Could not find data directory")?
        .join(APP_NAME)
        .join(CONVERSATIONS_DIR);

    // Create directory if it doesn't exist
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create conversations directory: {}", e))?;
    }

    Ok(data_dir)
}

/// Get conversation file path
fn get_conversation_file(id: &str) -> Result<PathBuf, String> {
    Ok(get_conversations_dir()?.join(format!("{}.json", id)))
}

/// Save conversation to file
pub fn save_conversation(conversation: &Conversation) -> Result<(), String> {
    let file_path = get_conversation_file(&conversation.id)?;

    let content = serde_json::to_string_pretty(conversation)
        .map_err(|e| format!("Failed to serialize conversation: {}", e))?;

    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write conversation file: {}", e))?;

    Ok(())
}

/// Load conversation from file
pub fn load_conversation(id: &str) -> Result<Conversation, String> {
    let file_path = get_conversation_file(id)?;

    if !file_path.exists() {
        return Err(format!("Conversation not found: {}", id));
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read conversation file: {}", e))?;

    let conversation: Conversation = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse conversation file: {}", e))?;

    Ok(conversation)
}

/// List all conversations
pub fn list_conversations() -> Result<Vec<ConversationSummary>, String> {
    let dir = get_conversations_dir()?;

    let mut summaries = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(conv) = serde_json::from_str::<Conversation>(&content) {
                        summaries.push(ConversationSummary::from(&conv));
                    }
                }
            }
        }
    }

    // Sort by updated_at descending
    summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(summaries)
}

/// Delete conversation
pub fn delete_conversation(id: &str) -> Result<(), String> {
    let file_path = get_conversation_file(id)?;

    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete conversation file: {}", e))?;
    }

    Ok(())
}

/// Create a new conversation
pub fn create_conversation(
    connection_id: Option<String>,
    database: Option<String>,
) -> Conversation {
    let now = chrono::Utc::now().timestamp_millis();

    Conversation {
        id: uuid::Uuid::new_v4().to_string(),
        title: "새 대화".to_string(),
        messages: Vec::new(),
        connection_id,
        database,
        created_at: now,
        updated_at: now,
        context: None,
    }
}

/// 대화 컨텍스트 업데이트 헬퍼
pub fn update_context_tables(conversation: &mut Conversation, tables: Vec<String>) {
    let ctx = conversation.context.get_or_insert_with(Default::default);
    ctx.used_tables = tables;
    ctx.tables_selected_at = conversation.messages.len();
}

/// 요약이 필요한지 확인
pub fn needs_summary(conversation: &Conversation) -> bool {
    const MAX_MESSAGES_BEFORE_SUMMARY: usize = 10;

    let msg_count = conversation.messages.len();

    if let Some(ref ctx) = conversation.context {
        if let Some(ref summary) = ctx.summary {
            let new_msgs = msg_count.saturating_sub(summary.summarized_until);
            return new_msgs > MAX_MESSAGES_BEFORE_SUMMARY;
        }
    }

    msg_count > MAX_MESSAGES_BEFORE_SUMMARY
}

/// Update conversation title based on first user message
pub fn generate_title(messages: &[ChatMessage]) -> String {
    messages
        .iter()
        .find(|m| m.role == "user")
        .map(|m| {
            let content = &m.content;
            let chars: Vec<char> = content.chars().collect();
            if chars.len() > 50 {
                format!("{}...", chars[..50].iter().collect::<String>())
            } else {
                content.clone()
            }
        })
        .unwrap_or_else(|| "새 대화".to_string())
}

/// Update conversation summary
pub fn update_conversation_summary(conversation_id: &str, summary: ChatSummary) -> Result<(), String> {
    let mut conversation = load_conversation(conversation_id)?;

    let ctx = conversation.context.get_or_insert_with(Default::default);
    ctx.summary = Some(summary);

    save_conversation(&conversation)
}
