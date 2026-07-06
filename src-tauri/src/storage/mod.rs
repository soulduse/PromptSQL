pub mod connections;
pub mod history;

pub use connections::*;
pub use history::*;

use std::fs;
use std::path::Path;

/// tmp 파일에 쓴 뒤 rename 하는 원자적 쓰기.
///
/// `fs::write`를 대상 파일에 직접 쓰면 중간에 크래시/전원 차단 시
/// 파일이 절반만 남아 다음 기동에서 JSON 파싱이 깨진다.
pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let mut tmp_name = path
        .file_name()
        .map(|n| n.to_os_string())
        .ok_or_else(|| format!("Invalid file path: {:?}", path))?;
    tmp_name.push(".tmp");
    let tmp_path = path.with_file_name(tmp_name);

    fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write temp file {:?}: {}", tmp_path, e))?;

    fs::rename(&tmp_path, path).map_err(|e| {
        // rename 실패 시 tmp 잔재 정리
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to move temp file into place {:?}: {}", path, e)
    })?;

    Ok(())
}
