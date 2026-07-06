use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use super::provider::{AIError, StreamChunk};

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
    let mut sent_done = false;

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
            sent_done = true;
            break;
        }
    }

    // done 없이 채널이 닫힌 경우(취소·전송측 에러) — 프론트가
    // 스트리밍 상태에 갇히지 않도록 종료를 알린다
    if !sent_done {
        let event = AIStreamEvent {
            request_id: request_id.clone(),
            content: String::new(),
            done: true,
            error: None,
        };
        let _ = app.emit("ai-stream", &event);
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

/// 델리미터 단위 프레이밍 버퍼.
///
/// 바이트로 누적하고 **완성된 프레임만** UTF-8 디코딩한다 —
/// 청크 단위 `from_utf8_lossy`는 멀티바이트 문자(한글 3바이트 등)가
/// 청크 경계에 걸리면 U+FFFD로 깨진다.
pub struct FrameReader {
    buffer: Vec<u8>,
    delimiter: Vec<u8>,
}

impl FrameReader {
    pub fn new(delimiter: &[u8]) -> Self {
        Self {
            buffer: Vec::new(),
            delimiter: delimiter.to_vec(),
        }
    }

    /// 수신 바이트를 밀어넣고, 완성된 프레임들을 문자열로 반환한다.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);

        let mut frames = Vec::new();
        while let Some(pos) = find_subslice(&self.buffer, &self.delimiter) {
            let frame_bytes: Vec<u8> = self.buffer.drain(..pos + self.delimiter.len()).collect();
            let frame_bytes = &frame_bytes[..pos];
            frames.push(String::from_utf8_lossy(frame_bytes).into_owned());
        }
        frames
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// 프레임 파싱 결과 — pump_frames가 sender로 변환해 전달한다.
pub enum FrameAction {
    /// 콘텐츠 조각 전달
    Content(String),
    /// 콘텐츠 전달 후 스트림 종료
    ContentAndDone(String),
    /// 스트림 종료
    Done,
    /// 무시 (핑, 메타 이벤트 등)
    Skip,
}

/// HTTP 응답 바디를 델리미터 프레임으로 잘라 파싱하고 StreamChunk로 펌프한다.
///
/// 4개 프로바이더(SSE `\n\n` / NDJSON `\n`)가 공용으로 사용하는 수신 루프.
pub async fn pump_frames<P>(
    response: reqwest::Response,
    delimiter: &[u8],
    sender: &mpsc::Sender<StreamChunk>,
    mut parse: P,
) -> Result<(), AIError>
where
    P: FnMut(&str) -> FrameAction + Send,
{
    let mut stream = response.bytes_stream();
    let mut reader = FrameReader::new(delimiter);

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| AIError::StreamError(e.to_string()))?;

        for frame in reader.push(&chunk) {
            match parse(&frame) {
                FrameAction::Content(text) => {
                    if !text.is_empty() {
                        let _ = sender
                            .send(StreamChunk {
                                content: text,
                                done: false,
                            })
                            .await;
                    }
                }
                FrameAction::ContentAndDone(text) => {
                    if !text.is_empty() {
                        let _ = sender
                            .send(StreamChunk {
                                content: text,
                                done: false,
                            })
                            .await;
                    }
                    let _ = sender
                        .send(StreamChunk {
                            content: String::new(),
                            done: true,
                        })
                        .await;
                    return Ok(());
                }
                FrameAction::Done => {
                    let _ = sender
                        .send(StreamChunk {
                            content: String::new(),
                            done: true,
                        })
                        .await;
                    return Ok(());
                }
                FrameAction::Skip => {}
            }
        }
    }

    // Stream ended without explicit done marker
    let _ = sender
        .send(StreamChunk {
            content: String::new(),
            done: true,
        })
        .await;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_frame_reader_basic_sse() {
        let mut reader = FrameReader::new(b"\n\n");
        let frames = reader.push(b"data: hello\n\ndata: world\n\n");
        assert_eq!(frames, vec!["data: hello", "data: world"]);
    }

    #[test]
    fn test_frame_reader_split_across_chunks() {
        let mut reader = FrameReader::new(b"\n\n");
        assert!(reader.push(b"data: hel").is_empty());
        assert!(reader.push(b"lo\n").is_empty());
        let frames = reader.push(b"\n");
        assert_eq!(frames, vec!["data: hello"]);
    }

    #[test]
    fn test_frame_reader_multibyte_utf8_split_at_chunk_boundary() {
        // "한" = 3 bytes (0xED 0x95 0x9C) — 청크 경계가 문자 중간에 걸리는 케이스
        let text = "data: 한글 응답";
        let bytes = format!("{}\n\n", text).into_bytes();
        // 멀티바이트 문자 중간(고정 오프셋)에서 쪼갠다
        let split_at = 8; // "data: " (6) + '한'의 첫 2바이트
        let mut reader = FrameReader::new(b"\n\n");
        assert!(reader.push(&bytes[..split_at]).is_empty());
        let frames = reader.push(&bytes[split_at..]);
        assert_eq!(frames, vec![text]);
        // U+FFFD가 없어야 한다
        assert!(!frames[0].contains('\u{FFFD}'));
    }

    #[test]
    fn test_frame_reader_every_split_position_is_lossless() {
        // 모든 바이트 위치에서 쪼개도 프레임이 항상 원문과 일치해야 한다
        let text = "data: 가나다 ABC 한글";
        let bytes = format!("{}\n\n", text).into_bytes();
        for split in 1..bytes.len() {
            let mut reader = FrameReader::new(b"\n\n");
            let mut frames = reader.push(&bytes[..split]);
            frames.extend(reader.push(&bytes[split..]));
            assert_eq!(frames, vec![text.to_string()], "split at {}", split);
        }
    }

    #[test]
    fn test_frame_reader_ndjson_delimiter() {
        let mut reader = FrameReader::new(b"\n");
        let frames = reader.push(b"{\"a\":1}\n{\"b\":2}\n{\"partial");
        assert_eq!(frames, vec!["{\"a\":1}", "{\"b\":2}"]);
        let frames = reader.push(b"\":3}\n");
        assert_eq!(frames, vec!["{\"partial\":3}"]);
    }
}
