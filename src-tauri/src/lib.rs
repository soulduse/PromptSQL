mod ai;
mod commands;
mod db;
mod storage;

use ai::create_ai_manager;
use ai::rag::create_rag_manager;
use db::create_connection_manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Migrate old per-provider API keys to unified storage (one-time migration)
    ai::config::migrate_old_keys();

    // Preload API keys into cache at startup (single keychain access)
    ai::config::preload_api_keys();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(create_connection_manager())
        .manage(create_ai_manager())
        .manage(create_rag_manager())
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::test_connection,
            commands::connect_database,
            commands::disconnect_database,
            commands::execute_query,
            commands::cancel_query,
            commands::get_databases,
            commands::get_tables,
            commands::get_table_schema,
            commands::get_table_detail_info,
            commands::get_table_indexes,
            commands::get_create_table,
            commands::get_table_summary,
            commands::update_column,
            commands::preview_alter_column_sql,
            // Table browsing/editing commands (parameter-bound)
            commands::fetch_table_rows,
            commands::get_primary_keys,
            commands::update_table_cell,
            commands::insert_table_row,
            commands::delete_table_rows,
            // Storage commands
            commands::load_saved_connections,
            commands::connect_saved_database,
            commands::save_connection,
            commands::delete_saved_connection,
            commands::update_last_database,
            // History commands
            commands::get_query_history,
            commands::add_query_history,
            commands::delete_query_history,
            commands::update_query_history,
            commands::search_query_history,
            // History groups commands
            commands::get_history_groups,
            commands::create_history_group,
            commands::update_history_group,
            commands::delete_history_group,
            // AI commands
            commands::respond_auto_query,
            commands::cancel_ai_request,
            commands::save_ai_api_key,
            commands::delete_ai_api_key,
            commands::has_ai_api_key,
            commands::get_all_api_key_status,
            commands::get_available_models,
            commands::set_ai_provider,
            commands::test_ai_connection,
            commands::verify_ai_api_key,
            commands::send_ai_message,
            commands::get_conversations,
            commands::get_conversation,
            commands::delete_conversation,
            commands::update_conversation,
            // RAG commands
            commands::start_rag_indexing_cmd,
            commands::check_rag_schema_changes,
            commands::sync_rag_schema_incremental,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
