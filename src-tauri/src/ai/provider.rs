use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

/// AI Provider type
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    OpenAI,
    Anthropic,
    Gemini,
    Ollama,
}

impl std::fmt::Display for ProviderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderType::OpenAI => write!(f, "openai"),
            ProviderType::Anthropic => write!(f, "anthropic"),
            ProviderType::Gemini => write!(f, "gemini"),
            ProviderType::Ollama => write!(f, "ollama"),
        }
    }
}

/// Model information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub provider: ProviderType,
    pub max_tokens: u32,
    pub supports_streaming: bool,
}

/// Chat message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "system", "user", "assistant"
    pub content: String,
}

/// Completion request
#[derive(Debug, Clone)]
pub struct CompletionRequest {
    pub messages: Vec<ChatMessage>,
    pub model: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub stream: bool,
}

/// Streaming chunk
#[derive(Debug, Clone, Serialize)]
pub struct StreamChunk {
    pub content: String,
    pub done: bool,
}

/// AI Error types
#[derive(Debug, thiserror::Error)]
pub enum AIError {
    #[error("API key not found for provider: {0}")]
    ApiKeyNotFound(String),

    #[error("HTTP request failed: {0}")]
    HttpError(String),

    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    #[error("Rate limited: retry after {0} seconds")]
    RateLimited(u32),

    #[error("Provider error: {0}")]
    ProviderError(String),

    #[error("Stream error: {0}")]
    StreamError(String),

    #[error("Authentication error: {0}")]
    AuthError(String),
}

/// LLM Provider trait
#[async_trait]
pub trait LLMProvider: Send + Sync {
    /// Get provider type
    fn provider_type(&self) -> ProviderType;

    /// Get available models
    fn available_models(&self) -> Vec<ModelInfo>;

    /// Complete request with streaming
    async fn complete_stream(
        &self,
        request: CompletionRequest,
        sender: mpsc::Sender<StreamChunk>,
    ) -> Result<(), AIError>;

    /// Set API key
    fn set_api_key(&mut self, key: String);

    /// Check if API key is set
    fn has_api_key(&self) -> bool;

    /// Test connection
    async fn test_connection(&self) -> Result<bool, AIError>;
}

/// 429 재시도 시 Retry-After 상한 (초)
const MAX_RETRY_AFTER_SECS: u32 = 30;

/// 요청 전송 + 상태 검사 공용 헬퍼.
///
/// 429는 Retry-After 헤더(기본 2초, 상한 30초)만큼 대기 후 1회 재시도하고,
/// 재차 429면 `AIError::RateLimited`를 반환한다. 그 외 실패는
/// `ProviderError`로 상태·본문을 담아 반환한다.
pub(crate) async fn send_checked<B>(
    provider_name: &str,
    build_request: B,
) -> Result<reqwest::Response, AIError>
where
    B: Fn() -> reqwest::RequestBuilder,
{
    let mut retried = false;

    loop {
        let response = build_request()
            .send()
            .await
            .map_err(|e| AIError::HttpError(e.to_string()))?;

        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }

        if status.as_u16() == 429 {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(2)
                .min(MAX_RETRY_AFTER_SECS);

            if !retried {
                log::warn!(
                    "{} rate limited (429), retrying after {}s",
                    provider_name,
                    retry_after
                );
                tokio::time::sleep(std::time::Duration::from_secs(u64::from(retry_after))).await;
                retried = true;
                continue;
            }
            return Err(AIError::RateLimited(retry_after));
        }

        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(AIError::ProviderError(format!(
            "{} API error {}: {}",
            provider_name, status, error_text
        )));
    }
}
