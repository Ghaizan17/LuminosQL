//! LuminosQL core: database adapters, connection manager, security primitives.
//! No Tauri/GUI dependencies — `cargo test` runs anywhere.
pub mod connections;
pub mod db;
pub mod migrations;
pub mod security;
