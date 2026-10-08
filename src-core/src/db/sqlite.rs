//! SQLite adapter (file or `:memory:`). "Connect" opens the file and probes it.

use super::{FriendlyError, ServerInfo, CONNECT_TIMEOUT};
use sqlx::sqlite::SqlitePoolOptions;

pub struct SqliteAdapter {
    path: String,
    pool: Option<sqlx::SqlitePool>,
}

impl SqliteAdapter {
    pub fn new(path: &str) -> Self {
        Self { path: path.to_string(), pool: None }
    }

    fn url(&self) -> String {
        if self.path == ":memory:" {
            "sqlite::memory:".to_string()
        } else {
            format!("sqlite://{}?mode=rwc", self.path)
        }
    }
}

#[async_trait::async_trait]
impl super::DatabaseAdapter for SqliteAdapter {
    async fn connect(&mut self) -> Result<(), FriendlyError> {
        let pool = tokio::time::timeout(
            CONNECT_TIMEOUT,
            SqlitePoolOptions::new().max_connections(1).connect(&self.url()),
        )
        .await
        .map_err(|_| FriendlyError::new("Timed out opening the database file.", "timeout", &[]))?
        .map_err(|e| map_error(&e.to_string()))?;
        // Probe: opening a path never fails on its own (mode=rwc creates it),
        // so run a real query to surface permission / corruption errors now.
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| map_error(&e.to_string()))?;
        self.pool = Some(pool);
        Ok(())
    }

    async fn ping(&mut self) -> Result<ServerInfo, FriendlyError> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| FriendlyError::new("Not connected.", "not-connected", &[]))?;
        let start = std::time::Instant::now();
        let (version,): (String,) = sqlx::query_as("SELECT sqlite_version()")
            .fetch_one(pool)
            .await
            .map_err(|e| map_error(&e.to_string()))?;
        Ok(ServerInfo {
            engine: "SQLite".to_string(),
            version,
            latency_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn disconnect(&mut self) {
        if let Some(pool) = self.pool.take() {
            pool.close().await;
        }
    }

    fn is_connected(&self) -> bool {
        self.pool.as_ref().is_some_and(|p| !p.is_closed())
    }
}

fn map_error(msg: &str) -> FriendlyError {
    let m = msg.to_lowercase();
    if m.contains("unable to open database file") {
        FriendlyError::new(
            "Could not open the SQLite file.",
            "file-unopenable",
            &[
                "The directory does not exist or is not writable.",
                "The path is misspelled.",
                "Another process locked the file.",
            ],
        )
    } else if m.contains("file is not a database") {
        FriendlyError::new(
            "The file is not a SQLite database.",
            "not-a-database",
            &["The file is corrupt or a different format.", "Pick the correct file."],
        )
    } else {
        FriendlyError::new("SQLite error.", "driver-error", &[msg])
    }
}
