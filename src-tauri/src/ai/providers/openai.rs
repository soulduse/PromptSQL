use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use tokio::sync::mpsc;

use crate::ai::provider::{
    send_checked, AIError, CompletionRequest, LLMProvider, ModelInfo, ProviderType, StreamChunk,
};
use crate::ai::streaming::{pump_frames, FrameAction};

#[derive(Clone)]
pub struct OpenAIProvider {
    client: Client,
    api_key: Option<String>,
    base_url: String,
}

impl OpenAIProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: None,
            base_url: "https://api.openai.com/v1".to_string(),
        }
    }
}

#[async_trait]
impl LLMProvider for OpenAIProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::OpenAI
    }

    fn available_models(&self) -> Vec<ModelInfo> {
        vec![
            ModelInfo {
                id: "gpt-5.4".to_string(),
                name: "GPT-5.4".to_string(),
                provider: ProviderType::OpenAI,
                max_tokens: 128000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "gpt-5.4-mini".to_string(),
                name: "GPT-5.4 Mini".to_string(),
                provider: ProviderType::OpenAI,
                max_tokens: 128000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "o4-mini".to_string(),
                name: "o4 Mini".to_string(),
                provider: ProviderType::OpenAI,
                max_tokens: 128000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "gpt-4o".to_string(),
                name: "GPT-4o".to_string(),
                provider: ProviderType::OpenAI,
                max_tokens: 128000,
                supports_streaming: true,
            },
        ]
    }

    async fn complete_stream(
        &self,
        request: CompletionRequest,
        sender: mpsc::Sender<StreamChunk>,
    ) -> Result<(), AIError> {
        let api_key = self
            .api_key
            .as_ref()
            .ok_or_else(|| AIError::ApiKeyNotFound("openai".to_string()))?;

        let messages: Vec<serde_json::Value> = request
            .messages
            .iter()
            .map(|m| {
                json!({
                    "role": m.role,
                    "content": m.content
                })
            })
            .collect();

        let body = json!({
            "model": request.model,
            "messages": messages,
            "max_completion_tokens": request.max_tokens.unwrap_or(4096),
            "stream": true
        });

        let url = format!("{}/chat/completions", self.base_url);
        let response = send_checked("OpenAI", || {
            self.client
                .post(&url)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&body)
        })
        .await?;

        pump_frames(response, b"\n\n", &sender, |frame| {
            let mut content = String::new();
            for line in frame.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        return FrameAction::ContentAndDone(content);
                    }
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(text) = json["choices"][0]["delta"]["content"].as_str() {
                            content.push_str(text);
                        }
                    }
                }
            }
            FrameAction::Content(content)
        })
        .await
    }

    fn set_api_key(&mut self, key: String) {
        self.api_key = Some(key);
    }

    fn has_api_key(&self) -> bool {
        self.api_key.is_some()
    }

    async fn test_connection(&self) -> Result<bool, AIError> {
        let api_key = self
            .api_key
            .as_ref()
            .ok_or_else(|| AIError::ApiKeyNotFound("openai".to_string()))?;

        let response = self
            .client
            .get(format!("{}/models", self.base_url))
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| AIError::HttpError(e.to_string()))?;

        Ok(response.status().is_success())
    }
}
