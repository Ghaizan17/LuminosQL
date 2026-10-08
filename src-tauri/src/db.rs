//! Database abstraction layer. Phase 1: trait + ping only.
//! Phase 2 adds `postgres.rs`, `mysql.rs`, `sqlite.rs` + pooling.

use serde::Serialize;

/// Every engine adapter implements this. Engine SQL stays in the impl.
#[allow(async_fn_in_trait)]
pub trait DatabaseAdapter {
    async fn ping(&self) -> Result<PingOk, DbError>;
}

#[derive(Debug, Serialize)]
pub struct PingOk {
    pub ok: bool,
}

#[derive(Debug, Serialize)]
pub struct DbError {
    pub message: String,
    pub hint: Option<String>,
}

#[tauri::command]
pub fn ping() -> PingOk {
    PingOk { ok: true }
}
