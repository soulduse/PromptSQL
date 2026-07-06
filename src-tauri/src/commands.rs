use crate::ai::{
    config as ai_config,
    conversations::{self, ChatSummary, Conversation, ConversationSummary},
    provider::{ChatMessage, LLMProvider, ModelInfo, ProviderType},
    prompt,
    rag::{
        self, compute_schema_hash, ColumnInfo as RagColumnInfo, IndexInfo as RagIndexInfo,
        IndexingStatus, SharedRAGManager,
    },
    router, streaming, SharedAIManager,
};
use crate::db::{
    generate_alter_column_sql, table_ops, ColumnInfo, ConnectionConfig, ConnectionResult,
    IndexInfo, QueryResult, SharedConnectionManager, TableDetailInfo, TableSummary,
    UpdateColumnRequest,
};
use crate::storage::{self, ConnectionWithPassword};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex as StdMutex;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Serialize, Deserialize)]
pub struct TestConnectionRequest {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: Option<String>,
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to PromptSQL.", name)
}

#[tauri::command]
pub async fn test_connection(
    manager: State<'_, SharedConnectionManager>,
    config: TestConnectionRequest,
) -> Result<ConnectionResult, String> {
    let conn_config = ConnectionConfig {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
    };

    let manager = manager.lock().await;
    Ok(manager.test_connection(&conn_config).await)
}

#[tauri::command]
pub async fn connect_database(
    manager: State<'_, SharedConnectionManager>,
    id: String,
    config: TestConnectionRequest,
) -> Result<ConnectionResult, String> {
    let conn_config = ConnectionConfig {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
    };

    let mut manager = manager.lock().await;
    Ok(manager.connect(id, &conn_config).await)
}

#[tauri::command]
pub async fn disconnect_database(
    manager: State<'_, SharedConnectionManager>,
    id: String,
) -> Result<bool, String> {
    let mut manager = manager.lock().await;
    Ok(manager.disconnect(&id).await)
}

#[tauri::command]
pub async fn execute_query(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: Option<String>,
    query: String,
) -> Result<QueryResult, String> {
    // DB별 풀을 짧은 락으로 획득 — USE 오염 없이 기본 스키마가 결정된다
    let pool = {
        let mut manager = manager.lock().await;
        manager.get_pool_for_db(&connection_id, database.as_deref())?
    };

    // Execute query on the cloned pool without holding the manager lock
    crate::db::execute_query_on_pool(&pool, &query, Some(&connection_id)).await
}

#[tauri::command]
pub async fn cancel_query(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
) -> Result<u32, String> {
    // 풀을 우회하는 단독 커넥션으로 KILL — 풀이 고갈된 상황에서도 동작
    let opts = {
        let manager = manager.lock().await;
        manager.standalone_opts(&connection_id)?
    };

    crate::db::cancel_query_with_opts(opts, &connection_id).await
}

/// manager 락을 짧게 잡고 풀 클론만 꺼내는 공용 헬퍼
async fn clone_pool(
    manager: &State<'_, SharedConnectionManager>,
    connection_id: &str,
) -> Result<mysql_async::Pool, String> {
    let manager = manager.lock().await;
    manager
        .get_pool(connection_id)
        .cloned()
        .ok_or_else(|| "Connection not found".to_string())
}

// Table browsing/editing commands (parameter-bound; replaces frontend SQL assembly)

#[tauri::command]
pub async fn fetch_table_rows(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
    filter: Option<table_ops::TableFilter>,
    sort: Option<table_ops::TableSort>,
    limit: Option<u32>,
) -> Result<QueryResult, String> {
    let pool = clone_pool(&manager, &connection_id).await?;
    table_ops::fetch_table_rows(
        &pool,
        &database,
        &table,
        filter.as_ref(),
        sort.as_ref(),
        limit,
        Some(&connection_id),
    )
    .await
}

#[tauri::command]
pub async fn get_primary_keys(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<Vec<String>, String> {
    let pool = clone_pool(&manager, &connection_id).await?;
    table_ops::get_primary_key_columns(&pool, &database, &table).await
}

#[tauri::command]
pub async fn update_table_cell(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
    column: String,
    value: serde_json::Value,
    row: Vec<table_ops::ColumnValue>,
) -> Result<u64, String> {
    let pool = clone_pool(&manager, &connection_id).await?;
    table_ops::update_table_cell(&pool, &database, &table, &column, &value, &row).await
}

#[tauri::command]
pub async fn insert_table_row(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
    values: Vec<table_ops::ColumnValue>,
) -> Result<u64, String> {
    let pool = clone_pool(&manager, &connection_id).await?;
    table_ops::insert_table_row(&pool, &database, &table, &values).await
}

#[tauri::command]
pub async fn delete_table_rows(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
    rows: Vec<Vec<table_ops::ColumnValue>>,
) -> Result<u64, String> {
    let pool = clone_pool(&manager, &connection_id).await?;
    table_ops::delete_table_rows(&pool, &database, &table, &rows).await
}

#[tauri::command]
pub async fn get_databases(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    let manager = manager.lock().await;
    manager.get_databases(&connection_id).await
}

#[tauri::command]
pub async fn get_tables(
    manager: State<'_, SharedConnectionManager>,
    rag_manager: State<'_, SharedRAGManager>,
    app_handle: AppHandle,
    connection_id: String,
    database: String,
) -> Result<Vec<String>, String> {
    let tables = {
        let manager = manager.lock().await;
        manager.get_tables(&connection_id, &database).await?
    };

    // RAG 관련 처리 (스키마 학습 제안)
    // 스키마 변경 감지는 별도의 check_rag_schema_changes 명령으로 처리
    let indexing_status = {
        let rag = rag_manager.read().await;
        rag.get_indexing_status(&connection_id, &database)
    };

    // NotStarted일 때만 제안 (이미 동의했거나 진행 중이면 무시)
    // 테이블 개수 관계없이 최초 1회는 RAG 학습 제안
    if matches!(indexing_status, IndexingStatus::NotStarted) {
        // Gemini API 키가 있을 때만 제안
        if ai_config::get_api_key(&ProviderType::Gemini).is_ok() {
            // 프론트엔드에 RAG 제안 이벤트 전송
            let _ = app_handle.emit(
                "rag-suggest",
                serde_json::json!({
                    "connection_id": connection_id,
                    "database": database,
                    "table_count": tables.len()
                }),
            );
        }
    }

    Ok(tables)
}

#[tauri::command]
pub async fn get_table_schema(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    let manager = manager.lock().await;
    manager.get_table_schema(&connection_id, &database, &table).await
}

#[tauri::command]
pub async fn get_table_detail_info(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<TableDetailInfo, String> {
    let manager = manager.lock().await;
    manager.get_table_detail_info(&connection_id, &database, &table).await
}

#[tauri::command]
pub async fn get_table_indexes(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<Vec<IndexInfo>, String> {
    let manager = manager.lock().await;
    manager.get_table_indexes(&connection_id, &database, &table).await
}

#[tauri::command]
pub async fn get_create_table(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<String, String> {
    let manager = manager.lock().await;
    manager.get_create_table(&connection_id, &database, &table).await
}

#[tauri::command]
pub async fn get_table_summary(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<TableSummary, String> {
    let manager = manager.lock().await;
    manager.get_table_summary(&connection_id, &database, &table).await
}

#[tauri::command]
pub async fn update_column(
    manager: State<'_, SharedConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
    request: UpdateColumnRequest,
) -> Result<(), String> {
    let manager = manager.lock().await;
    manager.update_column(&connection_id, &database, &table, &request).await
}

#[tauri::command]
pub fn preview_alter_column_sql(
    database: String,
    table: String,
    request: UpdateColumnRequest,
) -> Result<String, String> {
    generate_alter_column_sql(&database, &table, &request)
}

// Storage commands

/// 저장된 연결 목록 — 비밀번호는 포함하지 않는다 (Keychain은 백엔드 전용)
#[tauri::command]
pub fn load_saved_connections() -> Result<Vec<storage::StoredConnection>, String> {
    storage::load_connections()
}

/// 저장된 연결로 접속 — 비밀번호를 백엔드가 Keychain에서 직접 읽어
/// 프론트엔드를 경유하지 않는다.
#[tauri::command]
pub async fn connect_saved_database(
    manager: State<'_, SharedConnectionManager>,
    id: String,
) -> Result<ConnectionResult, String> {
    let stored = storage::load_connections()?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or("Connection not found")?;

    let password = storage::get_password(&id).unwrap_or_default();

    let conn_config = ConnectionConfig {
        host: stored.host,
        port: stored.port,
        user: stored.user,
        password,
        database: stored.database,
    };

    let mut manager = manager.lock().await;
    Ok(manager.connect(id, &conn_config).await)
}

#[tauri::command]
pub fn save_connection(connection: ConnectionWithPassword) -> Result<(), String> {
    storage::save_connection(&connection)
}

#[tauri::command]
pub fn delete_saved_connection(connection_id: String) -> Result<(), String> {
    storage::delete_connection(&connection_id)
}

#[tauri::command]
pub fn update_last_database(connection_id: String, database: String) -> Result<(), String> {
    storage::update_last_database(&connection_id, &database)
}

// History commands

#[tauri::command]
pub fn get_query_history() -> Result<Vec<storage::QueryHistory>, String> {
    storage::load_history()
}

#[tauri::command]
pub fn add_query_history(history: storage::QueryHistory) -> Result<storage::QueryHistory, String> {
    storage::add_history(history)
}

#[tauri::command]
pub fn delete_query_history(id: String) -> Result<(), String> {
    storage::delete_history(&id)
}

#[tauri::command]
pub fn update_query_history(
    id: String,
    note: Option<String>,
    group_id: Option<Option<String>>,
) -> Result<(), String> {
    storage::update_history(&id, note, group_id)
}

#[tauri::command]
pub fn search_query_history(query: String) -> Result<Vec<storage::QueryHistory>, String> {
    let groups = storage::load_groups()?;
    storage::search_history(&query, &groups)
}

// History groups commands

#[tauri::command]
pub fn get_history_groups() -> Result<Vec<storage::HistoryGroup>, String> {
    storage::load_groups()
}

#[tauri::command]
pub fn create_history_group(name: String, description: Option<String>) -> Result<storage::HistoryGroup, String> {
    storage::create_group(&name, description)
}

#[tauri::command]
pub fn update_history_group(
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
) -> Result<(), String> {
    storage::update_group(&id, name, description)
}

#[tauri::command]
pub fn delete_history_group(id: String) -> Result<(), String> {
    storage::delete_group(&id)
}

// AI commands

#[tauri::command]
pub fn save_ai_api_key(provider: ProviderType, api_key: String) -> Result<(), String> {
    ai_config::store_api_key(&provider, &api_key)
}

#[tauri::command]
pub fn delete_ai_api_key(provider: ProviderType) -> Result<(), String> {
    ai_config::delete_api_key(&provider)
}

#[tauri::command]
pub fn has_ai_api_key(provider: ProviderType) -> bool {
    ai_config::has_api_key(&provider)
}

/// Get API key status for all providers in a single call (minimizes Keychain access)
#[tauri::command]
pub fn get_all_api_key_status() -> std::collections::HashMap<String, bool> {
    ai_config::get_all_api_key_status()
}

#[tauri::command]
pub async fn get_available_models(
    ai_manager: State<'_, SharedAIManager>,
) -> Result<Vec<ModelInfo>, String> {
    let manager = ai_manager.lock().await;

    // Collect models from all providers
    let mut models = Vec::new();
    models.extend(manager.openai.available_models());
    models.extend(manager.anthropic.available_models());
    models.extend(manager.gemini.available_models());
    models.extend(manager.ollama.available_models());

    Ok(models)
}

#[tauri::command]
pub async fn set_ai_provider(
    ai_manager: State<'_, SharedAIManager>,
    provider: ProviderType,
    model: String,
) -> Result<(), String> {
    let mut manager = ai_manager.lock().await;
    manager.set_provider(provider, model);

    // Reload API key for the new provider
    if let Ok(key) = ai_config::get_api_key(&provider) {
        manager.get_provider_mut(&provider).set_api_key(key);
    }

    Ok(())
}

#[tauri::command]
pub async fn test_ai_connection(
    ai_manager: State<'_, SharedAIManager>,
    provider: ProviderType,
) -> Result<bool, String> {
    let mut manager = ai_manager.lock().await;

    // Load API key from secure storage before testing
    if let Ok(key) = ai_config::get_api_key(&provider) {
        manager.get_provider_mut(&provider).set_api_key(key);
    }

    let result = match provider {
        ProviderType::OpenAI => manager.openai.test_connection().await,
        ProviderType::Anthropic => manager.anthropic.test_connection().await,
        ProviderType::Gemini => manager.gemini.test_connection().await,
        ProviderType::Ollama => manager.ollama.test_connection().await,
    };

    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn verify_ai_api_key(
    ai_manager: State<'_, SharedAIManager>,
    provider: ProviderType,
    api_key: Option<String>,
) -> Result<bool, String> {
    let mut manager = ai_manager.lock().await;

    // Use provided key or load from storage
    let key = if let Some(k) = api_key {
        if k.trim().is_empty() {
            // If empty, try to load from storage
            ai_config::get_api_key(&provider).map_err(|e| e.to_string())?
        } else {
            k
        }
    } else {
        ai_config::get_api_key(&provider).map_err(|e| e.to_string())?
    };

    // Set the key temporarily for testing
    manager.get_provider_mut(&provider).set_api_key(key);

    let result = match provider {
        ProviderType::OpenAI => manager.openai.test_connection().await,
        ProviderType::Anthropic => manager.anthropic.test_connection().await,
        ProviderType::Gemini => manager.gemini.test_connection().await,
        ProviderType::Ollama => manager.ollama.test_connection().await,
    };

    result.map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub conversation_id: Option<String>,
    pub message: String,
    pub connection_id: Option<String>,
    pub database: Option<String>,
    #[serde(default)]
    pub is_retry: bool,
    #[serde(default)]
    pub auto_mode: bool,
    /// 신뢰 토글: true면 안전성 검사를 통과한 읽기 쿼리를 승인 없이 실행
    #[serde(default)]
    pub auto_approve: bool,
    /// 프론트 생성 요청 ID — 탭별 스트림 라우팅과 취소에 사용.
    /// (send_ai_message는 스트림 완료까지 반환하지 않으므로 백엔드 생성
    /// ID로는 프론트가 진행 중 스트림을 식별할 수 없다)
    #[serde(default)]
    pub request_id: Option<String>,
}

/// 요약 생성 응답 파싱용 구조체
#[derive(Debug, Deserialize)]
struct SummaryResponse {
    summary: String,
    #[serde(default)]
    tables: Vec<String>,
    #[serde(default)]
    key_conditions: Vec<String>,
}

/// 백그라운드에서 대화 요약 생성 및 저장
async fn generate_and_save_summary(
    conversation_id: String,
    ai_manager: SharedAIManager,
) {
    // 1. Load conversation
    let conversation = match conversations::load_conversation(&conversation_id) {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to load conversation for summary: {}", e);
            return;
        }
    };

    // 2. Check if summary is needed
    if !conversations::needs_summary(&conversation) {
        return;
    }

    // 3. Calculate message range to summarize
    let end_idx = conversation.messages.len().saturating_sub(3); // Keep last 3 messages raw
    let start_idx = conversation
        .context
        .as_ref()
        .and_then(|c| c.summary.as_ref())
        .map(|s| s.summarized_until)
        .unwrap_or(0);

    if start_idx >= end_idx {
        return; // Nothing to summarize
    }

    let messages_to_summarize: Vec<ChatMessage> = conversation.messages[start_idx..end_idx]
        .iter()
        .filter(|m| m.role != "system")
        .cloned()
        .collect();

    if messages_to_summarize.is_empty() {
        return;
    }

    // 4. Build summary request messages
    let summary_messages = prompt::build_summary_messages(&messages_to_summarize);

    // 5. Call AI for summary (using oneshot)
    let summary_text = {
        let snapshot = { ai_manager.lock().await.snapshot() };
        match snapshot.complete_oneshot(summary_messages).await {
            Ok(text) => text,
            Err(e) => {
                log::error!("Failed to generate summary: {}", e);
                return;
            }
        }
    };

    // 6. Parse JSON response
    let parsed = match parse_summary_response(&summary_text) {
        Some(p) => p,
        None => {
            log::warn!("Failed to parse summary response, using raw text");
            SummaryResponse {
                summary: summary_text.chars().take(500).collect(),
                tables: vec![],
                key_conditions: vec![],
            }
        }
    };

    // 7. Create ChatSummary
    let chat_summary = ChatSummary {
        text: parsed.summary,
        summarized_until: end_idx,
        tables: parsed.tables,
        key_conditions: parsed.key_conditions,
        created_at: chrono::Utc::now().timestamp(),
    };

    // 8. Save summary
    if let Err(e) = conversations::update_conversation_summary(&conversation_id, chat_summary) {
        log::error!("Failed to save conversation summary: {}", e);
    } else {
        log::info!("Summary saved for conversation: {}", conversation_id);
    }
}

/// 요약 응답에서 JSON 파싱
fn parse_summary_response(response: &str) -> Option<SummaryResponse> {
    let trimmed = response.trim();

    // Try to find JSON object in the response
    let json_str = if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            &trimmed[start..=end]
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    serde_json::from_str(json_str).ok()
}

#[tauri::command]
pub async fn send_ai_message(
    app: AppHandle,
    ai_manager: State<'_, SharedAIManager>,
    conn_manager: State<'_, SharedConnectionManager>,
    rag_manager: State<'_, SharedRAGManager>,
    request: SendMessageRequest,
) -> Result<String, String> {
    // 프론트가 생성한 request_id를 우선 사용 (탭 라우팅·취소 식별자)
    let request_id = request
        .request_id
        .clone()
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let request_id_clone = request_id.clone();

    // 취소 토큰 등록 — 함수 종료 시 자동 해제
    let stream_guard = AiStreamGuard::register(&request_id);
    let cancel_token = stream_guard.token.clone();

    // Load or create conversation
    let mut conversation = if let Some(ref conv_id) = request.conversation_id {
        conversations::load_conversation(conv_id)?
    } else {
        conversations::create_conversation(request.connection_id.clone(), request.database.clone())
    };

    // Add user message only if this is not a retry (retry already has the message)
    if !request.is_retry {
        let user_message = ChatMessage {
            role: "user".to_string(),
            content: request.message.clone(),
        };
        conversation.messages.push(user_message);
    }

    // Update conversation title if this is the first message
    if conversation.messages.len() == 1 {
        conversation.title = conversations::generate_title(&conversation.messages);
    }

    // Save conversation
    conversation.updated_at = chrono::Utc::now().timestamp_millis();
    conversations::save_conversation(&conversation)?;

    let conversation_id = conversation.id.clone();

    // Build schema context based on @mentions, followup detection, RAG, or AI auto-selection
    let schema_result = build_schema_context_for_message(
        &app,
        &ai_manager.inner().clone(),
        &conn_manager,
        &rag_manager,
        &request.message,
        &conversation,
        request.connection_id.as_deref(),
        request.database.as_deref(),
        &request_id,
    )
    .await;

    // Update conversation context with selected tables
    if !schema_result.selected_tables.is_empty() {
        conversations::update_context_tables(&mut conversation, schema_result.selected_tables);
        // Save updated context
        conversations::save_conversation(&conversation)?;
    }

    // AUTO MODE: Execute queries and include results in response
    if request.auto_mode {
        return handle_auto_mode_message(
            &app,
            &ai_manager,
            &conn_manager,
            &request,
            &conversation,
            &schema_result.schema,
            &request_id,
            &cancel_token,
        )
        .await;
    }

    // Build messages with system prompt including schema context
    // Check if we need to include a summary for long conversations
    let summary_text = conversation
        .context
        .as_ref()
        .and_then(|ctx| ctx.summary.as_ref())
        .map(|s| s.text.as_str());

    let summarized_until = conversation
        .context
        .as_ref()
        .and_then(|ctx| ctx.summary.as_ref())
        .map(|s| s.summarized_until)
        .unwrap_or(0);

    // Get recent history (after summary point)
    let recent_history: Vec<ChatMessage> = conversation
        .messages
        .iter()
        .skip(summarized_until)
        .take(conversation.messages.len().saturating_sub(summarized_until + 1))
        .filter(|m| m.role != "system")
        .cloned()
        .collect();

    let messages = crate::ai::prompt::build_conversation_messages_with_summary(
        summary_text,
        &recent_history,
        &request.message,
        &schema_result.schema,
    );

    // Create channel for streaming
    let (sender, receiver) = mpsc::channel(100);

    // Clone conversation_id for the spawned task
    let conversation_id_clone = conversation_id.clone();
    let ai_manager_clone = ai_manager.inner().clone();

    // Spawn background task for streaming and saving the response
    let app_clone = app.clone();
    let app_for_event = app.clone();
    tokio::spawn(async move {
        let ai_response = streaming::stream_to_frontend(app_clone, request_id_clone, receiver).await;

        // Save the AI response to the conversation
        if !ai_response.is_empty() {
            log::debug!("AI response received, length: {} chars", ai_response.len());
            match conversations::load_conversation(&conversation_id_clone) {
                Ok(mut conv) => {
                    let assistant_message = ChatMessage {
                        role: "assistant".to_string(),
                        content: ai_response,
                    };
                    conv.messages.push(assistant_message);
                    conv.updated_at = chrono::Utc::now().timestamp_millis();
                    match conversations::save_conversation(&conv) {
                        Ok(_) => {
                            log::info!("AI response saved to conversation: {}", conversation_id_clone);
                            // Emit event to notify frontend that conversation was saved
                            let _ = app_for_event.emit("ai-conversation-saved", &conversation_id_clone);
                        }
                        Err(e) => {
                            log::error!("Failed to save AI response to conversation: {}", e);
                        }
                    }

                    // Trigger summary generation in background (non-blocking)
                    let conv_id = conversation_id_clone.clone();
                    let ai_mgr = ai_manager_clone.clone();
                    tokio::spawn(async move {
                        generate_and_save_summary(conv_id, ai_mgr).await;
                    });
                }
                Err(e) => {
                    log::error!("Failed to load conversation for saving: {}", e);
                }
            }
        } else {
            log::warn!("AI response is empty, not saving to conversation");
        }
    });

    // Model routing: select model based on query complexity
    // 스냅샷을 뜨고 락을 즉시 반납 — 스트리밍 내내 락을 잡으면
    // 다른 AI 커맨드가 전부 블로킹된다
    let (snapshot, current_provider) = {
        let manager = ai_manager.lock().await;
        (manager.snapshot(), *manager.current_provider())
    };

    let complexity = router::classify_complexity(&request.message);
    let available_models: Vec<String> = snapshot
        .provider
        .available_models()
        .iter()
        .map(|m| m.id.clone())
        .collect();

    let model_selection = router::select_model(
        complexity,
        &current_provider,
        &snapshot.model,
        &available_models,
    );

    // Use the selected model for completion.
    // 취소 시 future가 drop되어 HTTP 스트림이 중단되고, sender drop으로
    // stream_to_frontend가 종료를 프론트에 알린다.
    let completion = async {
        if model_selection.is_light_model {
            log::info!(
                "Using light model '{}' for simple query",
                model_selection.model
            );
            snapshot
                .complete_stream_with_model(&model_selection.model, messages, sender)
                .await
        } else {
            snapshot.complete_stream(messages, sender).await
        }
    };

    let result = tokio::select! {
        r = completion => r,
        _ = cancel_token.cancelled() => {
            log::info!("AI request {} cancelled by user", request_id);
            Ok(())
        }
    };

    if let Err(e) = result {
        streaming::emit_error(&app, &request_id, &e.to_string());
        return Err(e.to_string());
    }

    Ok(conversation_id)
}

/// AUTO mode event for query execution
#[derive(Clone, Serialize)]
struct AutoQueryEvent {
    request_id: String,
    query: String,
    reason: String,
    status: String, // "executing", "completed", "error"
    result: Option<crate::ai::auto_mode::AutoQueryResult>,
    error: Option<String>,
}

/// AUTO 모드 승인 대기 채널 레지스트리 (approval_id → responder)
static AUTO_APPROVALS: Lazy<StdMutex<HashMap<String, oneshot::Sender<bool>>>> =
    Lazy::new(|| StdMutex::new(HashMap::new()));

/// 진행 중 AI 스트림 취소 토큰 레지스트리 (request_id → token)
static ACTIVE_AI_STREAMS: Lazy<StdMutex<HashMap<String, tokio_util::sync::CancellationToken>>> =
    Lazy::new(|| StdMutex::new(HashMap::new()));

/// 스트림 등록/해제 RAII 가드
struct AiStreamGuard {
    request_id: String,
    token: tokio_util::sync::CancellationToken,
}

impl AiStreamGuard {
    fn register(request_id: &str) -> Self {
        let token = tokio_util::sync::CancellationToken::new();
        ACTIVE_AI_STREAMS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(request_id.to_string(), token.clone());
        Self {
            request_id: request_id.to_string(),
            token,
        }
    }
}

impl Drop for AiStreamGuard {
    fn drop(&mut self) {
        ACTIVE_AI_STREAMS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.request_id);
    }
}

/// 진행 중인 AI 요청을 백엔드에서 실제로 중단한다.
/// (기존 프론트 취소는 UI 상태만 정리하고 HTTP 스트림은 계속 소비했다)
#[tauri::command]
pub fn cancel_ai_request(request_id: String) -> Result<bool, String> {
    let token = ACTIVE_AI_STREAMS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&request_id);

    match token {
        Some(t) => {
            t.cancel();
            Ok(true)
        }
        None => Ok(false),
    }
}

/// 사용자 승인 요청에 대한 응답을 처리하는 커맨드 (승인 다이얼로그에서 호출)
#[tauri::command]
pub fn respond_auto_query(approval_id: String, approved: bool) -> Result<(), String> {
    let sender = AUTO_APPROVALS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&approval_id);

    match sender {
        Some(tx) => {
            // 수신 측이 이미 타임아웃으로 떠났어도 무해
            let _ = tx.send(approved);
            Ok(())
        }
        None => Err("Approval request not found or already handled".to_string()),
    }
}

/// 승인 대기 결과
enum ApprovalOutcome {
    Approved,
    Rejected,
    TimedOut,
}

/// AUTO 쿼리 실행 전 사용자 승인을 기다린다 (최대 120초).
async fn wait_for_auto_query_approval(
    app: &AppHandle,
    request_id: &str,
    query: &str,
    reason: &str,
) -> ApprovalOutcome {
    const APPROVAL_TIMEOUT_SECS: u64 = 120;

    let approval_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<bool>();
    AUTO_APPROVALS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(approval_id.clone(), tx);

    let _ = app.emit(
        "ai-status",
        serde_json::json!({
            "request_id": request_id,
            "status": "waiting_approval"
        }),
    );
    let _ = app.emit(
        "ai-auto-approval",
        serde_json::json!({
            "request_id": request_id,
            "approval_id": approval_id,
            "query": query,
            "reason": reason,
        }),
    );

    match tokio::time::timeout(std::time::Duration::from_secs(APPROVAL_TIMEOUT_SECS), rx).await {
        Ok(Ok(true)) => ApprovalOutcome::Approved,
        Ok(Ok(false)) => ApprovalOutcome::Rejected,
        // sender dropped (프론트 리스너 소멸 등) → 거부로 처리
        Ok(Err(_)) => ApprovalOutcome::Rejected,
        Err(_) => {
            AUTO_APPROVALS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&approval_id);
            ApprovalOutcome::TimedOut
        }
    }
}

/// Handle AUTO mode message - AI can execute SELECT queries
#[allow(clippy::too_many_arguments)]
async fn handle_auto_mode_message(
    app: &AppHandle,
    ai_manager: &State<'_, SharedAIManager>,
    conn_manager: &State<'_, SharedConnectionManager>,
    request: &SendMessageRequest,
    conversation: &Conversation,
    schema_context: &str,
    request_id: &str,
    cancel_token: &tokio_util::sync::CancellationToken,
) -> Result<String, String> {
    use crate::ai::auto_mode::{
        check_query_safety, extract_auto_query, format_result_for_ai, optimize_query,
        sanitize_auto_query_tags, AutoQueryResult, QuerySafetyResult, AUTO_MODE_MAX_QUERIES,
        AUTO_MODE_ROW_LIMIT,
    };

    // AUTO mode timeout: 90 seconds (사용자 승인 대기 시간은 제외)
    const AUTO_MODE_TIMEOUT_SECS: u64 = 90;
    let start_time = std::time::Instant::now();
    let mut approval_wait = std::time::Duration::ZERO;

    let conversation_id = conversation.id.clone();

    // Emit status: starting auto mode
    let _ = app.emit(
        "ai-status",
        serde_json::json!({
            "request_id": request_id,
            "status": "auto_mode_starting"
        }),
    );

    // Get recent history for context
    let recent_history: Vec<ChatMessage> = conversation
        .messages
        .iter()
        .filter(|m| m.role != "system")
        .cloned()
        .collect();

    // Build initial AUTO mode messages
    let mut messages =
        prompt::build_auto_mode_messages(&recent_history, &request.message, schema_context);

    let mut executed_queries: Vec<AutoQueryResult> = Vec::new();
    let mut final_response = String::new();
    let mut iteration = 0;
    let mut timed_out = false;
    let mut approval_timed_out = false;

    // AUTO mode loop
    loop {
        // Check timeout (승인 대기로 소요된 시간은 예산에서 제외)
        let effective_elapsed = start_time.elapsed().saturating_sub(approval_wait);
        if effective_elapsed.as_secs() > AUTO_MODE_TIMEOUT_SECS {
            log::warn!("AUTO mode timeout after {} seconds", effective_elapsed.as_secs());
            timed_out = true;
            break;
        }

        iteration += 1;
        if iteration > AUTO_MODE_MAX_QUERIES + 1 {
            log::warn!("AUTO mode max iterations reached");
            break;
        }

        // Emit status: generating
        let _ = app.emit(
            "ai-status",
            serde_json::json!({
                "request_id": request_id,
                "status": if iteration == 1 { "generating" } else { "auto_mode_continuing" }
            }),
        );

        // Get AI response (non-streaming for AUTO mode parsing)
        // Use higher token limit (2048) for AUTO mode to allow full responses with <auto_query> tags
        let ai_response = {
            let snapshot = { ai_manager.lock().await.snapshot() };
            let completion = snapshot.complete_oneshot_with_options(messages.clone(), 2048, None);
            let result = tokio::select! {
                r = completion => r,
                _ = cancel_token.cancelled() => {
                    log::info!("AUTO mode request {} cancelled by user", request_id);
                    // 프론트가 스트리밍 상태에서 빠져나오도록 종료 알림
                    let _ = app.emit(
                        "ai-stream",
                        streaming::AIStreamEvent {
                            request_id: request_id.to_string(),
                            content: String::new(),
                            done: true,
                            error: None,
                        },
                    );
                    return Ok(conversation_id);
                }
            };
            match result {
                Ok(response) => response,
                Err(e) => {
                    streaming::emit_error(app, request_id, &e.to_string());
                    return Err(e.to_string());
                }
            }
        };

        // Log the AI response for debugging (char 단위 절단 — 바이트 슬라이스는
        // 멀티바이트 경계에서 패닉)
        let response_preview: String = ai_response.chars().take(500).collect();
        log::info!("AUTO mode AI response (iteration {}): {}", iteration, response_preview);
        log::debug!("AUTO mode AI response full length: {} chars", ai_response.len());

        // Check for <auto_query> tag
        let auto_query_result = extract_auto_query(&ai_response);
        log::debug!("AUTO mode extract_auto_query result: {:?}", auto_query_result.is_some());

        if let Some(query_request) = auto_query_result {
            log::info!(
                "AUTO mode: AI requested query (iteration {}) - {}",
                iteration,
                query_request.query
            );

            // Emit query executing event
            let _ = app.emit(
                "ai-auto-query",
                AutoQueryEvent {
                    request_id: request_id.to_string(),
                    query: query_request.query.clone(),
                    reason: query_request.reason.clone(),
                    status: "executing".to_string(),
                    result: None,
                    error: None,
                },
            );

            // Safety check
            match check_query_safety(&query_request.query) {
                QuerySafetyResult::Safe(_) => {
                    // Optimize query (add LIMIT)
                    let (optimized_query, was_limited) =
                        optimize_query(&query_request.query, AUTO_MODE_ROW_LIMIT);

                    // 승인 게이트 — 신뢰 토글이 꺼져 있으면 실행 전 사용자 승인 필요
                    if !request.auto_approve {
                        let wait_start = std::time::Instant::now();
                        let outcome = wait_for_auto_query_approval(
                            app,
                            request_id,
                            &optimized_query,
                            &query_request.reason,
                        )
                        .await;
                        approval_wait += wait_start.elapsed();

                        match outcome {
                            ApprovalOutcome::Approved => {
                                log::info!("AUTO mode: Query approved by user (iteration {})", iteration);
                            }
                            ApprovalOutcome::Rejected => {
                                log::info!("AUTO mode: Query rejected by user (iteration {})", iteration);
                                let _ = app.emit(
                                    "ai-auto-query",
                                    AutoQueryEvent {
                                        request_id: request_id.to_string(),
                                        query: query_request.query.clone(),
                                        reason: query_request.reason.clone(),
                                        status: "rejected".to_string(),
                                        result: None,
                                        error: Some("사용자가 쿼리 실행을 거부했습니다.".to_string()),
                                    },
                                );

                                messages.push(ChatMessage {
                                    role: "assistant".to_string(),
                                    content: ai_response.clone(),
                                });
                                messages.push(ChatMessage {
                                    role: "user".to_string(),
                                    content: "[시스템: 사용자가 쿼리 실행을 거부했습니다] 쿼리를 실행하지 말고, 지금까지의 정보로 답변하거나 대안을 제시해주세요. 추가 쿼리는 요청하지 마세요.".to_string(),
                                });
                                continue;
                            }
                            ApprovalOutcome::TimedOut => {
                                log::warn!("AUTO mode: Approval wait timed out (iteration {})", iteration);
                                let _ = app.emit(
                                    "ai-auto-query",
                                    AutoQueryEvent {
                                        request_id: request_id.to_string(),
                                        query: query_request.query.clone(),
                                        reason: query_request.reason.clone(),
                                        status: "rejected".to_string(),
                                        result: None,
                                        error: Some("승인 대기 시간이 초과되었습니다.".to_string()),
                                    },
                                );
                                approval_timed_out = true;
                                break;
                            }
                        }
                    }

                    // Execute query
                    log::debug!("AUTO mode: Executing query (iteration {})", iteration);
                    let query_result = execute_auto_query(
                        conn_manager,
                        request.connection_id.as_deref(),
                        request.database.as_deref(),
                        &optimized_query,
                        &query_request.query,
                        was_limited,
                    )
                    .await;
                    log::info!(
                        "AUTO mode: Query executed (iteration {}), rows: {}, error: {:?}",
                        iteration,
                        query_result.row_count,
                        query_result.error
                    );

                    // Emit result event
                    let _ = app.emit(
                        "ai-auto-query",
                        AutoQueryEvent {
                            request_id: request_id.to_string(),
                            query: query_request.query.clone(),
                            reason: query_request.reason.clone(),
                            status: if query_result.error.is_some() {
                                "error"
                            } else {
                                "completed"
                            }
                            .to_string(),
                            result: Some(query_result.clone()),
                            error: query_result.error.clone(),
                        },
                    );

                    // Format result for AI context — DB 데이터에 섞인
                    // <auto_query> 태그는 무해화 후 재주입
                    let result_context = sanitize_auto_query_tags(&format_result_for_ai(&query_result));
                    executed_queries.push(query_result);

                    // Add result to messages and continue
                    messages.push(ChatMessage {
                        role: "assistant".to_string(),
                        content: ai_response.clone(),
                    });
                    messages.push(ChatMessage {
                        role: "user".to_string(),
                        content: format!(
                            "[시스템: 쿼리 실행 결과]\n{}\n\n위 결과를 바탕으로 답변해주세요.",
                            result_context
                        ),
                    });

                    continue;
                }
                QuerySafetyResult::Rejected(reason) => {
                    log::warn!("AUTO mode: Query rejected - {}", reason);

                    // Emit rejection event
                    let _ = app.emit(
                        "ai-auto-query",
                        AutoQueryEvent {
                            request_id: request_id.to_string(),
                            query: query_request.query.clone(),
                            reason: query_request.reason.clone(),
                            status: "rejected".to_string(),
                            result: None,
                            error: Some(reason.clone()),
                        },
                    );

                    // Add rejection to messages and continue for AI to respond appropriately
                    messages.push(ChatMessage {
                        role: "assistant".to_string(),
                        content: ai_response.clone(),
                    });
                    messages.push(ChatMessage {
                        role: "user".to_string(),
                        content: format!(
                            "[시스템: 쿼리 거부됨] {}\n\nAUTO 모드에서는 SELECT 쿼리만 실행할 수 있습니다. 사용자에게 이를 안내하고, 필요한 경우 쿼리를 제안해주세요.",
                            reason
                        ),
                    });

                    continue;
                }
            }
        } else {
            // No more queries - this is the final response
            log::info!("AUTO mode: No more queries, finalizing response (iteration {})", iteration);
            // Remove <auto_query> tags if any remain
            final_response = ai_response
                .replace("<auto_query>", "")
                .replace("</auto_query>", "");
            log::debug!("AUTO mode final_response length: {} chars", final_response.len());
            break;
        }
    }

    log::info!("AUTO mode: Loop completed, executed {} queries, timed_out: {}", executed_queries.len(), timed_out);

    // Handle timeout with no queries executed
    if timed_out && final_response.is_empty() && executed_queries.is_empty() {
        // Use marker for frontend translation
        streaming::emit_error(app, request_id, "[TIMEOUT_ERROR]");
        return Err("[TIMEOUT_ERROR]".to_string());
    }

    // 승인 대기 초과 + 실행 결과 없음 → 타임아웃으로 종료
    if approval_timed_out && final_response.is_empty() && executed_queries.is_empty() {
        streaming::emit_error(app, request_id, "[TIMEOUT_ERROR]");
        return Err("[TIMEOUT_ERROR]".to_string());
    }

    // If final_response is empty but we have query results, ask AI to summarize
    if final_response.is_empty() && !executed_queries.is_empty() {
        log::info!("AUTO mode: Generating summary for {} executed queries", executed_queries.len());

        // Build query results summary for AI
        let mut results_summary = String::new();
        for (i, result) in executed_queries.iter().enumerate() {
            results_summary.push_str(&format!(
                "쿼리 {}: {}\n결과: {} 행{}\n\n",
                i + 1,
                result.query,
                result.row_count,
                if result.was_limited { " (제한됨)" } else { "" }
            ));
        }

        // Add summary request to messages
        messages.push(ChatMessage {
            role: "user".to_string(),
            content: format!(
                "[시스템: 쿼리 실행 완료]\n\n{}\n\n위 쿼리 실행 결과를 바탕으로 사용자의 원래 질문에 대해 간단히 요약해서 답변해주세요. 추가 쿼리는 요청하지 마세요.",
                results_summary
            ),
        });

        // Get summary from AI (use higher token limit for detailed responses)
        let summary_response = {
            let snapshot = { ai_manager.lock().await.snapshot() };
            match snapshot.complete_oneshot_with_options(messages.clone(), 4096, None).await {
                Ok(response) => {
                    // Remove any auto_query tags from summary (AI shouldn't request more queries)
                    response
                        .replace("<auto_query>", "")
                        .replace("</auto_query>", "")
                        .split("<auto_query")
                        .next()
                        .unwrap_or(&response)
                        .trim()
                        .to_string()
                }
                Err(e) => {
                    log::warn!("AUTO mode: Failed to get summary, using fallback: {}", e);
                    "쿼리 실행이 완료되었습니다. 위 결과를 확인해주세요.".to_string()
                }
            }
        };

        log::info!("AUTO mode: Generated summary ({} chars)", summary_response.len());
        final_response = summary_response;
    }

    // Handle completely empty response (no queries, no text)
    if final_response.is_empty() && executed_queries.is_empty() {
        log::warn!("AUTO mode: AI returned completely empty response");
        streaming::emit_error(app, request_id, "AI가 응답을 생성하지 못했습니다. 다시 시도해주세요.");
        return Err("AI가 응답을 생성하지 못했습니다.".to_string());
    }

    // Final safety check: ensure we have a response when queries were executed
    if final_response.is_empty() && !executed_queries.is_empty() {
        log::warn!("AUTO mode: final_response still empty after all attempts, using fallback");
        final_response = if timed_out {
            "시간 초과로 요청이 중단되었습니다. 위 쿼리 실행 결과를 확인해주세요.".to_string()
        } else {
            "쿼리 실행이 완료되었습니다. 위 결과를 확인해주세요.".to_string()
        };
    }

    // Build final response with query results embedded
    let full_response = if timed_out || approval_timed_out {
        // Include timeout marker for frontend translation
        // Also include query results if any were executed
        let base_response = build_auto_mode_response(&final_response, &executed_queries);
        format!("{}\n\n[TIMEOUT_WARNING]", base_response)
    } else {
        build_auto_mode_response(&final_response, &executed_queries)
    };
    log::debug!("AUTO mode full_response length: {} chars", full_response.len());

    // Stream the final response to frontend
    log::info!("AUTO mode: Streaming response to frontend");
    stream_auto_mode_response(app, request_id, &full_response).await;

    // Save the response to conversation
    log::info!("AUTO mode: Saving response to conversation {}", conversation_id);
    save_auto_mode_response(&conversation_id, &full_response, ai_manager.inner().clone()).await;

    // Emit conversation saved event
    let _ = app.emit("ai-conversation-saved", &conversation_id);

    Ok(conversation_id)
}

/// Execute query for AUTO mode
async fn execute_auto_query(
    conn_manager: &State<'_, SharedConnectionManager>,
    connection_id: Option<&str>,
    database: Option<&str>,
    optimized_query: &str,
    original_query: &str,
    was_limited: bool,
) -> crate::ai::auto_mode::AutoQueryResult {
    use crate::ai::auto_mode::AutoQueryResult;

    let (Some(conn_id), Some(db)) = (connection_id, database) else {
        return AutoQueryResult {
            query: optimized_query.to_string(),
            original_query: Some(original_query.to_string()),
            columns: vec![],
            rows: vec![],
            row_count: 0,
            execution_time_ms: 0,
            was_limited,
            error: Some("데이터베이스 연결이 필요합니다.".to_string()),
        };
    };

    // Get database-scoped pool (USE 오염 없이 기본 스키마 지정)
    let pool = {
        let mut manager = conn_manager.lock().await;
        manager.get_pool_for_db(conn_id, Some(db))
    };

    let Ok(pool) = pool else {
        return AutoQueryResult {
            query: optimized_query.to_string(),
            original_query: Some(original_query.to_string()),
            columns: vec![],
            rows: vec![],
            row_count: 0,
            execution_time_ms: 0,
            was_limited,
            error: Some("연결을 찾을 수 없습니다.".to_string()),
        };
    };

    // Execute query
    match crate::db::execute_query_on_pool(&pool, optimized_query, Some(conn_id)).await {
        Ok(result) => {
            let row_count = result.rows.len();
            AutoQueryResult {
                query: optimized_query.to_string(),
                original_query: if optimized_query != original_query {
                    Some(original_query.to_string())
                } else {
                    None
                },
                columns: result.columns,
                rows: result.rows,
                row_count,
                execution_time_ms: result.execution_time_ms,
                was_limited,
                error: None,
            }
        }
        Err(e) => AutoQueryResult {
            query: optimized_query.to_string(),
            original_query: Some(original_query.to_string()),
            columns: vec![],
            rows: vec![],
            row_count: 0,
            execution_time_ms: 0,
            was_limited,
            error: Some(e),
        },
    }
}

/// Build final AUTO mode response with embedded query results
fn build_auto_mode_response(
    final_text: &str,
    executed_queries: &[crate::ai::auto_mode::AutoQueryResult],
) -> String {
    let mut response = String::new();

    // Add executed queries info at the beginning
    if !executed_queries.is_empty() {
        for (i, query_result) in executed_queries.iter().enumerate() {
            response.push_str(&format!(
                "<auto_query_result index=\"{}\">\n",
                i + 1
            ));
            response.push_str(&format!(
                "{{\"query\": {}, \"row_count\": {}, \"execution_time_ms\": {}, \"was_limited\": {}, \"error\": {}}}\n",
                serde_json::to_string(&query_result.query).unwrap_or_default(),
                query_result.row_count,
                query_result.execution_time_ms,
                query_result.was_limited,
                serde_json::to_string(&query_result.error).unwrap_or("null".to_string())
            ));
            response.push_str("</auto_query_result>\n\n");
        }
    }

    response.push_str(final_text);
    response
}

/// Stream AUTO mode response to frontend
async fn stream_auto_mode_response(app: &AppHandle, request_id: &str, response: &str) {
    // Send as a single chunk followed by done
    let _ = app.emit(
        "ai-stream",
        serde_json::json!({
            "request_id": request_id,
            "content": response,
            "done": false
        }),
    );

    let _ = app.emit(
        "ai-stream",
        serde_json::json!({
            "request_id": request_id,
            "content": "",
            "done": true
        }),
    );
}

/// Save AUTO mode response to conversation
async fn save_auto_mode_response(
    conversation_id: &str,
    response: &str,
    ai_manager: SharedAIManager,
) {
    match conversations::load_conversation(conversation_id) {
        Ok(mut conv) => {
            let assistant_message = ChatMessage {
                role: "assistant".to_string(),
                content: response.to_string(),
            };
            conv.messages.push(assistant_message);
            conv.updated_at = chrono::Utc::now().timestamp_millis();

            if let Err(e) = conversations::save_conversation(&conv) {
                log::error!("Failed to save AUTO mode response: {}", e);
            } else {
                log::info!("AUTO mode response saved to conversation: {}", conversation_id);

                // Trigger summary generation
                let conv_id = conversation_id.to_string();
                tokio::spawn(async move {
                    generate_and_save_summary(conv_id, ai_manager).await;
                });
            }
        }
        Err(e) => {
            log::error!("Failed to load conversation for AUTO mode save: {}", e);
        }
    }
}

/// 스키마 컨텍스트 빌드 결과
struct SchemaContextResult {
    schema: String,
    selected_tables: Vec<String>,
}

/// Build schema context based on @mentions in the message
/// If no mentions and DB is connected, uses RAG or AI to auto-select relevant tables
/// Priority: @mentions → followup detection → RAG search → AI auto-selection
async fn build_schema_context_for_message(
    app: &AppHandle,
    ai_manager: &SharedAIManager,
    conn_manager: &State<'_, SharedConnectionManager>,
    rag_manager: &State<'_, SharedRAGManager>,
    message: &str,
    conversation: &conversations::Conversation,
    connection_id: Option<&str>,
    database: Option<&str>,
    request_id: &str,
) -> SchemaContextResult {
    let (Some(conn_id), Some(db)) = (connection_id, database) else {
        return SchemaContextResult {
            schema: String::new(),
            selected_tables: vec![],
        };
    };

    // Extract @mentions from message
    let (has_all, mentioned_tables) = crate::ai::context::extract_mentioned_tables(message);

    // Case 1: @all means include all tables
    if has_all {
        let all_tables = {
            let manager = conn_manager.lock().await;
            manager.get_tables(conn_id, db).await.unwrap_or_default()
        };
        let schema = get_all_tables_schema(conn_manager, conn_id, db).await;
        return SchemaContextResult {
            schema,
            selected_tables: all_tables,
        };
    }

    // Case 2: If specific tables are mentioned, include only those
    if !mentioned_tables.is_empty() {
        let schema = get_tables_schema(conn_manager, conn_id, db, &mentioned_tables).await;
        return SchemaContextResult {
            schema,
            selected_tables: mentioned_tables,
        };
    }

    // Case 3: No mentions - check if it's a followup question
    if let Some(ref ctx) = conversation.context {
        if crate::ai::context::is_followup_question(message, ctx) {
            // Reuse previous tables - NO API call needed!
            log::info!(
                "Followup detected, reusing tables: {:?}",
                ctx.used_tables
            );

            // Emit "reusing_context" status to frontend
            let _ = app.emit(
                "ai-status",
                serde_json::json!({
                    "request_id": request_id,
                    "status": "reusing_context"
                }),
            );

            let schema = get_tables_schema(conn_manager, conn_id, db, &ctx.used_tables).await;
            return SchemaContextResult {
                schema,
                selected_tables: ctx.used_tables.clone(),
            };
        }
    }

    // Case 4: New topic - Try RAG search first, then AI auto-selection as fallback
    let all_tables = {
        let manager = conn_manager.lock().await;
        manager.get_tables(conn_id, db).await.unwrap_or_default()
    };

    if all_tables.is_empty() {
        return SchemaContextResult {
            schema: String::new(),
            selected_tables: vec![],
        };
    }

    // Try RAG search first if available
    let rag_result = {
        let rag_lock = rag_manager.read().await;
        let status = rag_lock.get_indexing_status(conn_id, db);
        if let IndexingStatus::Completed { store_name } = status {
            Some(store_name)
        } else {
            None
        }
    };

    let selected_tables = if let Some(store_name) = rag_result {
        // RAG is available - use it
        if let Ok(api_key) = ai_config::get_api_key(&ProviderType::Gemini) {
            // Emit "searching_via_rag" status to frontend
            let _ = app.emit(
                "ai-status",
                serde_json::json!({
                    "request_id": request_id,
                    "status": "searching_via_rag"
                }),
            );

            match rag::search_relevant_tables(&api_key, &store_name, message).await {
                Ok(tables) if !tables.is_empty() => {
                    log::info!("RAG found {} relevant tables: {:?}", tables.len(), tables);
                    tables
                }
                Ok(_) => {
                    log::info!("RAG returned no tables, falling back to AI selection");
                    // Emit "analyzing_tables" status for AI fallback
                    let _ = app.emit(
                        "ai-status",
                        serde_json::json!({
                            "request_id": request_id,
                            "status": "analyzing_tables"
                        }),
                    );
                    select_relevant_tables(ai_manager, message, &all_tables).await
                }
                Err(e) => {
                    log::warn!("RAG search failed: {}, falling back to AI selection", e);
                    // Emit "analyzing_tables" status for AI fallback
                    let _ = app.emit(
                        "ai-status",
                        serde_json::json!({
                            "request_id": request_id,
                            "status": "analyzing_tables"
                        }),
                    );
                    select_relevant_tables(ai_manager, message, &all_tables).await
                }
            }
        } else {
            // No Gemini API key - use AI selection
            let _ = app.emit(
                "ai-status",
                serde_json::json!({
                    "request_id": request_id,
                    "status": "analyzing_tables"
                }),
            );
            select_relevant_tables(ai_manager, message, &all_tables).await
        }
    } else {
        // RAG not available - use AI selection
        // Emit "analyzing_tables" status to frontend
        let _ = app.emit(
            "ai-status",
            serde_json::json!({
                "request_id": request_id,
                "status": "analyzing_tables"
            }),
        );
        select_relevant_tables(ai_manager, message, &all_tables).await
    };

    // Emit "generating" status to frontend
    let _ = app.emit(
        "ai-status",
        serde_json::json!({
            "request_id": request_id,
            "status": "generating"
        }),
    );

    if selected_tables.is_empty() {
        return SchemaContextResult {
            schema: String::new(),
            selected_tables: vec![],
        };
    }

    // Get schema for selected tables
    let schema = get_tables_schema(conn_manager, conn_id, db, &selected_tables).await;
    SchemaContextResult {
        schema,
        selected_tables,
    }
}

/// Use AI to select relevant tables based on user message
async fn select_relevant_tables(
    ai_manager: &SharedAIManager,
    message: &str,
    available_tables: &[String],
) -> Vec<String> {
    let messages = crate::ai::prompt::build_table_selection_messages(message, available_tables);

    let snapshot = { ai_manager.lock().await.snapshot() };
    match snapshot.complete_oneshot(messages).await {
        Ok(response) => parse_table_selection(&response, available_tables),
        Err(_) => {
            // Fallback: use first 5 tables
            available_tables.iter().take(5).cloned().collect()
        }
    }
}

/// Parse AI response to extract table names
fn parse_table_selection(response: &str, available_tables: &[String]) -> Vec<String> {
    // Try to extract JSON array from response (might have extra text)
    let trimmed = response.trim();

    // Find JSON array in the response
    let json_str = if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            &trimmed[start..=end]
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    // Try to parse as JSON array
    if let Ok(tables) = serde_json::from_str::<Vec<String>>(json_str) {
        let selected: Vec<String> = tables
            .into_iter()
            .filter(|t| {
                available_tables
                    .iter()
                    .any(|a| a.eq_ignore_ascii_case(t))
            })
            .collect();

        if !selected.is_empty() {
            return selected;
        }
    }

    // Fallback: extract table names by keyword matching
    available_tables
        .iter()
        .filter(|t| response.to_lowercase().contains(&t.to_lowercase()))
        .cloned()
        .collect()
}

/// Get schema for specific tables
async fn get_tables_schema(
    conn_manager: &State<'_, SharedConnectionManager>,
    conn_id: &str,
    db: &str,
    tables: &[String],
) -> String {
    let manager = conn_manager.lock().await;
    let mut table_schemas = Vec::new();

    for table_name in tables {
        if let Ok(columns) = manager.get_table_schema(conn_id, db, table_name).await {
            table_schemas.push((table_name.clone(), columns));
        }
    }

    crate::ai::context::build_schema_context(&table_schemas)
}

/// Get schema for all tables in the database
async fn get_all_tables_schema(
    conn_manager: &State<'_, SharedConnectionManager>,
    conn_id: &str,
    db: &str,
) -> String {
    let manager = conn_manager.lock().await;

    let Ok(tables) = manager.get_tables(conn_id, db).await else {
        return String::new();
    };

    let mut table_schemas = Vec::new();
    for table_name in tables {
        if let Ok(columns) = manager.get_table_schema(conn_id, db, &table_name).await {
            table_schemas.push((table_name, columns));
        }
    }

    crate::ai::context::build_schema_context(&table_schemas)
}

#[tauri::command]
pub fn get_conversations() -> Result<Vec<ConversationSummary>, String> {
    conversations::list_conversations()
}

#[tauri::command]
pub fn get_conversation(id: String) -> Result<Conversation, String> {
    conversations::load_conversation(&id)
}

#[tauri::command]
pub fn delete_conversation(id: String) -> Result<(), String> {
    conversations::delete_conversation(&id)
}

#[tauri::command]
pub fn update_conversation(conversation: Conversation) -> Result<(), String> {
    conversations::save_conversation(&conversation)
}

// ============================================================
// RAG Pre-indexing
// ============================================================

/// RAG 인덱싱 시작 (백그라운드)
async fn start_rag_indexing(
    connection_id: String,
    database: String,
    tables: Vec<String>,
    rag_manager: SharedRAGManager,
    conn_manager: SharedConnectionManager,
    app_handle: AppHandle,
) {
    log::info!(
        "Starting RAG indexing for {}:{} ({} tables)",
        connection_id,
        database,
        tables.len()
    );

    // 1. 상태 업데이트: InProgress
    {
        let mut manager = rag_manager.write().await;
        manager.set_indexing_status(&connection_id, &database, IndexingStatus::InProgress);
    }

    // 2. 프론트엔드에 알림
    let _ = app_handle.emit(
        "rag-indexing-status",
        serde_json::json!({
            "connection_id": connection_id,
            "database": database,
            "status": "in_progress"
        }),
    );

    // 3. Gemini API 키 확인
    let api_key = match ai_config::get_api_key(&ProviderType::Gemini) {
        Ok(key) => key,
        Err(e) => {
            log::warn!("Gemini API key not found, skipping RAG indexing: {}", e);

            // 프론트엔드에 Gemini API 키 필요 알림
            let _ = app_handle.emit(
                "rag-gemini-required",
                serde_json::json!({
                    "connection_id": connection_id,
                    "database": database
                }),
            );

            let mut manager = rag_manager.write().await;
            manager.set_indexing_status(
                &connection_id,
                &database,
                IndexingStatus::Failed {
                    error: "Gemini API key not configured".to_string(),
                },
            );
            return;
        }
    };

    // 4. 스키마 수집
    let schemas = collect_schemas_for_rag(&conn_manager, &connection_id, &database, &tables).await;

    if schemas.is_empty() {
        log::warn!("No schemas collected for RAG indexing");
        let mut manager = rag_manager.write().await;
        manager.set_indexing_status(
            &connection_id,
            &database,
            IndexingStatus::Failed {
                error: "No schemas to index".to_string(),
            },
        );
        return;
    }

    // 5. Store 생성
    let store_name = match rag::create_schema_store(&api_key, &connection_id, &database).await {
        Ok(name) => name,
        Err(e) => {
            log::error!("Failed to create RAG store: {}", e);
            let mut manager = rag_manager.write().await;
            manager.set_indexing_status(
                &connection_id,
                &database,
                IndexingStatus::Failed { error: e },
            );
            let _ = app_handle.emit(
                "rag-indexing-status",
                serde_json::json!({
                    "connection_id": connection_id,
                    "database": database,
                    "status": "failed",
                    "error": "Failed to create store"
                }),
            );
            return;
        }
    };

    // 6. 스키마 인덱싱
    if let Err(e) = rag::index_schema(&api_key, &store_name, schemas).await {
        log::error!("Failed to index schemas: {}", e);
        let mut manager = rag_manager.write().await;
        manager.set_indexing_status(
            &connection_id,
            &database,
            IndexingStatus::Failed { error: e.clone() },
        );
        let _ = app_handle.emit(
            "rag-indexing-status",
            serde_json::json!({
                "connection_id": connection_id,
                "database": database,
                "status": "failed",
                "error": e
            }),
        );
        return;
    }

    // 7. 스키마 해시 계산
    let schema_hashes =
        compute_all_schema_hashes(&conn_manager, &connection_id, &database, &tables).await;

    // 8. 성공
    let table_count = tables.len();
    log::info!(
        "RAG indexing completed for {}:{} (store: {}, {} tables)",
        connection_id,
        database,
        store_name,
        table_count
    );

    {
        let mut manager = rag_manager.write().await;
        manager.set_indexing_status(
            &connection_id,
            &database,
            IndexingStatus::Completed {
                store_name: store_name.clone(),
            },
        );
        // 인덱싱된 테이블 목록 저장 (변경 감지를 위해)
        manager.set_indexed_tables(&connection_id, &database, tables);
        // 스키마 해시 저장 (변경 감지를 위해)
        manager.set_schema_hashes(&connection_id, &database, schema_hashes);
    }

    let _ = app_handle.emit(
        "rag-indexing-status",
        serde_json::json!({
            "connection_id": connection_id,
            "database": database,
            "status": "completed",
            "store_name": store_name,
            "table_count": table_count
        }),
    );
}

/// 사용자가 동의한 후 RAG 인덱싱 시작하는 Tauri 명령
#[tauri::command]
pub async fn start_rag_indexing_cmd(
    rag_manager: State<'_, SharedRAGManager>,
    conn_manager: State<'_, SharedConnectionManager>,
    app_handle: AppHandle,
    connection_id: String,
    database: String,
) -> Result<(), String> {
    // 테이블 목록 가져오기
    let tables = {
        let mgr = conn_manager.lock().await;
        mgr.get_tables(&connection_id, &database).await?
    };

    let rag_clone = rag_manager.inner().clone();
    let conn_clone = conn_manager.inner().clone();

    // 백그라운드에서 인덱싱 시작
    tokio::spawn(async move {
        start_rag_indexing(connection_id, database, tables, rag_clone, conn_clone, app_handle).await;
    });

    Ok(())
}

/// RAG 인덱싱을 위한 스키마 수집
async fn collect_schemas_for_rag(
    conn_manager: &SharedConnectionManager,
    connection_id: &str,
    database: &str,
    tables: &[String],
) -> Vec<rag::SchemaDocument> {
    let mut schemas = Vec::new();
    let manager = conn_manager.lock().await;

    for table in tables {
        // DDL (CREATE TABLE) 가져오기
        let ddl = manager
            .get_create_table(connection_id, database, table)
            .await
            .unwrap_or_default();

        // 컬럼 정보 가져오기
        let columns: Vec<String> = manager
            .get_table_schema(connection_id, database, table)
            .await
            .unwrap_or_default()
            .iter()
            .map(|col| format!("{} ({})", col.field, col.column_type))
            .collect();

        if !ddl.is_empty() || !columns.is_empty() {
            schemas.push(rag::create_schema_document(table, &ddl, &columns));
        }
    }

    schemas
}

// ============================================================
// RAG Schema Change Detection
// ============================================================

/// 모든 테이블의 스키마 해시 계산
async fn compute_all_schema_hashes(
    conn_manager: &SharedConnectionManager,
    connection_id: &str,
    database: &str,
    tables: &[String],
) -> HashMap<String, String> {
    let mut hashes = HashMap::new();
    let manager = conn_manager.lock().await;

    for table in tables {
        // 컬럼 정보 가져오기
        let columns = manager
            .get_table_schema(connection_id, database, table)
            .await
            .unwrap_or_default();

        // 인덱스 정보 가져오기
        let indexes = manager
            .get_table_indexes(connection_id, database, table)
            .await
            .unwrap_or_default();

        // db::ColumnInfo를 rag::ColumnInfo로 변환
        let rag_columns: Vec<RagColumnInfo> = columns
            .iter()
            .map(|c| RagColumnInfo {
                name: c.field.clone(),
                data_type: c.column_type.clone(),
                is_nullable: c.is_nullable.to_uppercase() == "YES",
            })
            .collect();

        // db::IndexInfo를 rag::IndexInfo로 변환 (인덱스별로 그룹화)
        let mut idx_map: HashMap<String, (Vec<String>, bool)> = HashMap::new();
        for idx in &indexes {
            let entry = idx_map
                .entry(idx.key_name.clone())
                .or_insert_with(|| (Vec::new(), !idx.non_unique));
            entry.0.push(idx.column_name.clone());
        }

        let rag_indexes: Vec<RagIndexInfo> = idx_map
            .into_iter()
            .map(|(name, (mut columns, is_unique))| {
                // 인덱스 내 컬럼 순서를 정렬하여 결정적 해시 보장
                columns.sort();
                RagIndexInfo {
                    name,
                    columns,
                    is_unique,
                }
            })
            .collect();

        // 해시 계산
        let hash = compute_schema_hash(table, &rag_columns, &rag_indexes);
        hashes.insert(table.clone(), hash);
    }

    hashes
}

/// 스키마 변경 확인 명령 (사이드바 새로고침 또는 DB 연결 시 호출)
#[tauri::command]
pub async fn check_rag_schema_changes(
    manager: State<'_, SharedConnectionManager>,
    rag_manager: State<'_, SharedRAGManager>,
    app_handle: AppHandle,
    connection_id: String,
    database: String,
) -> Result<(), String> {
    // 1. 쿨다운 체크 (5분 내 재체크 방지)
    let should_check = {
        let rag = rag_manager.read().await;
        rag.should_check_schema(&connection_id, &database)
    };

    if !should_check {
        log::debug!(
            "Schema check skipped for {}:{} (cooldown)",
            connection_id,
            database
        );
        return Ok(());
    }

    // 2. 인덱싱 상태 확인
    let indexing_status = {
        let rag = rag_manager.read().await;
        rag.get_indexing_status(&connection_id, &database)
    };

    if !matches!(indexing_status, IndexingStatus::Completed { .. }) {
        return Ok(()); // 인덱싱 안된 경우 무시
    }

    // 3. 테이블 목록 조회
    let tables = {
        let mgr = manager.lock().await;
        mgr.get_tables(&connection_id, &database).await?
    };

    // 4. 스키마 해시 계산
    let current_hashes =
        compute_all_schema_hashes(&manager.inner().clone(), &connection_id, &database, &tables)
            .await;

    // 5. 변경 감지
    let changes = {
        let rag = rag_manager.read().await;
        rag.detect_schema_changes(&connection_id, &database, &current_hashes)
    };

    // 6. 마지막 체크 시간 갱신
    {
        let mut rag = rag_manager.write().await;
        rag.update_last_checked(&connection_id, &database);
    }

    // 7. 변경사항이 있으면 프론트엔드에 알림
    if let Some(changes) = changes {
        if changes.has_changes {
            log::info!(
                "RAG schema changes detected for {}:{} - added: {:?}, removed: {:?}, modified: {:?}",
                connection_id,
                database,
                changes.added_tables,
                changes.removed_tables,
                changes.modified_tables
            );
            let _ = app_handle.emit(
                "rag-outdated",
                serde_json::json!({
                    "connection_id": connection_id,
                    "database": database,
                    "added_tables": changes.added_tables,
                    "removed_tables": changes.removed_tables,
                    "modified_tables": changes.modified_tables
                }),
            );
        }
    }

    Ok(())
}

/// 증분 RAG 스키마 동기화 (변경된 테이블만 업데이트)
#[tauri::command]
pub async fn sync_rag_schema_incremental(
    rag_manager: State<'_, SharedRAGManager>,
    conn_manager: State<'_, SharedConnectionManager>,
    app_handle: AppHandle,
    connection_id: String,
    database: String,
    added_tables: Vec<String>,
    modified_tables: Vec<String>,
    removed_tables: Vec<String>,
) -> Result<(), String> {
    log::info!(
        "Starting incremental RAG sync for {}:{} - added: {}, modified: {}, removed: {}",
        connection_id,
        database,
        added_tables.len(),
        modified_tables.len(),
        removed_tables.len()
    );

    // 1. Store 이름 확인
    let store_name = {
        let rag = rag_manager.read().await;
        match rag.get_indexing_status(&connection_id, &database) {
            IndexingStatus::Completed { store_name } => store_name,
            _ => return Err("RAG indexing not completed for this database".to_string()),
        }
    };

    // 2. Gemini API 키 확인
    let api_key = ai_config::get_api_key(&ProviderType::Gemini)
        .map_err(|_| "Gemini API key not configured".to_string())?;

    // 3. 프론트엔드에 시작 알림
    let _ = app_handle.emit(
        "rag-sync-status",
        serde_json::json!({
            "connection_id": connection_id,
            "database": database,
            "status": "in_progress",
            "added": added_tables.len(),
            "modified": modified_tables.len(),
            "removed": removed_tables.len()
        }),
    );

    // 4. 스키마 수집 (추가/수정된 테이블만)
    let tables_to_collect: Vec<String> = added_tables
        .iter()
        .chain(modified_tables.iter())
        .cloned()
        .collect();

    let schemas = if !tables_to_collect.is_empty() {
        collect_schemas_for_rag(&conn_manager.inner().clone(), &connection_id, &database, &tables_to_collect).await
    } else {
        Vec::new()
    };

    // 스키마를 added와 modified로 분리
    let added_schemas: Vec<rag::SchemaDocument> = schemas
        .iter()
        .filter(|s| added_tables.contains(&s.table_name))
        .cloned()
        .collect();
    let modified_schemas: Vec<rag::SchemaDocument> = schemas
        .iter()
        .filter(|s| modified_tables.contains(&s.table_name))
        .cloned()
        .collect();

    // 5. 증분 동기화 실행
    let result = rag::incremental_sync_schema(
        &api_key,
        &store_name,
        added_schemas,
        modified_schemas,
        removed_tables.clone(),
    )
    .await;

    match result {
        Ok(sync_result) => {
            // 6. 스키마 해시 및 테이블 목록 업데이트
            let all_tables = {
                let mgr = conn_manager.lock().await;
                mgr.get_tables(&connection_id, &database).await.unwrap_or_default()
            };
            let new_hashes =
                compute_all_schema_hashes(&conn_manager.inner().clone(), &connection_id, &database, &all_tables).await;

            {
                let mut rag = rag_manager.write().await;
                rag.set_indexed_tables(&connection_id, &database, all_tables);
                rag.set_schema_hashes(&connection_id, &database, new_hashes);
            }

            // 7. 성공 알림
            let _ = app_handle.emit(
                "rag-sync-status",
                serde_json::json!({
                    "connection_id": connection_id,
                    "database": database,
                    "status": "completed",
                    "synced_added": sync_result.added,
                    "synced_modified": sync_result.modified,
                    "synced_removed": sync_result.removed,
                    "errors": sync_result.errors
                }),
            );

            log::info!(
                "Incremental RAG sync completed for {}:{}",
                connection_id,
                database
            );
            Ok(())
        }
        Err(e) => {
            let _ = app_handle.emit(
                "rag-sync-status",
                serde_json::json!({
                    "connection_id": connection_id,
                    "database": database,
                    "status": "failed",
                    "error": e
                }),
            );
            Err(e)
        }
    }
}
