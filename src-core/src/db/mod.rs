//! `DatabaseAdapter` trait: every engine implements this, engine SQL stays inside.
//! Phase 2 ships connect/ping/server-info. Phases 3–5 add schema/query methods.

use serde::Serialize;
use std::time::Duration;

pub mod mysql;
pub mod postgres;
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
}
