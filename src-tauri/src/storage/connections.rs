use keyring::Entry;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

const APP_NAME: &str = "promptsql";
const CONNECTIONS_FILE: &str = "connections.json";

/// In-memory cache for connection passwords
/// Key: connection_id, Value: password
static PASSWORD_CACHE: Lazy<RwLock<HashMap<String, String>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// 캐시 락 poison 복구 — 캐시는 keychain의 사본일 뿐이라 손상돼도 안전.
fn cache_read() -> std::sync::RwLockReadGuard<'static, HashMap<String, String>> {
    PASSWORD_CACHE.read().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn cache_write() -> std::sync::RwLockWriteGuard<'static, HashMap<String, String>> {
    PASSWORD_CACHE.write().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Connection metadata stored in JSON file (without password)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: Option<String>,
    #[serde(default)]
    pub last_used_database: Option<String>,
}

/// Full connection data including password (for frontend)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionWithPassword {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: Option<String>,
    #[serde(default)]
    pub last_used_database: Option<String>,
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

/// Get the connections file path
fn get_connections_file() -> Result<PathBuf, String> {
    Ok(get_data_dir()?.join(CONNECTIONS_FILE))
}

/// Load all stored connections from file
pub fn load_connections() -> Result<Vec<StoredConnection>, String> {
    let file_path = get_connections_file()?;

    if !file_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read connections file: {}", e))?;

    let connections: Vec<StoredConnection> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse connections file: {}", e))?;

    Ok(connections)
}

/// Save all connections to file
pub fn save_connections(connections: &[StoredConnection]) -> Result<(), String> {
    let file_path = get_connections_file()?;

    let content = serde_json::to_string_pretty(connections)
        .map_err(|e| format!("Failed to serialize connections: {}", e))?;

    super::write_atomic(&file_path, &content)
}

/// Store password in macOS Keychain and update cache
pub fn store_password(connection_id: &str, password: &str) -> Result<(), String> {
    let entry = Entry::new(APP_NAME, connection_id)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;

    entry.set_password(password)
        .map_err(|e| format!("Failed to store password in keychain: {}", e))?;

    // Update cache
    cache_write().insert(connection_id.to_string(), password.to_string());

    Ok(())
}

/// Get password from cache first, fallback to Keychain
pub fn get_password(connection_id: &str) -> Result<String, String> {
    // Check cache first
    if let Some(password) = cache_read().get(connection_id) {
        return Ok(password.clone());
    }

    // Not in cache, access Keychain
    let entry = Entry::new(APP_NAME, connection_id)
        .map_err(|e| format!("Failed to access keychain entry: {}", e))?;

    let password = entry.get_password()
        .map_err(|e| format!("Failed to get password from keychain: {}", e))?;

    // Update cache
    cache_write().insert(connection_id.to_string(), password.clone());

    Ok(password)
}

/// Delete password from macOS Keychain and cache
pub fn delete_password(connection_id: &str) -> Result<(), String> {
    let entry = Entry::new(APP_NAME, connection_id)
        .map_err(|e| format!("Failed to access keychain entry: {}", e))?;

    // Ignore error if password doesn't exist
    let _ = entry.delete_credential();

    // Update cache
    cache_write().remove(connection_id);

    Ok(())
}

/// Load all connections with their passwords
pub fn load_connections_with_passwords() -> Result<Vec<ConnectionWithPassword>, String> {
    let connections = load_connections()?;

    let mut result = Vec::new();
    for conn in connections {
        let password = get_password(&conn.id).unwrap_or_default();
        result.push(ConnectionWithPassword {
            id: conn.id,
            name: conn.name,
            host: conn.host,
            port: conn.port,
            user: conn.user,
            password,
            database: conn.database,
            last_used_database: conn.last_used_database,
        });
    }

    Ok(result)
}

/// Save a single connection (metadata + password)
pub fn save_connection(connection: &ConnectionWithPassword) -> Result<(), String> {
    // Load existing connections
    let mut connections = load_connections()?;

    // Find existing connection to preserve last_used_database if not provided
    let existing_last_used = connections
        .iter()
        .find(|c| c.id == connection.id)
        .and_then(|c| c.last_used_database.clone());

    // Remove existing connection with same ID if exists
    connections.retain(|c| c.id != connection.id);

    // Add new connection metadata
    connections.push(StoredConnection {
        id: connection.id.clone(),
        name: connection.name.clone(),
        host: connection.host.clone(),
        port: connection.port,
        user: connection.user.clone(),
        database: connection.database.clone(),
        last_used_database: connection.last_used_database.clone().or(existing_last_used),
    });

    // Save connections to file
    save_connections(&connections)?;

    // Store password in keychain (and cache)
    store_password(&connection.id, &connection.password)?;

    Ok(())
}

/// Update the last used database for a connection
pub fn update_last_database(connection_id: &str, database: &str) -> Result<(), String> {
    let mut connections = load_connections()?;

    if let Some(conn) = connections.iter_mut().find(|c| c.id == connection_id) {
        conn.last_used_database = Some(database.to_string());
        save_connections(&connections)?;
    }

    Ok(())
}

/// Delete a connection (metadata + password)
pub fn delete_connection(connection_id: &str) -> Result<(), String> {
    // Load existing connections
    let mut connections = load_connections()?;

    // Remove connection
    connections.retain(|c| c.id != connection_id);

    // Save connections to file
    save_connections(&connections)?;

    // Delete password from keychain (and cache)
    delete_password(connection_id)?;

    Ok(())
}
