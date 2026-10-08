//! `DatabaseAdapter` trait: every engine implements this, engine SQL stays inside.
//! Phase 3 adds schema introspection; Phases 4–5 add query execution.

use serde::Serialize;
use std::time::Duration;

pub mod ddl;
pub mod mysql;
pub mod postgres;
pub mod schema;
pub mod sqlite;

/// What a successful connection test reports back to the UI.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ServerInfo {
    pub engine: String,
    pub version: String,
    pub latency_ms: u64,
}

/// Actionable connection/query failure. Never contains secrets —
/// see `crate::security::redact` applied at construction.
#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[error("{title}")]
pub struct FriendlyError {
    pub title: String,
    pub causes: Vec<String>,
    pub code: String,
}

impl FriendlyError {
    pub fn new(title: &str, code: &str, causes: &[&str]) -> Self {
        Self {
            title: crate::security::redact(title),
            code: code.to_string(),
            causes: causes.iter().map(|c| crate::security::redact(c)).collect(),
        }
    }
}

/// Timeout for any single connection attempt / ping.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[async_trait::async_trait]
pub trait DatabaseAdapter: Send + Sync {
    /// Open the underlying connection (or pool with size 1 for Phase 2).
    async fn connect(&mut self) -> Result<(), FriendlyError>;
    /// Round-trip check on the live connection.
    async fn ping(&mut self) -> Result<ServerInfo, FriendlyError>;
    /// Close the connection. Idempotent.
    async fn disconnect(&mut self);
    fn is_connected(&self) -> bool;
    /// Schema names visible to this connection (system schemas excluded,
    /// except where the engine has no such concept).
    async fn list_schemas(&self) -> Result<Vec<schema::SchemaInfo>, FriendlyError>;
    /// Tables AND views of one schema, ordered by name.
    async fn list_tables(&self, schema: &str) -> Result<Vec<schema::TableInfo>, FriendlyError>;
    /// Full definition: columns, indexes, foreign keys.
    async fn describe_table(&self, schema: &str, table: &str) -> Result<schema::TableDef, FriendlyError>;
    /// Stored functions/procedures of one schema (empty where unsupported).
    async fn list_functions(&self, schema: &str) -> Result<Vec<schema::FunctionInfo>, FriendlyError>;
    /// Execute one DDL/DML statement. Returns rows affected.
    /// The caller gates destructive statements (see `classify`).
    async fn execute(&self, sql: &str) -> Result<u64, FriendlyError>;
}
