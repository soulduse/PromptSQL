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
