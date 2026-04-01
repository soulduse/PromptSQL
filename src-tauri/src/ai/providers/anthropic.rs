use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;
use tokio::sync::mpsc;

use crate::ai::provider::{
    AIError, CompletionRequest, LLMProvider, ModelInfo, ProviderType, StreamChunk,
};

pub struct AnthropicProvider {
    client: Client,
    api_key: Option<String>,
    base_url: String,
}

impl AnthropicProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: None,
            base_url: "https://api.anthropic.com".to_string(),
        }
    }
}

#[async_trait]
impl LLMProvider for AnthropicProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Anthropic
    }

    fn available_models(&self) -> Vec<ModelInfo> {
        vec![
            ModelInfo {
                id: "claude-sonnet-4-5-20250929".to_string(),
                name: "Claude 4.5 Sonnet".to_string(),
                provider: ProviderType::Anthropic,
                max_tokens: 200000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "claude-opus-4-5-20251101".to_string(),
                name: "Claude 4.5 Opus".to_string(),
                provider: ProviderType::Anthropic,
                max_tokens: 200000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "claude-haiku-4-5-20251001".to_string(),
                name: "Claude 4.5 Haiku".to_string(),
                provider: ProviderType::Anthropic,
                max_tokens: 200000,
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
            .ok_or_else(|| AIError::ApiKeyNotFound("anthropic".to_string()))?;

        // Extract system message and user/assistant messages
        let system_content = request
            .messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.clone())
            .unwrap_or_default();

        let messages: Vec<serde_json::Value> = request
            .messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| {
                json!({
                    "role": m.role,
                    "content": m.content
                })
            })
            .collect();

        let mut body = json!({
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "stream": true
        });

        if !system_content.is_empty() {
            body["system"] = json!(system_content);
        }

        let response = self
            .client
            .post(format!("{}/v1/messages", self.base_url))
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
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
                "Anthropic API error {}: {}",
                status, error_text
            )));
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| AIError::StreamError(e.to_string()))?;
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // Process complete SSE events
            while let Some(pos) = buffer.find("\n\n") {
                let event_block = buffer[..pos].to_string();
                buffer = buffer[pos + 2..].to_string();

                let mut event_type = String::new();
                let mut data = String::new();

                for line in event_block.lines() {
                    if line.starts_with("event: ") {
                        event_type = line[7..].to_string();
                    } else if line.starts_with("data: ") {
                        data = line[6..].to_string();
                    }
                }

                if event_type == "content_block_delta" {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                        if let Some(text) = json["delta"]["text"].as_str() {
                            let _ = sender
                                .send(StreamChunk {
                                    content: text.to_string(),
                                    done: false,
                                })
                                .await;
                        }
                    }
                } else if event_type == "message_stop" {
                    let _ = sender
                        .send(StreamChunk {
                            content: String::new(),
                            done: true,
                        })
                        .await;
                    return Ok(());
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
        if self.api_key.is_none() {
            return Err(AIError::ApiKeyNotFound("anthropic".to_string()));
        }
        Ok(true)
    }
}
