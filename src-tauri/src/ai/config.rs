use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use once_cell::sync::Lazy;

use super::provider::ProviderType;

const SERVICE_NAME: &str = "promptsql-llm";
const API_KEYS_KEY: &str = "api_keys";

/// In-memory cache for all API keys (single keychain access)
/// Stores all provider keys in memory after initial load
static API_KEY_CACHE: Lazy<RwLock<Option<HashMap<String, String>>>> =
    Lazy::new(|| RwLock::new(None));

/// RwLock read with poison recovery — 캐시 데이터는 손상돼도 keychain에서
/// 다시 읽을 수 있으므로 panic 전파 대신 복구한다.
fn cache_read() -> std::sync::RwLockReadGuard<'static, Option<HashMap<String, String>>> {
    API_KEY_CACHE.read().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn cache_write() -> std::sync::RwLockWriteGuard<'static, Option<HashMap<String, String>>> {
    API_KEY_CACHE.write().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// AI configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIConfig {
    pub provider: ProviderType,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
}

impl Default for AIConfig {
    fn default() -> Self {
        Self {
            provider: ProviderType::OpenAI,
            model: "gpt-5.4-mini".to_string(),
            temperature: 0.7,
            max_tokens: 4096,
        }
    }
}

/// Load all API keys from Keychain into cache (single keychain access)
fn load_keys_from_keychain() -> HashMap<String, String> {
    let entry = match Entry::new(SERVICE_NAME, API_KEYS_KEY) {
        Ok(e) => e,
        Err(_) => return HashMap::new(),
    };

    match entry.get_password() {
        Ok(json) => {
            serde_json::from_str(&json).unwrap_or_default()
        }
        Err(_) => HashMap::new(),
    }
}

/// Save all API keys to Keychain (single keychain access)
fn save_keys_to_keychain(keys: &HashMap<String, String>) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, API_KEYS_KEY)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;

    let json = serde_json::to_string(keys)
        .map_err(|e| format!("Failed to serialize API keys: {}", e))?;

    entry
        .set_password(&json)
        .map_err(|e| format!("Failed to store API keys: {}", e))
}

/// Ensure cache is initialized
fn ensure_cache_initialized() {
    let needs_init = {
        let cache = cache_read();
        cache.is_none()
    };

    if needs_init {
        let keys = load_keys_from_keychain();
        let mut cache = cache_write();
        *cache = Some(keys);
    }
}

/// Store API key in Keychain and update cache
pub fn store_api_key(provider: &ProviderType, api_key: &str) -> Result<(), String> {
    ensure_cache_initialized();

    let provider_name = provider.to_string().to_lowercase();

    // Update cache
    let mut cache = cache_write();
    let keys = cache.get_or_insert_with(HashMap::new);
    keys.insert(provider_name, api_key.to_string());

    // Save to keychain
    save_keys_to_keychain(keys)
}

/// Get API key from cache (no keychain access after initial load)
pub fn get_api_key(provider: &ProviderType) -> Result<String, String> {
    ensure_cache_initialized();

    let provider_name = provider.to_string().to_lowercase();

    let cache = cache_read();
    if let Some(keys) = cache.as_ref() {
        if let Some(key) = keys.get(&provider_name) {
            return Ok(key.clone());
        }
    }

    Err(format!("API key not found for {}", provider_name))
}

/// Delete API key from Keychain and update cache
pub fn delete_api_key(provider: &ProviderType) -> Result<(), String> {
    ensure_cache_initialized();

    let provider_name = provider.to_string().to_lowercase();

    // Update cache
    let mut cache = cache_write();
    if let Some(keys) = cache.as_mut() {
        keys.remove(&provider_name);
        // Save to keychain
        save_keys_to_keychain(keys)?;
    }

    Ok(())
}

/// Check if API key exists for provider (uses cache)
pub fn has_api_key(provider: &ProviderType) -> bool {
    get_api_key(provider).is_ok()
}

/// Bulk check API key status for all providers (uses cache, no keychain access)
/// Returns a map of provider name to whether key exists
pub fn get_all_api_key_status() -> HashMap<String, bool> {
    ensure_cache_initialized();

    let providers = [
        ProviderType::OpenAI,
        ProviderType::Anthropic,
        ProviderType::Gemini,
        ProviderType::Ollama,
    ];

    let mut result = HashMap::new();

    for provider in &providers {
        let provider_name = provider.to_string().to_lowercase();
        let has_key = has_api_key(provider);
        result.insert(provider_name, has_key);
    }

    result
}

/// Preload all API keys into cache at startup (single keychain access)
pub fn preload_api_keys() {
    log::info!("Preloading API keys into cache...");
    ensure_cache_initialized();
    log::info!("API keys cache preloaded");
}

// Migration: Move old per-provider keys to new unified storage
pub fn migrate_old_keys() {
    log::info!("Checking for old API key format to migrate...");

    let providers = [
        ProviderType::OpenAI,
        ProviderType::Anthropic,
        ProviderType::Gemini,
        ProviderType::Ollama,
    ];

    let mut migrated_keys = HashMap::new();
    let mut found_old_keys = false;

    // Try to read old per-provider keys
    for provider in &providers {
        let provider_name = provider.to_string();
        if let Ok(entry) = Entry::new(SERVICE_NAME, &provider_name) {
            if let Ok(key) = entry.get_password() {
                migrated_keys.insert(provider_name.to_lowercase(), key);
                found_old_keys = true;
                // Delete old key after migration
                let _ = entry.delete_credential();
            }
        }
    }

    if found_old_keys {
        log::info!("Found {} old API keys, migrating to unified storage...", migrated_keys.len());

        // Save migrated keys to new unified storage
        if save_keys_to_keychain(&migrated_keys).is_ok() {
            log::info!("Migration complete");
            // Update cache
            let mut cache = cache_write();
            *cache = Some(migrated_keys);
        }
    } else {
        log::info!("No old API keys found, skipping migration");
    }
}
