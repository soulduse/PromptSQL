use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use tokio::sync::mpsc;

use crate::ai::provider::{
    send_checked, AIError, CompletionRequest, LLMProvider, ModelInfo, ProviderType, StreamChunk,
};
use crate::ai::streaming::{pump_frames, FrameAction};

const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Clone)]
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
        crate::ai::models::model_infos(ProviderType::Anthropic)
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

        let url = format!("{}/v1/messages", self.base_url);
        let response = send_checked("Anthropic", || {
            self.client
                .post(&url)
                .header("x-api-key", api_key)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .header("Content-Type", "application/json")
                .json(&body)
        })
        .await?;

        pump_frames(response, b"\n\n", &sender, |frame| {
            let mut event_type = "";
            let mut data = "";
            for line in frame.lines() {
                if let Some(rest) = line.strip_prefix("event: ") {
                    event_type = rest;
                } else if let Some(rest) = line.strip_prefix("data: ") {
                    data = rest;
                }
            }

            match event_type {
                "content_block_delta" => {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(text) = json["delta"]["text"].as_str() {
                            return FrameAction::Content(text.to_string());
                        }
                    }
                    FrameAction::Skip
                }
                "message_stop" => FrameAction::Done,
                _ => FrameAction::Skip,
            }
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
        // 실제 API 호출로 키 유효성을 검증한다 (기존에는 키 존재만 확인해
        // 잘못된 키도 성공으로 표시됐다)
        let api_key = self
            .api_key
            .as_ref()
            .ok_or_else(|| AIError::ApiKeyNotFound("anthropic".to_string()))?;

        let response = self
            .client
            .get(format!("{}/v1/models", self.base_url))
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .send()
            .await
            .map_err(|e| AIError::HttpError(e.to_string()))?;

        Ok(response.status().is_success())
    }
}
