//! PostgreSQL adapter (sqlx + rustls, no system TLS headers needed).

use super::{FriendlyError, ServerInfo, CONNECT_TIMEOUT};
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;

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

    async fn list_schemas(&self) -> Result<Vec<super::schema::SchemaInfo>, FriendlyError> {
        let rows = sqlx::query(
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name NOT IN ('pg_catalog', 'information_schema') \
             AND schema_name NOT LIKE 'pg\\_%' ORDER BY schema_name",
        )
        .fetch_all(self.pg_pool()?)
        .await
        .map_err(|e| map_error("PostgreSQL", &e.to_string()))?;
        Ok(rows.into_iter().map(|r| super::schema::SchemaInfo { name: r.get("schema_name") }).collect())
    }

    async fn list_tables(&self, schema: &str) -> Result<Vec<super::schema::TableInfo>, FriendlyError> {
        let rows = sqlx::query(
            "SELECT table_name, table_type FROM information_schema.tables \
             WHERE table_schema = $1 AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_name",
        )
        .bind(schema)
        .fetch_all(self.pg_pool()?)
        .await
        .map_err(|e| map_error("PostgreSQL", &e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let t: String = r.get("table_type");
                super::schema::TableInfo {
                    schema: schema.to_string(),
                    name: r.get("table_name"),
                    kind: if t == "VIEW" { super::schema::TableKind::View } else { super::schema::TableKind::Table },
                }
            })
            .collect())
    }

    async fn describe_table(&self, schema: &str, table: &str) -> Result<super::schema::TableDef, FriendlyError> {
        use super::schema::*;
        let pool = self.pg_pool()?;
        let kind = self.table_kind(schema, table).await?;
        let col_rows = sqlx::query(
            "SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS data_type, \
             NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS default_value, \
             (SELECT k.ord FROM pg_constraint c \
              CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) \
              WHERE c.conrelid = t.oid AND c.contype = 'p' AND k.attnum = a.attnum) AS pk_position \
             FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace \
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped \
             LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum \
             WHERE n.nspname = $1 AND t.relname = $2 ORDER BY a.attnum",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| map_error("PostgreSQL", &e.to_string()))?;
        if col_rows.is_empty() {
            return Err(FriendlyError::new(
                &format!("Table \"{schema}\".\"{table}\" not found."),
                "unknown-table",
                &["It may have been dropped or renamed.", "Refresh the explorer and try again."],
            ));
        }
        let columns = col_rows
            .into_iter()
            .map(|r| ColumnInfo {
                name: r.get("name"),
                data_type: r.get("data_type"),
                nullable: r.get("nullable"),
                default: r.get("default_value"),
                pk_position: r.get::<Option<i64>, _>("pk_position"),
            })
            .collect();
        let idx_rows = sqlx::query(
            "SELECT c2.relname AS name, \
             ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) \
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.ord) AS cols, \
             i.indisunique AS unique_idx, i.indisprimary AS primary_idx \
             FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid \
             JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_class c2 ON c2.oid = i.indexrelid \
             WHERE n.nspname = $1 AND t.relname = $2 AND i.indisvalid ORDER BY c2.relname",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| map_error("PostgreSQL", &e.to_string()))?;
        let indexes = idx_rows
            .into_iter()
            .map(|r| IndexInfo {
                name: r.get("name"),
                columns: r.get("cols"),
                unique: r.get("unique_idx"),
                primary: r.get("primary_idx"),
            })
            .collect();
        let fk_rows = sqlx::query(
            "SELECT c.conname AS name, \
             ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) \
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS cols, \
             n2.nspname AS ref_schema, t2.relname AS ref_table, \
             ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord) \
             JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS ref_cols \
             FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid \
             JOIN pg_namespace n ON n.oid = t.relnamespace \
             JOIN pg_class t2 ON t2.oid = c.confrelid JOIN pg_namespace n2 ON n2.oid = t2.relnamespace \
             WHERE c.contype = 'f' AND n.nspname = $1 AND t.relname = $2 ORDER BY c.conname",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| map_error("PostgreSQL", &e.to_string()))?;
        let foreign_keys = fk_rows
            .into_iter()
            .map(|r| ForeignKeyInfo {
                name: r.get("name"),
                columns: r.get("cols"),
                ref_schema: r.get("ref_schema"),
                ref_table: r.get("ref_table"),
                ref_columns: r.get("ref_cols"),
            })
            .collect();
        Ok(TableDef { schema: schema.to_string(), name: table.to_string(), kind, columns, indexes, foreign_keys })
    }

    async fn list_functions(&self, schema: &str) -> Result<Vec<super::schema::FunctionInfo>, FriendlyError> {
        let rows = sqlx::query(
            "SELECT p.proname AS name, pg_get_function_arguments(p.oid) AS args, \
             pg_get_function_result(p.oid) AS result, l.lanname AS lang \
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace \
             JOIN pg_language l ON l.oid = p.prolang \
             WHERE n.nspname = $1 AND p.prokind IN ('f', 'p') ORDER BY p.proname",
        )
        .bind(schema)
        .fetch_all(self.pg_pool()?)
        .await
        .map_err(|e| map_error("PostgreSQL", &e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|r| super::schema::FunctionInfo {
                schema: schema.to_string(),
                name: r.get("name"),
                arguments: r.get("args"),
                return_type: r.get("result"),
                language: r.get("lang"),
            })
            .collect())
    }

    async fn execute(&self, sql: &str) -> Result<u64, FriendlyError> {
        Ok(sqlx::query(sql)
            .execute(self.pg_pool()?)
            .await
            .map_err(|e| map_error("PostgreSQL", &e.to_string()))?
            .rows_affected())
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
impl PostgresAdapter {
    fn pg_pool(&self) -> Result<&sqlx::PgPool, FriendlyError> {
        self.pool
            .as_ref()
            .ok_or_else(|| FriendlyError::new("Not connected.", "not-connected", &[]))
    }

    async fn table_kind(&self, schema: &str, table: &str) -> Result<super::schema::TableKind, FriendlyError> {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT table_type FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2",
        )
        .bind(schema)
        .bind(table)
        .fetch_optional(self.pg_pool()?)
        .await
        .map_err(|e| map_error("PostgreSQL", &e.to_string()))?;
        Ok(match row.map(|r| r.0).as_deref() {
            Some("VIEW") => super::schema::TableKind::View,
            _ => super::schema::TableKind::Table,
        })
    }
}
