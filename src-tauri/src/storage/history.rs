use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const APP_NAME: &str = "promptsql";
const HISTORY_FILE: &str = "history.json";
const GROUPS_FILE: &str = "groups.json";

/// Query history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistory {
    pub id: String,
    pub query: String,
    pub connection_id: String,
    pub database: Option<String>,
    pub timestamp: i64, // Unix timestamp in milliseconds
    pub execution_time_ms: u64,
    pub row_count: u64,
    pub status: String, // "success" or "error"
    pub error_message: Option<String>,
    pub note: Option<String>,
    pub group_id: Option<String>,
}

/// History group
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Get the app data directory
fn get_data_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir()
        .ok_or("Could not find data directory")?
        .join(APP_NAME);

    // Create directory if it doesn't exist
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;
    }

    Ok(data_dir)
}

/// Get the history file path
fn get_history_file() -> Result<PathBuf, String> {
    Ok(get_data_dir()?.join(HISTORY_FILE))
}

/// Get the groups file path
fn get_groups_file() -> Result<PathBuf, String> {
    Ok(get_data_dir()?.join(GROUPS_FILE))
}

// ============ History CRUD ============

/// Load all query history from file
pub fn load_history() -> Result<Vec<QueryHistory>, String> {
    let file_path = get_history_file()?;

    if !file_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read history file: {}", e))?;

    let history: Vec<QueryHistory> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse history file: {}", e))?;

    Ok(history)
}

/// Save all history to file
fn save_history(history: &[QueryHistory]) -> Result<(), String> {
    let file_path = get_history_file()?;

    let content = serde_json::to_string_pretty(history)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;

    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write history file: {}", e))?;

    Ok(())
}

/// Add a new query to history
pub fn add_history(history_entry: QueryHistory) -> Result<QueryHistory, String> {
    let mut history = load_history()?;

    // Generate ID if not provided
    let entry = if history_entry.id.is_empty() {
        QueryHistory {
            id: Uuid::new_v4().to_string(),
            ..history_entry
        }
    } else {
        history_entry
    };

    // Add to beginning (most recent first)
    history.insert(0, entry.clone());

    // Save history
    save_history(&history)?;

    Ok(entry)
}

/// Delete a query from history
pub fn delete_history(id: &str) -> Result<(), String> {
    let mut history = load_history()?;
    history.retain(|h| h.id != id);
    save_history(&history)?;
    Ok(())
}

/// Update a history entry (note and/or group_id)
pub fn update_history(id: &str, note: Option<String>, group_id: Option<Option<String>>) -> Result<(), String> {
    let mut history = load_history()?;

    if let Some(entry) = history.iter_mut().find(|h| h.id == id) {
        if let Some(n) = note {
            entry.note = Some(n);
        }
        if let Some(gid) = group_id {
            entry.group_id = gid;
        }
        save_history(&history)?;
    }

    Ok(())
}

/// Search history by query text, note, or group name
pub fn search_history(query: &str, groups: &[HistoryGroup]) -> Result<Vec<QueryHistory>, String> {
    let history = load_history()?;
    let query_lower = query.to_lowercase();

    let results: Vec<QueryHistory> = history
        .into_iter()
        .filter(|h| {
            // Match query text
            if h.query.to_lowercase().contains(&query_lower) {
                return true;
            }

            // Match note
            if let Some(ref note) = h.note {
                if note.to_lowercase().contains(&query_lower) {
                    return true;
                }
            }

            // Match group name
            if let Some(ref group_id) = h.group_id {
                if let Some(group) = groups.iter().find(|g| &g.id == group_id) {
                    if group.name.to_lowercase().contains(&query_lower) {
                        return true;
                    }
                }
            }

            false
        })
        .collect();

    Ok(results)
}

// ============ Groups CRUD ============

/// Load all history groups from file
pub fn load_groups() -> Result<Vec<HistoryGroup>, String> {
    let file_path = get_groups_file()?;

    if !file_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read groups file: {}", e))?;

    let groups: Vec<HistoryGroup> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse groups file: {}", e))?;

    Ok(groups)
}

/// Save all groups to file
fn save_groups(groups: &[HistoryGroup]) -> Result<(), String> {
    let file_path = get_groups_file()?;

    let content = serde_json::to_string_pretty(groups)
        .map_err(|e| format!("Failed to serialize groups: {}", e))?;

    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write groups file: {}", e))?;

    Ok(())
}

/// Create a new history group
pub fn create_group(name: &str, description: Option<String>) -> Result<HistoryGroup, String> {
    let mut groups = load_groups()?;

    let now = chrono::Utc::now().timestamp_millis();
    let group = HistoryGroup {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        description,
        color: None,
        created_at: now,
        updated_at: now,
    };

    groups.push(group.clone());
    save_groups(&groups)?;

    Ok(group)
}

/// Update a history group
pub fn update_group(id: &str, name: Option<String>, description: Option<Option<String>>) -> Result<(), String> {
    let mut groups = load_groups()?;

    if let Some(group) = groups.iter_mut().find(|g| g.id == id) {
        if let Some(n) = name {
            group.name = n;
        }
        if let Some(d) = description {
            group.description = d;
        }
        group.updated_at = chrono::Utc::now().timestamp_millis();
        save_groups(&groups)?;
    }

    Ok(())
}

/// Delete a history group (also unassigns all history entries from this group)
pub fn delete_group(id: &str) -> Result<(), String> {
    // Remove group from groups list
    let mut groups = load_groups()?;
    groups.retain(|g| g.id != id);
    save_groups(&groups)?;

    // Unassign history entries from this group
    let mut history = load_history()?;
    for entry in history.iter_mut() {
        if entry.group_id.as_deref() == Some(id) {
            entry.group_id = None;
        }
    }
    save_history(&history)?;

    Ok(())
}
