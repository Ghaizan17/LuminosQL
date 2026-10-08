//! PostgreSQL adapter (sqlx + rustls, no system TLS headers needed).

use super::{FriendlyError, ServerInfo, CONNECT_TIMEOUT};
use sqlx::postgres::PgPoolOptions;

pub struct PostgresAdapter {
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
    ssl: bool,
    pool: Option<sqlx::PgPool>,
}

impl PostgresAdapter {
    pub fn new(host: &str, port: u16, database: &str, username: &str, password: &str, ssl: bool) -> Self {
        Self {
            host: host.to_string(),
            port,
            database: database.to_string(),
            username: username.to_string(),
            password: password.to_string(),
            ssl,
            pool: None,
        }
    }

    fn url(&self) -> String {
        format!(
            "postgres://{}:{}@{}:{}/{}?sslmode={}",
            url_encode(&self.username),
            url_encode(&self.password),
            self.host,
            self.port,
            self.database,
            if self.ssl { "require" } else { "prefer" },
        )
    }
}

/// Minimal percent-encoding for URL userinfo segments (space, @, :, /, ?, #, %).
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[async_trait::async_trait]
impl super::DatabaseAdapter for PostgresAdapter {
    async fn connect(&mut self) -> Result<(), FriendlyError> {
        let pool = tokio::time::timeout(
            CONNECT_TIMEOUT,
            PgPoolOptions::new().max_connections(1).connect(&self.url()),
        )
        .await
        .map_err(|_| {
            FriendlyError::new(
                "Connection timed out.",
                "timeout",
                &["The server did not answer within 10 seconds.", "Host or port may be wrong."],
            )
        })?
        .map_err(|e| map_error("PostgreSQL", &e.to_string()))?;
        self.pool = Some(pool);
        Ok(())
    }

    async fn ping(&mut self) -> Result<ServerInfo, FriendlyError> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| FriendlyError::new("Not connected.", "not-connected", &[]))?;
        let start = std::time::Instant::now();
        let (version,): (String,) = sqlx::query_as("SHOW server_version")
            .fetch_one(pool)
            .await
            .map_err(|e| map_error("PostgreSQL", &e.to_string()))?;
        Ok(ServerInfo {
            engine: "PostgreSQL".to_string(),
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

pub(super) fn map_error(engine: &str, msg: &str) -> FriendlyError {
    let m = msg.to_lowercase();
    if m.contains("connection refused") {
        FriendlyError::new(
            &format!("Could not connect to {engine}."),
            "connection-refused",
            &[
                &format!("{engine} is not running on this host/port."),
                "Host or port is incorrect.",
                "A firewall may be blocking the connection.",
            ],
        )
    } else if m.contains("password authentication failed")
        || m.contains("invalid password")
        || m.contains("password must be")
    {
        FriendlyError::new(
            &format!("{engine} rejected the credentials."),
            "auth-failed",
            &["Username or password is incorrect.", "Check the role exists and the password matches."],
        )
    } else if m.contains("database") && m.contains("does not exist") {
        FriendlyError::new(
            "Database does not exist.",
            "unknown-database",
            &["The database name is misspelled.", "Create it first, then reconnect."],
        )
    } else if m.contains("no route to host") || m.contains("network is unreachable") {
        FriendlyError::new(
            &format!("{engine} host is unreachable."),
            "host-unreachable",
            &["The hostname is wrong.", "The machine is offline or on another network."],
        )
    } else {
        FriendlyError::new(&format!("{engine} error."), "driver-error", &[msg])
    }
}
