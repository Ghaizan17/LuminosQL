//! LuminosQL desktop entry. Thin IPC layer over `luminosql-core` —
//! all database, credential, and security logic lives in the core crate
//! (tested with plain `cargo test`, no GUI dependencies).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use luminosql_core::connections::{
    ConnectionManager, ConnectionProfile, FriendlyError, ServerInfo,
};
use luminosql_core::security::AnyStore;
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    mgr: Mutex<ConnectionManager<AnyStore>>,
}

#[derive(Debug, Serialize)]
struct ConnectionView {
    profile: ConnectionProfile,
    live: bool,
}

#[tauri::command]
async fn create_connection(
    state: State<'_, AppState>,
    mut profile: ConnectionProfile,
    password: String,
) -> Result<ConnectionProfile, Vec<String>> {
    if profile.id.is_empty() {
        profile.id = luminosql_core::connections::new_id();
    }
    state
        .mgr
        .lock()
        .map_err(|e| vec![e.to_string()])?
        .save_profile(profile, &password)
}

#[tauri::command]
async fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionView>, String> {
    let mgr = state.mgr.lock().map_err(|e| e.to_string())?;
    Ok(mgr
        .list_profiles()
        .into_iter()
        .map(|profile| {
            let live = mgr.is_live(&profile.id);
            ConnectionView { profile, live }
        })
        .collect())
}

#[tauri::command]
async fn connect(state: State<'_, AppState>, id: String) -> Result<ServerInfo, FriendlyError> {
    let profile = {
        let mgr = state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?;
        mgr.list_profiles().into_iter().find(|p| p.id == id).ok_or_else(|| {
            FriendlyError::new("Connection not found.", "not-found", &["It may have been deleted."])
        })?
    };
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.connect(&profile).await
}

#[tauri::command]
async fn disconnect(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mgr.lock().map_err(|e| e.to_string())?.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
async fn delete_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mgr.lock().map_err(|e| e.to_string())?.delete_profile(&id).await;
    Ok(())
}

#[tauri::command]
fn credential_store_status(state: State<'_, AppState>) -> Result<bool, String> {
    // True = OS keyring; false = session-memory fallback (never disk).
    Ok(state.mgr.lock().map_err(|e| e.to_string())?.store_os_backed())
}

/// Pure classifier for the ⚠ Destructive Query modal — no backend needed.
#[tauri::command]
fn classify_statement(sql: String) -> bool {
    luminosql_core::security::is_destructive(&sql)
}

#[tauri::command]
async fn list_schemas(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<luminosql_core::db::schema::SchemaInfo>, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.list_schemas(&id).await
}

#[tauri::command]
async fn list_tables(
    state: State<'_, AppState>,
    id: String,
    schema: String,
) -> Result<Vec<luminosql_core::db::schema::TableInfo>, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.list_tables(&id, &schema).await
}

#[tauri::command]
async fn describe_table(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
) -> Result<luminosql_core::db::schema::TableDef, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.describe_table(&id, &schema, &table).await
}

#[tauri::command]
async fn list_functions(
    state: State<'_, AppState>,
    id: String,
    schema: String,
) -> Result<Vec<luminosql_core::db::schema::FunctionInfo>, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.list_functions(&id, &schema).await
}

#[tauri::command]
async fn table_ddl(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
) -> Result<String, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.table_ddl(&id, &schema, &table).await
}

#[tauri::command]
async fn execute_sql(state: State<'_, AppState>, id: String, sql: String) -> Result<u64, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.execute(&id, &sql).await
}

#[tauri::command]
async fn run_query(
    state: State<'_, AppState>,
    id: String,
    sql: String,
) -> Result<luminosql_core::db::query::QueryPage, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.run_query(&id, &sql).await
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            mgr: Mutex::new(ConnectionManager::new(AnyStore::auto())),
        })
        .invoke_handler(tauri::generate_handler![
            create_connection,
            list_connections,
            connect,
            disconnect,
            delete_connection,
            credential_store_status,
            classify_statement,
            list_schemas,
            list_tables,
            describe_table,
            list_functions,
            table_ddl,
            execute_sql,
            run_query,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run LuminosQL");
}
