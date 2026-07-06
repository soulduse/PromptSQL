use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use tokio::sync::mpsc;

use crate::ai::provider::{
    send_checked, AIError, CompletionRequest, LLMProvider, ModelInfo, ProviderType, StreamChunk,
};
use crate::ai::streaming::{pump_frames, FrameAction};

#[derive(Clone)]
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

    /// 로컬에 설치된 모델 목록을 동적으로 조회한다 (GET /api/tags).
    /// Ollama 미기동 등 실패 시 에러 — 호출자가 정적 목록으로 fallback.
    pub async fn list_installed_models(&self) -> Result<Vec<ModelInfo>, AIError> {
        let response = self
            .client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await
            .map_err(|e| AIError::HttpError(format!("Ollama connection failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(AIError::ProviderError(format!(
                "Ollama API error {}",
                response.status()
            )));
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| AIError::InvalidResponse(e.to_string()))?;

        let models: Vec<ModelInfo> = json["models"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["name"].as_str())
                    .map(|name| ModelInfo {
                        id: name.to_string(),
                        name: name.to_string(),
                        provider: ProviderType::Ollama,
                        max_tokens: 128000,
                        supports_streaming: true,
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(models)
    }
}

#[async_trait]
impl LLMProvider for OllamaProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Ollama
    }

    fn available_models(&self) -> Vec<ModelInfo> {
        // Static fallback — 실제 설치 목록은 list_installed_models가 우선
        crate::ai::models::model_infos(ProviderType::Ollama)
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

        let url = format!("{}/api/chat", self.base_url);
        let response = send_checked("Ollama", || {
            self.client
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&body)
        })
        .await?;

        // Ollama uses NDJSON (newline-delimited JSON)
        pump_frames(response, b"\n", &sender, |frame| {
            let line = frame.trim();
            if line.is_empty() {
                return FrameAction::Skip;
            }

            let Ok(json) = serde_json::from_str::<serde_json::Value>(line) else {
                return FrameAction::Skip;
            };

            let done = json["done"].as_bool().unwrap_or(false);
            let content = json["message"]["content"]
                .as_str()
                .unwrap_or_default()
                .to_string();

            if done {
                FrameAction::ContentAndDone(content)
            } else {
                FrameAction::Content(content)
            }
        })
        .await
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
