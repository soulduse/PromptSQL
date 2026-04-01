use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;
use tokio::sync::mpsc;

use crate::ai::provider::{
    AIError, CompletionRequest, LLMProvider, ModelInfo, ProviderType, StreamChunk,
};

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

        let response = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&json!({
                "model": request.model,
                "messages": messages,
                "max_completion_tokens": request.max_tokens.unwrap_or(4096),
                "stream": true
            }))
            .send()
            .await
            .map_err(|e| AIError::HttpError(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AIError::ProviderError(format!(
                "OpenAI API error {}: {}",
                status, error_text
            )));
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| AIError::StreamError(e.to_string()))?;
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // Process complete SSE lines
            while let Some(pos) = buffer.find("\n\n") {
                let line = buffer[..pos].to_string();
                buffer = buffer[pos + 2..].to_string();

                for single_line in line.lines() {
                    if single_line.starts_with("data: ") {
                        let data = &single_line[6..];

                        if data == "[DONE]" {
                            let _ = sender
                                .send(StreamChunk {
                                    content: String::new(),
                                    done: true,
                                })
                                .await;
                            return Ok(());
                        }

                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                                let _ = sender
                                    .send(StreamChunk {
                                        content: content.to_string(),
                                        done: false,
                                    })
                                    .await;
                            }
                        }
                    }
                }
            }
        }

        // Send final done message
        let _ = sender
            .send(StreamChunk {
                content: String::new(),
                done: true,
            })
            .await;

        Ok(())
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
