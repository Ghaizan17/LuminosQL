//! MySQL / MariaDB adapter (sqlx + rustls).

use super::{FriendlyError, ServerInfo, CONNECT_TIMEOUT};
use sqlx::mysql::MySqlPoolOptions;

pub struct MysqlAdapter {
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
    pool: Option<sqlx::MySqlPool>,
}

impl MysqlAdapter {
    pub fn new(host: &str, port: u16, database: &str, username: &str, password: &str) -> Self {
        Self {
            host: host.to_string(),
            port,
            database: database.to_string(),
            username: username.to_string(),
            password: password.to_string(),
            pool: None,
        }
    }

    fn url(&self) -> String {
        format!(
            "mysql://{}:{}@{}:{}/{}",
            self.username, self.password, self.host, self.port, self.database
        )
    }
}
#[async_trait::async_trait]

impl super::DatabaseAdapter for MysqlAdapter {
    async fn connect(&mut self) -> Result<(), FriendlyError> {
        let pool = tokio::time::timeout(
            CONNECT_TIMEOUT,
            MySqlPoolOptions::new().max_connections(1).connect(&self.url()),
        )
        .await
        .map_err(|_| {
            FriendlyError::new(
                "Connection timed out.",
                "timeout",
                &["The server did not answer within 10 seconds.", "Host or port may be wrong."],
            )
        })?
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
        let (version,): (String,) = sqlx::query_as("SELECT VERSION()")
            .fetch_one(pool)
            .await
            .map_err(|e| map_error(&e.to_string()))?;
        Ok(ServerInfo {
            engine: "MySQL".to_string(),
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
    if m.contains("connection refused") {
        FriendlyError::new(
            "Could not connect to MySQL.",
            "connection-refused",
            &[
                "MySQL is not running on this host/port.",
                "Host or port is incorrect.",
                "A firewall may be blocking the connection.",
            ],
        )
    } else if m.contains("access denied") {
        FriendlyError::new(
            "MySQL rejected the credentials.",
            "auth-failed",
            &["Username or password is incorrect.", "Check the user exists and the host part allows this client."],
        )
    } else if m.contains("unknown database") {
        FriendlyError::new(
            "Database does not exist.",
            "unknown-database",
            &["The database name is misspelled.", "Create it first, then reconnect."],
        )
    } else {
        FriendlyError::new("MySQL error.", "driver-error", &[msg])
    }
}
