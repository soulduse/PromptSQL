use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;
use tokio::sync::mpsc;

use crate::ai::provider::{
    AIError, CompletionRequest, LLMProvider, ModelInfo, ProviderType, StreamChunk,
};

pub struct OllamaProvider {
    client: Client,
    base_url: String,
}

impl OllamaProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            base_url: "http://localhost:11434".to_string(),
        }
    }
}

#[async_trait]
impl LLMProvider for OllamaProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Ollama
    }

    fn available_models(&self) -> Vec<ModelInfo> {
        // Default models - actual models depend on what's installed locally
        vec![
            ModelInfo {
                id: "llama3.3".to_string(),
                name: "Llama 3.3".to_string(),
                provider: ProviderType::Ollama,
                max_tokens: 128000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "qwen2.5-coder".to_string(),
                name: "Qwen 2.5 Coder".to_string(),
                provider: ProviderType::Ollama,
                max_tokens: 128000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "deepseek-r1".to_string(),
                name: "DeepSeek R1".to_string(),
                provider: ProviderType::Ollama,
                max_tokens: 128000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "codellama".to_string(),
                name: "Code Llama".to_string(),
                provider: ProviderType::Ollama,
                max_tokens: 16384,
                supports_streaming: true,
            },
        ]
    }

    async fn complete_stream(
        &self,
        request: CompletionRequest,
        sender: mpsc::Sender<StreamChunk>,
    ) -> Result<(), AIError> {
        // Build Ollama-format messages
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
            "stream": true,
            "options": {
                "num_predict": request.max_tokens.unwrap_or(4096),
                "temperature": request.temperature.unwrap_or(0.7)
            }
        });

        let response = self
            .client
            .post(format!("{}/api/chat", self.base_url))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AIError::HttpError(format!("Ollama connection failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AIError::ProviderError(format!(
                "Ollama API error {}: {}",
                status, error_text
            )));
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| AIError::StreamError(e.to_string()))?;
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // Ollama uses NDJSON (newline-delimited JSON)
            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].to_string();
                buffer = buffer[pos + 1..].to_string();

                if line.trim().is_empty() {
                    continue;
                }

                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                    let done = json["done"].as_bool().unwrap_or(false);

                    if let Some(message) = json["message"].as_object() {
                        if let Some(content) = message["content"].as_str() {
                            let _ = sender
                                .send(StreamChunk {
                                    content: content.to_string(),
                                    done: false,
                                })
                                .await;
                        }
                    }

                    if done {
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

    fn set_api_key(&mut self, _key: String) {
        // Ollama doesn't need API key
    }

    fn has_api_key(&self) -> bool {
        // Ollama doesn't need API key, always return true
        true
    }

    async fn test_connection(&self) -> Result<bool, AIError> {
        let response = self
            .client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await
            .map_err(|e| AIError::HttpError(format!("Ollama connection failed: {}", e)))?;

        Ok(response.status().is_success())
    }
}
