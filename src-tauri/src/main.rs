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

fn read_migration_dir(dir: &str) -> Result<Vec<luminosql_core::migrations::MigrationFile>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("Cannot read migrations directory '{dir}': {e}"))?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Cannot list '{dir}': {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".sql") {
            continue;
        }
        let body = std::fs::read_to_string(entry.path()).map_err(|e| format!("Cannot read '{name}': {e}"))?;
        if let Some(m) = luminosql_core::migrations::parse_file(&name, &body) {
            files.push(m);
        }
    }
    files.sort_by(|a, b| a.version.cmp(&b.version).then(a.name.cmp(&b.name)));
    Ok(files)
}

#[tauri::command]
async fn list_migrations(dir: String) -> Result<Vec<luminosql_core::migrations::MigrationFile>, String> {
    read_migration_dir(&dir)
}

#[tauri::command]
async fn migration_status(
    state: State<'_, AppState>,
    id: String,
    dir: String,
) -> Result<Vec<luminosql_core::migrations::MigrationState>, FriendlyError> {
    let files = read_migration_dir(&dir).map_err(|e| FriendlyError::new(&e, "bad-dir", &[]))?;
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.migration_status(&id, files).await
}

#[tauri::command]
async fn migrate_up(state: State<'_, AppState>, id: String, dir: String, version: String) -> Result<(), FriendlyError> {
    let file = read_migration_dir(&dir)
        .map_err(|e| FriendlyError::new(&e, "bad-dir", &[]))?
        .into_iter()
        .find(|f| f.version == version)
        .ok_or_else(|| FriendlyError::new(&format!("Migration {version} not found."), "not-found", &[]))?;
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.migrate_up(&id, file).await
}

#[tauri::command]
async fn migrate_down(state: State<'_, AppState>, id: String, dir: String, version: String) -> Result<(), FriendlyError> {
    let file = read_migration_dir(&dir)
        .map_err(|e| FriendlyError::new(&e, "bad-dir", &[]))?
        .into_iter()
        .find(|f| f.version == version)
        .ok_or_else(|| FriendlyError::new(&format!("Migration {version} not found."), "not-found", &[]))?;
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.migrate_down(&id, file).await
}

#[tauri::command]
async fn create_migration(dir: String, name: String) -> Result<luminosql_core::migrations::MigrationFile, String> {
    let clean: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' }).collect();
    let clean = clean.trim_matches('_').to_string();
    if clean.is_empty() {
        return Err("Migration name must contain letters or digits.".to_string());
    }
    let files = read_migration_dir(&dir)?;
    let next = files.iter().filter_map(|f| f.version.parse::<u64>().ok()).max().unwrap_or(0) + 1;
    let filename = format!("{next:03}_{clean}.sql");
    let body = format!("-- {filename}\n\n\n-- DOWN\n");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create '{dir}': {e}"))?;
    std::fs::write(format!("{dir}/{filename}"), &body).map_err(|e| format!("Cannot write '{filename}': {e}"))?;
    luminosql_core::migrations::parse_file(&filename, &body).ok_or_else(|| "Template failed to parse.".to_string())
}
#[tauri::command]
async fn table_page(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
    opts: luminosql_core::db::tabledata::PageOpts,
) -> Result<luminosql_core::db::tabledata::TablePage, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.table_page(&id, &schema, &table, opts).await
}

#[tauri::command]
async fn update_cell(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
    pk: Vec<(String, Option<String>)>,
    column: String,
    value: Option<String>,
) -> Result<u64, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.update_cell(&id, &schema, &table, pk, &column, value).await
}

#[tauri::command]
async fn delete_row(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
    pk: Vec<(String, Option<String>)>,
) -> Result<u64, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.delete_row(&id, &schema, &table, pk).await
}

#[tauri::command]
async fn insert_row(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
    values: Vec<(String, Option<String>)>,
) -> Result<u64, FriendlyError> {
    state.mgr.lock().map_err(|e| FriendlyError::new("Internal lock error.", "lock", &[&e.to_string()]))?.insert_row(&id, &schema, &table, values).await
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
            table_page,
            update_cell,
            delete_row,
            insert_row,
            list_migrations,
            migration_status,
            migrate_up,
            migrate_down,
            create_migration,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run LuminosQL");
}
