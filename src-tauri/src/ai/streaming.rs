use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use super::provider::StreamChunk;

/// AI stream event payload for frontend
#[derive(Clone, Serialize)]
pub struct AIStreamEvent {
    pub request_id: String,
    pub content: String,
    pub done: bool,
    pub error: Option<String>,
}

/// Stream chunks to frontend via Tauri events and collect the full response
/// Returns the complete AI response content
pub async fn stream_to_frontend(
    app: AppHandle,
    request_id: String,
    mut receiver: mpsc::Receiver<StreamChunk>,
) -> String {
    let mut full_response = String::new();

    while let Some(chunk) = receiver.recv().await {
        // Collect the response content
        full_response.push_str(&chunk.content);

        let event = AIStreamEvent {
            request_id: request_id.clone(),
            content: chunk.content,
            done: chunk.done,
            error: None,
        };

        // Emit event to frontend
        if let Err(e) = app.emit("ai-stream", &event) {
            log::error!("Failed to emit ai-stream event: {}", e);
            break;
        }

        if chunk.done {
            break;
        }
    }

    full_response
}

/// Emit error event to frontend
pub fn emit_error(app: &AppHandle, request_id: &str, error: &str) {
    let event = AIStreamEvent {
        request_id: request_id.to_string(),
        content: String::new(),
        done: true,
        error: Some(error.to_string()),
    };

    if let Err(e) = app.emit("ai-stream", &event) {
        log::error!("Failed to emit ai-stream error event: {}", e);
    }
}

/// Parse SSE line and extract data
/// Format: "data: {...}\n\n" or "data: [DONE]\n\n"
pub fn parse_sse_line(line: &str) -> Option<String> {
    if line.starts_with("data: ") {
        let data = &line[6..];
        if data == "[DONE]" {
            return None;
        }
        Some(data.to_string())
    } else {
        None
    }
}

/// Parse SSE event line (for Anthropic format)
/// Format: "event: content_block_delta\ndata: {...}\n\n"
pub fn parse_sse_event(lines: &[&str]) -> Option<(String, String)> {
    let mut event_type = String::new();
    let mut data = String::new();

    for line in lines {
        if line.starts_with("event: ") {
            event_type = line[7..].to_string();
        } else if line.starts_with("data: ") {
            data = line[6..].to_string();
        }
    }

    if !event_type.is_empty() && !data.is_empty() {
        Some((event_type, data))
    } else if !data.is_empty() {
        Some(("message".to_string(), data))
    } else {
        None
    }
}
