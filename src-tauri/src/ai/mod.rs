pub mod auto_mode;
pub mod config;
pub mod context;
pub mod conversations;
pub mod prompt;
pub mod provider;
pub mod providers;
pub mod rag;
pub mod router;
pub mod streaming;

use std::sync::Arc;
use tokio::sync::Mutex;

use provider::{CompletionRequest, LLMProvider, ProviderType, StreamChunk};
use providers::{AnthropicProvider, GeminiProvider, OllamaProvider, OpenAIProvider};

/// 프로바이더의 소유권 있는 스냅샷 — AIManager 락을 잡지 않고
/// 스트리밍 요청을 수행하기 위해 사용한다.
///
/// 락을 잡은 채 complete_stream을 실행하면 스트림이 끝날 때까지
/// 모든 AI 커맨드(모델 목록, 설정 변경 등)가 블로킹된다.
#[derive(Clone)]
pub enum AnyProvider {
    OpenAI(OpenAIProvider),
    Anthropic(AnthropicProvider),
    Gemini(GeminiProvider),
    Ollama(OllamaProvider),
}

impl AnyProvider {
    fn inner(&self) -> &dyn LLMProvider {
        match self {
            AnyProvider::OpenAI(p) => p,
            AnyProvider::Anthropic(p) => p,
            AnyProvider::Gemini(p) => p,
            AnyProvider::Ollama(p) => p,
        }
    }

    pub fn available_models(&self) -> Vec<provider::ModelInfo> {
        self.inner().available_models()
    }
}

/// 락 밖에서 사용하는 (프로바이더, 모델) 스냅샷.
pub struct ProviderSnapshot {
    pub provider: AnyProvider,
    pub model: String,
}

impl ProviderSnapshot {
    /// Send a completion request with streaming
    pub async fn complete_stream(
        &self,
        messages: Vec<provider::ChatMessage>,
        sender: tokio::sync::mpsc::Sender<StreamChunk>,
    ) -> Result<(), provider::AIError> {
        let model = self.model.clone();
        self.complete_stream_with_model(&model, messages, sender)
            .await
    }

    /// Send a completion request with a specific model (for model routing)
    pub async fn complete_stream_with_model(
        &self,
        model: &str,
        messages: Vec<provider::ChatMessage>,
        sender: tokio::sync::mpsc::Sender<StreamChunk>,
    ) -> Result<(), provider::AIError> {
        let request = CompletionRequest {
            messages,
            model: model.to_string(),
            max_tokens: Some(4096),
            temperature: Some(0.7),
            stream: true,
        };

        self.provider.inner().complete_stream(request, sender).await
    }

    /// Send a one-shot completion request (non-streaming, collects full response)
    /// Used for table selection and other quick tasks
    pub async fn complete_oneshot(
        &self,
        messages: Vec<provider::ChatMessage>,
    ) -> Result<String, provider::AIError> {
        self.complete_oneshot_with_options(messages, 500, None).await
    }

    /// Send a one-shot completion request with configurable options
    /// Used for AUTO mode and other tasks requiring longer responses
    pub async fn complete_oneshot_with_options(
        &self,
        messages: Vec<provider::ChatMessage>,
        max_tokens: u32,
        temperature: Option<f32>,
    ) -> Result<String, provider::AIError> {
        let request = CompletionRequest {
            messages,
            model: self.model.clone(),
            max_tokens: Some(max_tokens),
            temperature,
            stream: true, // Still use streaming internally
        };

        // Create a channel to collect the streamed response
        let (sender, mut receiver) = tokio::sync::mpsc::channel::<StreamChunk>(100);

        // Spawn task to collect chunks
        let collect_handle = tokio::spawn(async move {
            let mut full_response = String::new();
            while let Some(chunk) = receiver.recv().await {
                full_response.push_str(&chunk.content);
                if chunk.done {
                    break;
                }
            }
            full_response
        });

        // Run the streaming request
        self.provider.inner().complete_stream(request, sender).await?;

        // Wait for collection to complete
        collect_handle
            .await
            .map_err(|e| provider::AIError::StreamError(e.to_string()))
    }
}

/// AI Manager - manages multiple LLM providers
pub struct AIManager {
    pub openai: OpenAIProvider,
    pub anthropic: AnthropicProvider,
    pub gemini: GeminiProvider,
    pub ollama: OllamaProvider,
    current_provider: ProviderType,
    current_model: String,
}

impl AIManager {
    pub fn new() -> Self {
        Self {
            openai: OpenAIProvider::new(),
            anthropic: AnthropicProvider::new(),
            gemini: GeminiProvider::new(),
            ollama: OllamaProvider::new(),
            current_provider: ProviderType::OpenAI,
            current_model: "gpt-5.4-mini".to_string(),
        }
    }

    /// Load API keys from Keychain and set them to providers
    pub fn load_api_keys(&mut self) -> Result<(), String> {
        if let Ok(key) = config::get_api_key(&ProviderType::OpenAI) {
            self.openai.set_api_key(key);
        }
        if let Ok(key) = config::get_api_key(&ProviderType::Anthropic) {
            self.anthropic.set_api_key(key);
        }
        if let Ok(key) = config::get_api_key(&ProviderType::Gemini) {
            self.gemini.set_api_key(key);
        }
        // Ollama doesn't need API key
        Ok(())
    }

    /// Set the current provider and model
    pub fn set_provider(&mut self, provider: ProviderType, model: String) {
        self.current_provider = provider;
        self.current_model = model;
    }

    /// Get current provider type
    pub fn current_provider(&self) -> &ProviderType {
        &self.current_provider
    }

    /// Get current model
    pub fn current_model(&self) -> &str {
        &self.current_model
    }

    /// Get the current LLM provider instance
    pub fn get_provider(&self) -> &dyn LLMProvider {
        match self.current_provider {
            ProviderType::OpenAI => &self.openai,
            ProviderType::Anthropic => &self.anthropic,
            ProviderType::Gemini => &self.gemini,
            ProviderType::Ollama => &self.ollama,
        }
    }

    /// 현재 (프로바이더, 모델)의 소유 스냅샷 — 락을 즉시 반납하고
    /// 스트리밍은 스냅샷으로 수행한다.
    pub fn snapshot(&self) -> ProviderSnapshot {
        let provider = match self.current_provider {
            ProviderType::OpenAI => AnyProvider::OpenAI(self.openai.clone()),
            ProviderType::Anthropic => AnyProvider::Anthropic(self.anthropic.clone()),
            ProviderType::Gemini => AnyProvider::Gemini(self.gemini.clone()),
            ProviderType::Ollama => AnyProvider::Ollama(self.ollama.clone()),
        };
        ProviderSnapshot {
            provider,
            model: self.current_model.clone(),
        }
    }

    /// Get mutable provider by type
    pub fn get_provider_mut(&mut self, provider_type: &ProviderType) -> &mut dyn LLMProvider {
        match provider_type {
            ProviderType::OpenAI => &mut self.openai,
            ProviderType::Anthropic => &mut self.anthropic,
            ProviderType::Gemini => &mut self.gemini,
            ProviderType::Ollama => &mut self.ollama,
        }
    }

}

pub type SharedAIManager = Arc<Mutex<AIManager>>;

/// Create a new shared AI manager instance
pub fn create_ai_manager() -> SharedAIManager {
    let mut manager = AIManager::new();
    let _ = manager.load_api_keys();
    Arc::new(Mutex::new(manager))
}
