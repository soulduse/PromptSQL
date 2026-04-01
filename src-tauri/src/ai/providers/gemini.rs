use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;
use tokio::sync::mpsc;

use crate::ai::provider::{
    AIError, CompletionRequest, LLMProvider, ModelInfo, ProviderType, StreamChunk,
};

pub struct GeminiProvider {
    client: Client,
    api_key: Option<String>,
    base_url: String,
}

impl GeminiProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: None,
            base_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
        }
    }
}

#[async_trait]
impl LLMProvider for GeminiProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Gemini
    }

    fn available_models(&self) -> Vec<ModelInfo> {
        vec![
            ModelInfo {
                id: "gemini-3.1-pro-preview".to_string(),
                name: "Gemini 3.1 Pro".to_string(),
                provider: ProviderType::Gemini,
                max_tokens: 1000000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "gemini-3.1-flash-lite-preview".to_string(),
                name: "Gemini 3.1 Flash Lite".to_string(),
                provider: ProviderType::Gemini,
                max_tokens: 1000000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "gemini-2.5-pro".to_string(),
                name: "Gemini 2.5 Pro".to_string(),
                provider: ProviderType::Gemini,
                max_tokens: 1000000,
                supports_streaming: true,
            },
            ModelInfo {
                id: "gemini-2.5-flash".to_string(),
                name: "Gemini 2.5 Flash".to_string(),
                provider: ProviderType::Gemini,
                max_tokens: 1000000,
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
            .ok_or_else(|| AIError::ApiKeyNotFound("gemini".to_string()))?;

        // Build Gemini-format messages
        let mut contents: Vec<serde_json::Value> = Vec::new();
        let mut system_instruction: Option<String> = None;

        for msg in &request.messages {
            if msg.role == "system" {
                system_instruction = Some(msg.content.clone());
            } else {
                let role = if msg.role == "assistant" {
                    "model"
                } else {
                    "user"
                };
                contents.push(json!({
                    "role": role,
                    "parts": [{"text": msg.content}]
                }));
            }
        }

        let mut body = json!({
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": request.max_tokens.unwrap_or(4096),
                "temperature": request.temperature.unwrap_or(0.7)
            }
        });

        if let Some(system) = system_instruction {
            body["systemInstruction"] = json!({
                "parts": [{"text": system}]
            });
        }

        let url = format!(
            "{}/models/{}:streamGenerateContent?alt=sse",
            self.base_url, request.model
        );

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
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
                "Gemini API error {}: {}",
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

                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(text) =
                                json["candidates"][0]["content"]["parts"][0]["text"].as_str()
                            {
                                let _ = sender
                                    .send(StreamChunk {
                                        content: text.to_string(),
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
            .ok_or_else(|| AIError::ApiKeyNotFound("gemini".to_string()))?;

        let url = format!("{}/models", self.base_url);

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| AIError::HttpError(e.to_string()))?;

        Ok(response.status().is_success())
    }
}
