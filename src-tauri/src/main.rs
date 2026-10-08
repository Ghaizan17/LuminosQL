//! LuminosQL backend entry. Phase 1: shell only — no DB commands yet.
//! Phase 2 will register `db::` commands and the connection pool here.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod security;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![db::ping])
        .run(tauri::generate_context!())
        .expect("failed to run LuminosQL");
}
