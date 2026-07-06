//! RAG (Retrieval Augmented Generation) - Gemini File Search API 통합
//!
//! 테이블이 많은 DB에서 관련 테이블만 빠르게 찾기 위한 모듈
//! 참고: https://ai.google.dev/gemini-api/docs/file-search

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_UPLOAD_BASE: &str = "https://generativelanguage.googleapis.com/upload/v1beta";
const RAG_STATE_FILE: &str = "rag_state.json";

/// RAG 사용 임계값 (테이블 수)
pub const RAG_TABLE_THRESHOLD: usize = 30;

/// 인덱싱 상태
#[derive(Debug, Clone, PartialEq)]
pub enum IndexingStatus {
    NotStarted,
    InProgress,
    Completed { store_name: String },
    Failed { error: String },
}

impl Default for IndexingStatus {
    fn default() -> Self {
        Self::NotStarted
    }
}

/// 스키마 문서 (인덱싱용)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaDocument {
    pub table_name: String,
    pub ddl: String,
    pub columns: Vec<String>,
    pub description: Option<String>,
}

/// 스키마 변경 감지 결과 (테이블 + 컬럼/인덱스 변경 포함)
#[derive(Debug, Clone, Serialize)]
pub struct SchemaChangeResult {
    pub has_changes: bool,
    pub added_tables: Vec<String>,
    pub removed_tables: Vec<String>,
    pub modified_tables: Vec<String>,
}

/// 스키마 체크 쿨다운 (초) - 5분
const SCHEMA_CHECK_COOLDOWN_SECS: i64 = 300;

/// 영구 저장용 RAG 상태
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RAGPersistentState {
    /// 연결별 File Search Store 이름 (connection_id:database -> store_name)
    pub store_names: HashMap<String, String>,
    /// 인덱싱된 테이블 목록 (connection_id:database -> table names)
    pub indexed_tables: HashMap<String, Vec<String>>,
    /// 테이블별 스키마 해시 (connection_id:database -> (table_name -> hash))
    #[serde(default)]
    pub schema_hashes: HashMap<String, HashMap<String, String>>,
    /// 마지막 스키마 체크 시간 (connection_id:database -> Unix timestamp)
    #[serde(default)]
    pub last_checked: HashMap<String, i64>,
}

/// RAG 상태 파일 경로 반환
fn get_rag_state_path() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir()
        .ok_or("Failed to get data directory")?
        .join("promptsql");

    if !data_dir.exists() {
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;
    }

    Ok(data_dir.join(RAG_STATE_FILE))
}

/// RAG 상태 관리자
#[derive(Default)]
pub struct RAGManager {
    /// 연결별 인덱싱 상태 (connection_id:database -> status)
    indexing_status: HashMap<String, IndexingStatus>,
    /// 연결별 File Search Store 이름
    store_names: HashMap<String, String>,
    /// 인덱싱된 테이블 목록 (connection_id:database -> table names)
    indexed_tables: HashMap<String, Vec<String>>,
    /// 테이블별 스키마 해시 (connection_id:database -> (table_name -> hash))
    schema_hashes: HashMap<String, HashMap<String, String>>,
    /// 마지막 스키마 체크 시간 (connection_id:database -> Unix timestamp)
    last_checked: HashMap<String, i64>,
}

impl RAGManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// 파일에서 저장된 상태 로드
    pub fn load() -> Self {
        match get_rag_state_path() {
            Ok(path) => {
                if path.exists() {
                    match fs::read_to_string(&path) {
                        Ok(content) => {
                            match serde_json::from_str::<RAGPersistentState>(&content) {
                                Ok(state) => {
                                    log::info!("Loaded RAG state from {:?}", path);
                                    // 저장된 상태로 인덱싱 상태 복원
                                    let mut indexing_status = HashMap::new();
                                    for (key, store_name) in &state.store_names {
                                        indexing_status.insert(
                                            key.clone(),
                                            IndexingStatus::Completed {
                                                store_name: store_name.clone(),
                                            },
                                        );
                                    }
                                    return RAGManager {
                                        indexing_status,
                                        store_names: state.store_names,
                                        indexed_tables: state.indexed_tables,
                                        schema_hashes: state.schema_hashes,
                                        last_checked: state.last_checked,
                                    };
                                }
                                Err(e) => {
                                    log::warn!("Failed to parse RAG state: {}", e);
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("Failed to read RAG state file: {}", e);
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to get RAG state path: {}", e);
            }
        }
        Self::default()
    }

    /// 현재 상태를 파일에 저장
    pub fn save(&self) {
        let state = RAGPersistentState {
            store_names: self.store_names.clone(),
            indexed_tables: self.indexed_tables.clone(),
            schema_hashes: self.schema_hashes.clone(),
            last_checked: self.last_checked.clone(),
        };

        match get_rag_state_path() {
            Ok(path) => {
                match serde_json::to_string_pretty(&state) {
                    Ok(content) => {
                        if let Err(e) = crate::storage::write_atomic(&path, &content) {
                            log::error!("Failed to save RAG state: {}", e);
                        } else {
                            log::debug!("Saved RAG state to {:?}", path);
                        }
                    }
                    Err(e) => {
                        log::error!("Failed to serialize RAG state: {}", e);
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to get RAG state path: {}", e);
            }
        }
    }

    /// 연결 키 생성
    fn make_key(connection_id: &str, database: &str) -> String {
        format!("{}:{}", connection_id, database)
    }

    /// 인덱싱 상태 조회
    pub fn get_indexing_status(&self, connection_id: &str, database: &str) -> IndexingStatus {
        let key = Self::make_key(connection_id, database);
        self.indexing_status.get(&key).cloned().unwrap_or_default()
    }

    /// 인덱싱 상태 설정 (Completed 시 자동 저장)
    pub fn set_indexing_status(
        &mut self,
        connection_id: &str,
        database: &str,
        status: IndexingStatus,
    ) {
        let key = Self::make_key(connection_id, database);
        if let IndexingStatus::Completed { ref store_name } = status {
            self.store_names.insert(key.clone(), store_name.clone());
            // Completed 상태일 때만 저장 (영구 저장 대상)
            self.save();
        }
        self.indexing_status.insert(key, status);
    }

    /// Store 이름 조회
    pub fn get_store_name(&self, connection_id: &str, database: &str) -> Option<String> {
        let key = Self::make_key(connection_id, database);
        self.store_names.get(&key).cloned()
    }

    /// 인덱싱된 테이블 목록 저장 (자동 저장)
    pub fn set_indexed_tables(
        &mut self,
        connection_id: &str,
        database: &str,
        tables: Vec<String>,
    ) {
        let key = Self::make_key(connection_id, database);
        self.indexed_tables.insert(key, tables);
        // 테이블 목록 변경 시 저장
        self.save();
    }

    /// 인덱싱된 테이블 목록 조회
    pub fn get_indexed_tables(&self, connection_id: &str, database: &str) -> Option<&Vec<String>> {
        let key = Self::make_key(connection_id, database);
        self.indexed_tables.get(&key)
    }

    /// 스키마 해시 저장 (자동 저장)
    pub fn set_schema_hashes(
        &mut self,
        connection_id: &str,
        database: &str,
        hashes: HashMap<String, String>,
    ) {
        let key = Self::make_key(connection_id, database);
        self.schema_hashes.insert(key, hashes);
        self.save();
    }

    /// 스키마 해시 조회
    pub fn get_schema_hashes(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Option<&HashMap<String, String>> {
        let key = Self::make_key(connection_id, database);
        self.schema_hashes.get(&key)
    }

    /// 스키마 체크 필요 여부 (쿨다운 체크)
    pub fn should_check_schema(&self, connection_id: &str, database: &str) -> bool {
        let key = Self::make_key(connection_id, database);

        // 인덱싱되지 않은 경우 체크 불필요
        if !self.store_names.contains_key(&key) {
            return false;
        }

        // 마지막 체크 시간 확인
        if let Some(&last_check) = self.last_checked.get(&key) {
            let now = chrono::Utc::now().timestamp();
            let elapsed = now - last_check;
            if elapsed < SCHEMA_CHECK_COOLDOWN_SECS {
                log::debug!(
                    "Schema check skipped for {}: {} seconds since last check (cooldown: {})",
                    key,
                    elapsed,
                    SCHEMA_CHECK_COOLDOWN_SECS
                );
                return false;
            }
        }

        true
    }

    /// 마지막 체크 시간 갱신
    pub fn update_last_checked(&mut self, connection_id: &str, database: &str) {
        let key = Self::make_key(connection_id, database);
        let now = chrono::Utc::now().timestamp();
        self.last_checked.insert(key, now);
        self.save();
    }

    /// 스키마 변경 감지 (해시 기반)
    pub fn detect_schema_changes(
        &self,
        connection_id: &str,
        database: &str,
        current_hashes: &HashMap<String, String>,
    ) -> Option<SchemaChangeResult> {
        let key = Self::make_key(connection_id, database);

        // 저장된 해시가 없으면 None
        let stored_hashes = self.schema_hashes.get(&key)?;

        let mut added_tables = Vec::new();
        let mut removed_tables = Vec::new();
        let mut modified_tables = Vec::new();

        // 새로 추가된 테이블 또는 변경된 테이블
        for (table, hash) in current_hashes {
            match stored_hashes.get(table) {
                None => added_tables.push(table.clone()),
                Some(stored_hash) if stored_hash != hash => {
                    modified_tables.push(table.clone());
                }
                _ => {}
            }
        }

        // 삭제된 테이블
        for table in stored_hashes.keys() {
            if !current_hashes.contains_key(table) {
                removed_tables.push(table.clone());
            }
        }

        let has_changes =
            !added_tables.is_empty() || !removed_tables.is_empty() || !modified_tables.is_empty();

        Some(SchemaChangeResult {
            has_changes,
            added_tables,
            removed_tables,
            modified_tables,
        })
    }
}

pub type SharedRAGManager = Arc<RwLock<RAGManager>>;

/// SharedRAGManager 인스턴스 생성 (저장된 상태 로드)
pub fn create_rag_manager() -> SharedRAGManager {
    Arc::new(RwLock::new(RAGManager::load()))
}

/// RAG 사용 여부 판단
pub fn should_use_rag(table_count: usize) -> bool {
    table_count >= RAG_TABLE_THRESHOLD
}

/// 컬럼 정보 (스키마 해시 계산용)
#[derive(Debug, Clone)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
}

/// 인덱스 정보 (스키마 해시 계산용)
#[derive(Debug, Clone)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
}

/// 테이블 스키마 해시 계산
pub fn compute_schema_hash(
    table_name: &str,
    columns: &[ColumnInfo],
    indexes: &[IndexInfo],
) -> String {
    let mut hasher = Sha256::new();

    // 테이블명
    hasher.update(table_name.as_bytes());

    // 컬럼 정보 (정렬하여 순서 무관하게)
    let mut col_strs: Vec<String> = columns
        .iter()
        .map(|c| format!("{}:{}:{}", c.name, c.data_type, c.is_nullable))
        .collect();
    col_strs.sort();
    for col in col_strs {
        hasher.update(col.as_bytes());
    }

    // 인덱스 정보 (정렬하여 순서 무관하게)
    let mut idx_strs: Vec<String> = indexes
        .iter()
        .map(|i| format!("{}:{}:{}", i.name, i.columns.join(","), i.is_unique))
        .collect();
    idx_strs.sort();
    for idx in idx_strs {
        hasher.update(idx.as_bytes());
    }

    format!("{:x}", hasher.finalize())
}

// ============================================================
// Gemini File Search API 통합
// ============================================================

/// API 응답 구조체들
#[derive(Debug, Deserialize)]
struct CreateStoreResponse {
    name: String,
}

/// uploadToFileSearchStore 응답 (Long-running Operation)
#[derive(Debug, Deserialize)]
struct UploadOperationResponse {
    #[serde(default)]
    name: String,
    #[serde(default)]
    done: bool,
}

#[derive(Debug, Deserialize)]
struct GenerateContentResponse {
    #[serde(default)]
    candidates: Vec<Candidate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    #[serde(default)]
    grounding_metadata: Option<GroundingMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroundingMetadata {
    #[serde(default)]
    grounding_chunks: Vec<GroundingChunk>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroundingChunk {
    #[serde(default)]
    retrieved_context: Option<RetrievedContext>,
}

#[derive(Debug, Deserialize)]
struct RetrievedContext {
    #[serde(default)]
    uri: String,
    #[serde(default)]
    title: String,
}

/// File Search Store 생성
/// POST https://generativelanguage.googleapis.com/v1beta/fileSearchStores
pub async fn create_schema_store(
    api_key: &str,
    connection_id: &str,
    database: &str,
) -> Result<String, String> {
    let client = Client::new();
    let display_name = format!("{}_{}_schema", connection_id, database);

    let response = client
        .post(format!("{}/fileSearchStores", GEMINI_API_BASE))
        .query(&[("key", api_key)])
        .json(&json!({
            "displayName": display_name
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to create store: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Failed to create store: {} - {}", status, body));
    }

    let result: CreateStoreResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse store response: {}", e))?;

    Ok(result.name)
}

/// 스키마 문서 업로드 및 인덱싱
/// uploadToFileSearchStore를 사용하여 직접 FileSearchStore에 업로드
pub async fn index_schema(
    api_key: &str,
    store_name: &str,
    schemas: Vec<SchemaDocument>,
) -> Result<(), String> {
    let client = Client::new();

    for schema in schemas {
        // 1. 마크다운 컨텐츠 생성
        let content = schema_document_to_markdown(&schema);
        let file_name = format!("{}.md", schema.table_name);

        // 2. uploadToFileSearchStore로 직접 FileSearchStore에 업로드
        // POST https://generativelanguage.googleapis.com/upload/v1beta/{fileSearchStoreName}:uploadToFileSearchStore
        let form = reqwest::multipart::Form::new()
            .text(
                "metadata",
                serde_json::to_string(&json!({
                    "displayName": file_name.clone()
                }))
                .unwrap(),
            )
            .part(
                "file",
                reqwest::multipart::Part::bytes(content.into_bytes())
                    .file_name(file_name.clone())
                    .mime_str("text/markdown")
                    .unwrap(),
            );

        let upload_response = client
            .post(format!(
                "{}/{}:uploadToFileSearchStore",
                GEMINI_UPLOAD_BASE, store_name
            ))
            .query(&[("key", api_key)])
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Failed to upload file {}: {}", file_name, e))?;

        if !upload_response.status().is_success() {
            let status = upload_response.status();
            let body = upload_response.text().await.unwrap_or_default();
            // 업로드 실패는 경고만 출력하고 계속 진행
            log::warn!(
                "Failed to upload file {} to store: {} - {}",
                file_name, status, body
            );
            continue;
        }

        // 응답을 텍스트로 먼저 받아서 디버깅
        let response_text = upload_response
            .text()
            .await
            .map_err(|e| format!("Failed to read upload response: {}", e))?;

        log::debug!("Upload to store response for {}: {}", file_name, response_text);
    }

    Ok(())
}

/// 단일 스키마 문서 업로드 (증분 Sync용)
pub async fn upload_single_schema(
    api_key: &str,
    store_name: &str,
    schema: &SchemaDocument,
) -> Result<(), String> {
    let client = Client::new();
    let content = schema_document_to_markdown(schema);
    let file_name = format!("{}.md", schema.table_name);

    let form = reqwest::multipart::Form::new()
        .text(
            "metadata",
            serde_json::to_string(&json!({
                "displayName": file_name.clone()
            }))
            .unwrap(),
        )
        .part(
            "file",
            reqwest::multipart::Part::bytes(content.into_bytes())
                .file_name(file_name.clone())
                .mime_str("text/markdown")
                .unwrap(),
        );

    let response = client
        .post(format!(
            "{}/{}:uploadToFileSearchStore",
            GEMINI_UPLOAD_BASE, store_name
        ))
        .query(&[("key", api_key)])
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to upload file {}: {}", file_name, e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Failed to upload file {} to store: {} - {}",
            file_name, status, body
        ));
    }

    log::debug!("Uploaded schema for table: {}", schema.table_name);
    Ok(())
}

/// Store 내 파일 목록 조회 (증분 Sync용)
/// GET https://generativelanguage.googleapis.com/v1beta/{store_name}/files
#[derive(Debug, Deserialize)]
struct ListFilesResponse {
    #[serde(default)]
    files: Vec<StoreFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreFile {
    name: String,
    #[serde(default)]
    display_name: String,
}

pub async fn list_store_files(
    api_key: &str,
    store_name: &str,
) -> Result<Vec<(String, String)>, String> {
    let client = Client::new();

    let response = client
        .get(format!("{}/{}/files", GEMINI_API_BASE, store_name))
        .query(&[("key", api_key)])
        .send()
        .await
        .map_err(|e| format!("Failed to list store files: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Failed to list store files: {} - {}", status, body));
    }

    let result: ListFilesResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse list files response: {}", e))?;

    // (file_name, display_name) 튜플로 반환
    Ok(result
        .files
        .into_iter()
        .map(|f| (f.name, f.display_name))
        .collect())
}

/// Store에서 파일 삭제 (증분 Sync용)
/// DELETE https://generativelanguage.googleapis.com/v1beta/{file_name}
pub async fn delete_store_file(api_key: &str, file_name: &str) -> Result<(), String> {
    let client = Client::new();

    let response = client
        .delete(format!("{}/{}", GEMINI_API_BASE, file_name))
        .query(&[("key", api_key)])
        .send()
        .await
        .map_err(|e| format!("Failed to delete file {}: {}", file_name, e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Failed to delete file {}: {} - {}",
            file_name, status, body
        ));
    }

    log::debug!("Deleted file from store: {}", file_name);
    Ok(())
}

/// 증분 스키마 동기화
/// - 삭제된 테이블: Store에서 파일 삭제
/// - 수정된 테이블: 기존 파일 삭제 후 새로 업로드
/// - 추가된 테이블: 새로 업로드
pub async fn incremental_sync_schema(
    api_key: &str,
    store_name: &str,
    added_schemas: Vec<SchemaDocument>,
    modified_schemas: Vec<SchemaDocument>,
    removed_tables: Vec<String>,
) -> Result<IncrementalSyncResult, String> {
    let mut synced_added = 0;
    let mut synced_modified = 0;
    let mut synced_removed = 0;
    let mut errors = Vec::new();

    // 1. 삭제된 테이블 처리 - Store에서 파일 목록을 조회하여 삭제
    if !removed_tables.is_empty() {
        let files = list_store_files(api_key, store_name).await.unwrap_or_default();
        for table in &removed_tables {
            let file_display_name = format!("{}.md", table);
            if let Some((file_name, _)) = files.iter().find(|(_, dn)| dn == &file_display_name) {
                if let Err(e) = delete_store_file(api_key, file_name).await {
                    errors.push(format!("Failed to delete {}: {}", table, e));
                } else {
                    synced_removed += 1;
                }
            }
        }
    }

    // 2. 수정된 테이블 처리 - 기존 파일 삭제 후 새로 업로드
    if !modified_schemas.is_empty() {
        let files = if removed_tables.is_empty() {
            list_store_files(api_key, store_name).await.unwrap_or_default()
        } else {
            // 이미 조회했으면 재사용 (하지만 삭제 후 변경되었으므로 다시 조회)
            list_store_files(api_key, store_name).await.unwrap_or_default()
        };

        for schema in &modified_schemas {
            let file_display_name = format!("{}.md", schema.table_name);
            // 기존 파일 삭제
            if let Some((file_name, _)) = files.iter().find(|(_, dn)| dn == &file_display_name) {
                let _ = delete_store_file(api_key, file_name).await;
            }
            // 새로 업로드
            if let Err(e) = upload_single_schema(api_key, store_name, schema).await {
                errors.push(format!("Failed to update {}: {}", schema.table_name, e));
            } else {
                synced_modified += 1;
            }
        }
    }

    // 3. 추가된 테이블 처리 - 새로 업로드
    for schema in &added_schemas {
        if let Err(e) = upload_single_schema(api_key, store_name, schema).await {
            errors.push(format!("Failed to add {}: {}", schema.table_name, e));
        } else {
            synced_added += 1;
        }
    }

    log::info!(
        "Incremental sync completed: added={}, modified={}, removed={}, errors={}",
        synced_added,
        synced_modified,
        synced_removed,
        errors.len()
    );

    Ok(IncrementalSyncResult {
        added: synced_added,
        modified: synced_modified,
        removed: synced_removed,
        errors,
    })
}

/// 증분 Sync 결과
#[derive(Debug)]
pub struct IncrementalSyncResult {
    pub added: usize,
    pub modified: usize,
    pub removed: usize,
    pub errors: Vec<String>,
}

/// RAG 기반 테이블 검색
/// POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
/// with file_search tool
pub async fn search_relevant_tables(
    api_key: &str,
    store_name: &str,
    query: &str,
) -> Result<Vec<String>, String> {
    let client = Client::new();

    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [{
                "text": format!(
                    "다음 질문과 관련된 데이터베이스 테이블을 찾아주세요. 질문: {}",
                    query
                )
            }]
        }],
        "tools": [{
            "file_search": {
                "file_search_store_names": [store_name]
            }
        }]
    });

    let response = client
        .post(format!(
            "{}/models/gemini-2.5-flash:generateContent",
            GEMINI_API_BASE
        ))
        .query(&[("key", api_key)])
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to search tables: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Failed to search tables: {} - {}", status, body));
    }

    // 응답을 텍스트로 먼저 받아서 디버깅
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    log::info!("RAG search API response: {}", response_text);

    let result: GenerateContentResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse search response: {}", e))?;

    log::info!(
        "RAG search parsed - candidates: {}, has grounding: {:?}",
        result.candidates.len(),
        result.candidates.first().map(|c| c.grounding_metadata.is_some())
    );

    // grounding_chunks에서 테이블명 추출 (title 필드 사용)
    let tables: Vec<String> = result
        .candidates
        .iter()
        .filter_map(|c| c.grounding_metadata.as_ref())
        .flat_map(|m| m.grounding_chunks.iter())
        .filter_map(|chunk| chunk.retrieved_context.as_ref())
        .filter_map(|ctx| {
            // title에서 테이블명 추출 (예: "app_rankings.md" -> "app_rankings")
            // uri가 있으면 uri 사용, 없으면 title 사용
            if !ctx.uri.is_empty() {
                extract_table_name_from_uri(&ctx.uri)
            } else if !ctx.title.is_empty() {
                extract_table_name_from_title(&ctx.title)
            } else {
                None
            }
        })
        .collect::<std::collections::HashSet<_>>() // 중복 제거
        .into_iter()
        .collect();

    log::info!("RAG search extracted tables: {:?}", tables);

    Ok(tables)
}

/// URI에서 테이블명 추출 (예: "files/users.md" -> "users")
fn extract_table_name_from_uri(uri: &str) -> Option<String> {
    uri.split('/')
        .last()
        .and_then(|s| s.strip_suffix(".md"))
        .map(|s| s.to_string())
}

/// title에서 테이블명 추출 (예: "app_rankings.md" -> "app_rankings")
fn extract_table_name_from_title(title: &str) -> Option<String> {
    title
        .strip_suffix(".md")
        .map(|s| s.to_string())
        .or_else(|| Some(title.to_string()))
}

/// 스키마 문서 생성 헬퍼
pub fn create_schema_document(
    table_name: &str,
    ddl: &str,
    columns: &[String],
) -> SchemaDocument {
    SchemaDocument {
        table_name: table_name.to_string(),
        ddl: ddl.to_string(),
        columns: columns.to_vec(),
        description: None,
    }
}

/// 스키마 문서를 마크다운 형식으로 변환
pub fn schema_document_to_markdown(doc: &SchemaDocument) -> String {
    let mut md = format!("# Table: {}\n\n", doc.table_name);
    md.push_str("## DDL\n```sql\n");
    md.push_str(&doc.ddl);
    md.push_str("\n```\n\n");
    md.push_str("## Columns\n");
    for col in &doc.columns {
        md.push_str(&format!("- {}\n", col));
    }
    if let Some(ref desc) = doc.description {
        md.push_str(&format!("\n## Description\n{}\n", desc));
    }
    md
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_use_rag() {
        assert!(!should_use_rag(10));
        assert!(!should_use_rag(29));
        assert!(should_use_rag(30));
        assert!(should_use_rag(100));
    }

    #[test]
    fn test_rag_manager() {
        let mut manager = RAGManager::new();

        // 초기 상태
        assert_eq!(
            manager.get_indexing_status("conn1", "db1"),
            IndexingStatus::NotStarted
        );

        // 인덱싱 진행 중
        manager.set_indexing_status("conn1", "db1", IndexingStatus::InProgress);
        assert_eq!(
            manager.get_indexing_status("conn1", "db1"),
            IndexingStatus::InProgress
        );

        // 인덱싱 완료
        manager.set_indexing_status(
            "conn1",
            "db1",
            IndexingStatus::Completed {
                store_name: "test_store".to_string(),
            },
        );
        assert!(matches!(
            manager.get_indexing_status("conn1", "db1"),
            IndexingStatus::Completed { .. }
        ));
        assert_eq!(
            manager.get_store_name("conn1", "db1"),
            Some("test_store".to_string())
        );
    }

    #[test]
    fn test_schema_document_to_markdown() {
        let doc = SchemaDocument {
            table_name: "users".to_string(),
            ddl: "CREATE TABLE users (id INT PRIMARY KEY)".to_string(),
            columns: vec!["id".to_string(), "name".to_string()],
            description: Some("사용자 테이블".to_string()),
        };

        let md = schema_document_to_markdown(&doc);
        assert!(md.contains("# Table: users"));
        assert!(md.contains("CREATE TABLE users"));
        assert!(md.contains("- id"));
        assert!(md.contains("사용자 테이블"));
    }
}
