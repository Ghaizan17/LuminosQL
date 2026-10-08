//! Connection profiles + live-connection registry.
//!
//! [`ConnectionProfile`] holds everything EXCEPT the secret (which lives in the
//! [`CredentialStore`](crate::security::CredentialStore) under `credential_ref`).
//! [`ConnectionManager`] owns one adapter per live connection id.

use crate::db::{DatabaseAdapter, FriendlyError, ServerInfo};
use crate::security::CredentialStore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

pub const SERVICE_NAME: &str = "dev.luminosql.app";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Postgres,
    Mysql,
    Sqlite,
}

impl Engine {
    pub fn default_port(self) -> u16 {
        match self {
            Engine::Postgres => 5432,
            Engine::Mysql => 3306,
            Engine::Sqlite => 0,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Engine::Postgres => "PostgreSQL",
            Engine::Mysql => "MySQL",
            Engine::Sqlite => "SQLite",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub engine: Engine,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub ssl: bool,
}

impl ConnectionProfile {
    /// Validate user input BEFORE any network/file touch. Returns field-level errors.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut problems = Vec::new();
        if self.name.trim().is_empty() {
            problems.push("Name is required.".to_string());
        }
        match self.engine {
            Engine::Postgres | Engine::Mysql => {
                if self.host.trim().is_empty() {
                    problems.push("Host is required.".to_string());
                }
                if self.port == 0 {
                    problems.push("Port is required.".to_string());
                }
                if self.database.trim().is_empty() {
                    problems.push("Database is required.".to_string());
                }
                if self.username.trim().is_empty() {
                    problems.push("Username is required.".to_string());
                }
            }
            Engine::Sqlite => {
                if self.database.trim().is_empty() {
                    problems.push("File path is required.".to_string());
                }
            }
        }
        if problems.is_empty() { Ok(()) } else { Err(problems) }
    }

    pub fn credential_ref(&self) -> String {
        format!("luminosql/{}", self.id)
    }
}

pub struct ConnectionManager<S = crate::security::AnyStore> {
    store: S,
    live: HashMap<String, Box<dyn DatabaseAdapter>>,
    /// Saved profiles (sans secrets). In-memory for Phase 2; Phase 8 persists
    /// them to local SQLite. Secrets are always in the credential store.
    profiles: HashMap<String, ConnectionProfile>,
}
impl<S: CredentialStore> ConnectionManager<S> {
    pub fn new(store: S) -> Self {
        Self { store, live: HashMap::new(), profiles: HashMap::new() }
    }

    /// Validate, then save the profile + its secret. Returns the stored profile.
    pub fn save_profile(
        &mut self,
        mut profile: ConnectionProfile,
        password: &str,
    ) -> Result<ConnectionProfile, Vec<String>> {
        if profile.id.is_empty() {
            profile.id = new_id();
        }
        if profile.port == 0 {
            profile.port = profile.engine.default_port();
        }
        profile.validate()?;
        self.save_secret(&profile, password).map_err(|e| vec![e])?;
        self.profiles.insert(profile.id.clone(), profile.clone());
        Ok(profile)
    }

    pub fn list_profiles(&self) -> Vec<ConnectionProfile> {
        let mut out: Vec<_> = self.profiles.values().cloned().collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    /// Disconnect, forget the secret, drop the profile. Idempotent.
    pub async fn delete_profile(&mut self, id: &str) {
        self.disconnect(id).await;
        if let Some(profile) = self.profiles.remove(id) {
            let _ = self.forget_secret(&profile);
        }
    }

    /// Persist the profile's secret. Profiles themselves are stored by the caller
    /// (local SQLite metadata lands in Phase 8); the secret never leaves the store.
    pub fn save_secret(&self, profile: &ConnectionProfile, password: &str) -> Result<(), String> {
        if password.is_empty() {
            return Ok(());
        }
        self.store.set_password(SERVICE_NAME, &profile.credential_ref(), password)
    }

    pub fn forget_secret(&self, profile: &ConnectionProfile) -> Result<(), String> {
        self.store.delete_password(SERVICE_NAME, &profile.credential_ref())
    }

    fn password_for(&self, profile: &ConnectionProfile) -> Result<String, FriendlyError> {
        self.store
            .get_password(SERVICE_NAME, &profile.credential_ref())
            .map_err(|e| FriendlyError::new("Credential store unavailable.", "keyring", &[&e]))?
            .ok_or_else(|| match profile.engine {
                Engine::Sqlite => unreachable!("sqlite carries no password"),
                _ => FriendlyError::new(
                    "No password saved for this connection.",
                    "no-password",
                    &["Edit the connection and enter a password."],
                ),
            })
    }

    fn adapter_for(&self, profile: &ConnectionProfile) -> Result<Box<dyn DatabaseAdapter>, FriendlyError> {
        Ok(match profile.engine {
            Engine::Postgres => Box::new(crate::db::postgres::PostgresAdapter::new(
                &profile.host,
                profile.port,
                &profile.database,
                &profile.username,
                &self.password_for(profile)?,
                profile.ssl,
            )),
            Engine::Mysql => Box::new(crate::db::mysql::MysqlAdapter::new(
                &profile.host,
                profile.port,
                &profile.database,
                &profile.username,
                &self.password_for(profile)?,
            )),
            Engine::Sqlite => Box::new(crate::db::sqlite::SqliteAdapter::new(&profile.database)),
        })
    }

    /// Connect (or reconnect) and return server info for the status bar.
    pub async fn connect(&mut self, profile: &ConnectionProfile) -> Result<ServerInfo, FriendlyError> {
        if let Some(existing) = self.live.get_mut(&profile.id) {
            existing.disconnect().await;
        }
        let mut adapter = self.adapter_for(profile)?;
        adapter.connect().await?;
        let info = adapter.ping().await?;
        self.live.insert(profile.id.clone(), adapter);
        Ok(info)
    }

    pub async fn disconnect(&mut self, id: &str) {
        if let Some(mut adapter) = self.live.remove(id) {
            adapter.disconnect().await;
        }
    }

    pub fn is_live(&self, id: &str) -> bool {
        self.live.get(id).is_some_and(|a| a.is_connected())
    }
    pub fn get_profile(&self, id: &str) -> Option<ConnectionProfile> {
        self.profiles.get(id).cloned()
    }

    fn live_adapter(&self, id: &str) -> Result<&dyn DatabaseAdapter, FriendlyError> {
        self.live.get(id).map(|a| a.as_ref()).ok_or_else(|| {
            FriendlyError::new("Not connected.", "not-connected", &["Connect first, then browse the schema."])
        })
    }

    pub async fn list_schemas(&self, id: &str) -> Result<Vec<crate::db::schema::SchemaInfo>, FriendlyError> {
        self.live_adapter(id)?.list_schemas().await
    }

    pub async fn list_tables(&self, id: &str, schema: &str) -> Result<Vec<crate::db::schema::TableInfo>, FriendlyError> {
        self.live_adapter(id)?.list_tables(schema).await
    }

    pub async fn describe_table(
        &self,
        id: &str,
        schema: &str,
        table: &str,
    ) -> Result<crate::db::schema::TableDef, FriendlyError> {
        self.live_adapter(id)?.describe_table(schema, table).await
    }

    pub async fn list_functions(
        &self,
        id: &str,
        schema: &str,
    ) -> Result<Vec<crate::db::schema::FunctionInfo>, FriendlyError> {
        self.live_adapter(id)?.list_functions(schema).await
    }

    pub async fn execute(&self, id: &str, sql: &str) -> Result<u64, FriendlyError> {
        self.live_adapter(id)?.execute(sql).await
    }

    /// `CREATE TABLE` for an introspected table in its own dialect.
    pub async fn table_ddl(&self, id: &str, schema: &str, table: &str) -> Result<String, FriendlyError> {
        let profile = self.get_profile(id).ok_or_else(|| FriendlyError::new("Connection not found.", "not-found", &[]))?;
        let def = self.describe_table(id, schema, table).await?;
        Ok(crate::db::ddl::create_table(&def, profile.engine))
    }
}

pub type SharedManager<S = crate::security::AnyStore> = Arc<tokio::sync::Mutex<ConnectionManager<S>>>;
impl ConnectionManager<crate::security::AnyStore> {
    pub fn store_os_backed(&self) -> bool {
        self.store.is_os_backed()
    }
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::MemoryStore;

    fn sqlite_profile(path: &str) -> ConnectionProfile {
        ConnectionProfile {
            id: new_id(),
            name: "local".to_string(),
            engine: Engine::Sqlite,
            host: String::new(),
            port: 0,
            database: path.to_string(),
            username: String::new(),
            ssl: false,
        }
    }

    #[test]
    fn validation_is_field_specific() {
        let bad = ConnectionProfile {
            id: new_id(),
            name: String::new(),
            engine: Engine::Postgres,
            host: String::new(),
            port: 0,
            database: String::new(),
            username: String::new(),
            ssl: false,
        };
        let errs = bad.validate().unwrap_err();
        assert!(errs.iter().any(|e| e.contains("Name")));
        assert!(errs.iter().any(|e| e.contains("Host")));
    }
    #[tokio::test]
    async fn profile_registry_round_trip() {
        let mut mgr = ConnectionManager::new(MemoryStore::new());
        let saved = mgr.save_profile(sqlite_profile("/tmp/x.sqlite"), "").expect("valid profile saves");
        assert_eq!(mgr.list_profiles().len(), 1);
        mgr.delete_profile(&saved.id).await;
        assert!(mgr.list_profiles().is_empty());
    }

    #[tokio::test]
    async fn sqlite_memory_connects_and_pings() {
        let mgr = ConnectionManager::new(MemoryStore::new());
        let mut mgr = mgr;
        let profile = sqlite_profile(":memory:");
        let info = mgr.connect(&profile).await.expect("memory sqlite must connect");
        assert_eq!(info.engine, "SQLite");
        assert!(mgr.is_live(&profile.id));
        mgr.disconnect(&profile.id).await;
        assert!(!mgr.is_live(&profile.id));
    }

    #[tokio::test]
    async fn sqlite_missing_directory_is_friendly() {
        let mut mgr = ConnectionManager::new(MemoryStore::new());
        let err = mgr.connect(&sqlite_profile("/nonexistent-dir-xyz/db.sqlite")).await.unwrap_err();
        assert_eq!(err.code, "file-unopenable");
        assert!(!err.causes.is_empty());
    }
    #[tokio::test]
    async fn sqlite_introspection_covers_tables_views_indexes_fks() {
        use crate::db::schema::TableKind;
        let mut mgr = ConnectionManager::new(MemoryStore::new());
        let profile = sqlite_profile(":memory:");
        mgr.connect(&profile).await.expect("memory sqlite must connect");
        let id = &profile.id;
        mgr.execute(id, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE)")
            .await
            .unwrap();
        mgr.execute(id, "CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), total NUMERIC)")
            .await
            .unwrap();
        mgr.execute(id, "CREATE INDEX orders_user_idx ON orders (user_id)").await.unwrap();
        mgr.execute(id, "CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100").await.unwrap();

        assert_eq!(mgr.list_schemas(id).await.unwrap(), vec![crate::db::schema::SchemaInfo { name: "main".to_string() }]);
        let tables = mgr.list_tables(id, "main").await.unwrap();
        assert_eq!(tables.len(), 3);
        assert!(tables.iter().any(|t| t.name == "big_orders" && t.kind == TableKind::View));

        let def = mgr.describe_table(id, "main", "orders").await.unwrap();
        assert_eq!(def.columns.len(), 3);
        assert_eq!(def.pk_columns(), vec![&def.columns[0]]);
        // INTEGER PRIMARY KEY is a rowid alias: no autoindex, only the explicit one.
        assert_eq!(def.indexes.len(), 1);
        assert_eq!(def.indexes[0].name, "orders_user_idx");
        assert_eq!(def.foreign_keys[0].ref_table, "users");

        let missing = mgr.describe_table(id, "main", "nope").await.unwrap_err();
        assert_eq!(missing.code, "unknown-table");
    }

    #[tokio::test]
    async fn postgres_unreachable_is_friendly_without_server() {
        let mut mgr = ConnectionManager::new(MemoryStore::new());
        let profile = ConnectionProfile {
            id: new_id(),
            name: "x".to_string(),
            engine: Engine::Postgres,
            host: "127.0.0.1".to_string(),
            port: 1,
            database: "postgres".to_string(),
            username: "u".to_string(),
            ssl: false,
        };
        mgr.save_secret(&profile, "pw").unwrap();
        let err = mgr.connect(&profile).await.unwrap_err();
        // Refused (fast RST) or timeout (blackholed) — both must be friendly.
        assert!(!err.title.is_empty() && !err.causes.is_empty(), "got: {err:?}");
        assert!(!err.title.contains("pw") && !format!("{err:?}").contains("pw"));
    }

    #[tokio::test]
    async fn mysql_unreachable_is_friendly_without_server() {
        let mut mgr = ConnectionManager::new(MemoryStore::new());
        let profile = ConnectionProfile {
            id: new_id(),
            name: "x".to_string(),
            engine: Engine::Mysql,
            host: "127.0.0.1".to_string(),
            port: 1,
            database: "mysql".to_string(),
            username: "u".to_string(),
            ssl: false,
        };
        mgr.save_secret(&profile, "pw").unwrap();
        let err = mgr.connect(&profile).await.unwrap_err();
        assert!(!err.title.is_empty() && !err.causes.is_empty(), "got: {err:?}");
        assert!(!format!("{err:?}").contains("pw"));
    }

    /// Live-server tests. Set LUMINOSQL_TEST_PG_URL (e.g.
    /// `postgres://user:pass@127.0.0.1:5433/db`) and LUMINOSQL_TEST_MYSQL_URL to run.
    mod live {
        use super::*;

        fn pg_profile_from(url: &url_parts::Parts) -> (ConnectionProfile, String) {
            let p = ConnectionProfile {
                id: new_id(),
                name: "itest-pg".to_string(),
                engine: Engine::Postgres,
                host: url.host.clone(),
                port: url.port,
                database: url.database.clone(),
                username: url.user.clone(),
                ssl: false,
            };
            let pw = url.password.clone();
            (p, pw)
        }

        #[tokio::test]
        async fn postgres_live_connect_ping_and_auth_errors() {
            let Some(raw) = std::env::var("LUMINOSQL_TEST_PG_URL").ok() else { return };
            let url = url_parts::parse(&raw).expect("parse test pg url");
            let (profile, pw) = pg_profile_from(&url);
            let mut mgr = ConnectionManager::new(MemoryStore::new());
            let profile = mgr.save_profile(profile, &pw).expect("profile saves");
            let info = mgr.connect(&profile).await.expect("live pg must connect");
            assert_eq!(info.engine, "PostgreSQL");
            assert!(mgr.is_live(&profile.id));
            // Introspection round-trip on a scratch schema.
            mgr.execute(&profile.id, "DROP SCHEMA IF EXISTS lumi_itest CASCADE").await.unwrap();
            mgr.execute(&profile.id, "CREATE SCHEMA lumi_itest").await.unwrap();
            mgr.execute(&profile.id, "CREATE TABLE lumi_itest.users (id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL)").await.unwrap();
            mgr.execute(&profile.id, "CREATE TABLE lumi_itest.orders (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES lumi_itest.users(id), total NUMERIC)").await.unwrap();
            mgr.execute(&profile.id, "CREATE INDEX orders_user_idx ON lumi_itest.orders (user_id)").await.unwrap();
            let schemas = mgr.list_schemas(&profile.id).await.unwrap();
            assert!(schemas.iter().any(|s| s.name == "lumi_itest"), "{schemas:?}");
            assert!(!schemas.iter().any(|s| s.name == "pg_catalog"));
            let tables = mgr.list_tables(&profile.id, "lumi_itest").await.unwrap();
            assert_eq!(tables.len(), 2);
            let def = mgr.describe_table(&profile.id, "lumi_itest", "orders").await.unwrap();
            assert_eq!(def.columns.len(), 3);
            assert_eq!(def.pk_columns().len(), 1);
            assert_eq!(def.foreign_keys.len(), 1);
            assert_eq!(def.foreign_keys[0].ref_table, "users");
            assert!(def.indexes.iter().any(|i| i.name == "orders_user_idx"));
            let ddl = mgr.table_ddl(&profile.id, "lumi_itest", "users").await.unwrap();
            assert!(ddl.contains("CREATE TABLE \"lumi_itest\".\"users\""), "{ddl}");
            mgr.execute(&profile.id, "DROP SCHEMA lumi_itest CASCADE").await.unwrap();
            mgr.disconnect(&profile.id).await;
            assert!(!mgr.is_live(&profile.id));

            let bad_pw = ConnectionProfile { id: new_id(), ..profile.clone() };
            mgr.save_secret(&bad_pw, "definitely-wrong-pw").unwrap();
            let err = mgr.connect(&bad_pw).await.unwrap_err();
            assert_eq!(err.code, "auth-failed", "got: {err:?}");

            let bad_db = ConnectionProfile {
                id: new_id(),
                database: "no_such_db_xyz".to_string(),
                ..profile.clone()
            };
            mgr.save_secret(&bad_db, &pw).unwrap();
            let err = mgr.connect(&bad_db).await.unwrap_err();
            assert_eq!(err.code, "unknown-database", "got: {err:?}");
        }

        #[tokio::test]
        async fn mysql_live_connect_ping_and_auth_errors() {
            let Some(raw) = std::env::var("LUMINOSQL_TEST_MYSQL_URL").ok() else { return };
            let url = url_parts::parse(&raw).expect("parse test mysql url");
            let profile = ConnectionProfile {
                id: new_id(),
                name: "itest-my".to_string(),
                engine: Engine::Mysql,
                host: url.host.clone(),
                port: url.port,
                database: url.database.clone(),
                username: url.user.clone(),
                ssl: false,
            };
            let mut mgr = ConnectionManager::new(MemoryStore::new());
            let profile = mgr.save_profile(profile, &url.password).expect("profile saves");
            let info = mgr.connect(&profile).await.expect("live mysql must connect");
            assert_eq!(info.engine, "MySQL");
            mgr.execute(&profile.id, "DROP TABLE IF EXISTS lumi_orders").await.unwrap();
            mgr.execute(&profile.id, "DROP TABLE IF EXISTS lumi_users").await.unwrap();
            mgr.execute(&profile.id, "CREATE TABLE lumi_users (id BIGINT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL)").await.unwrap();
            mgr.execute(&profile.id, "CREATE TABLE lumi_orders (id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT, total DECIMAL(10,2), CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES lumi_users(id))").await.unwrap();
            let tables = mgr.list_tables(&profile.id, &profile.database).await.unwrap();
            assert!(tables.iter().any(|t| t.name == "lumi_orders"));
            let def = mgr.describe_table(&profile.id, &profile.database, "lumi_orders").await.unwrap();
            assert_eq!(def.columns.len(), 3);
            assert_eq!(def.pk_columns().len(), 1);
            assert_eq!(def.foreign_keys.len(), 1);
            assert_eq!(def.foreign_keys[0].ref_table, "lumi_users");
            let ddl = mgr.table_ddl(&profile.id, &profile.database, "lumi_users").await.unwrap();
            assert!(ddl.contains("CREATE TABLE"), "{ddl}");
            mgr.execute(&profile.id, "DROP TABLE lumi_orders").await.unwrap();
            mgr.execute(&profile.id, "DROP TABLE lumi_users").await.unwrap();
            mgr.disconnect(&profile.id).await;

            let bad_pw = ConnectionProfile { id: new_id(), ..profile.clone() };
            mgr.save_secret(&bad_pw, "definitely-wrong-pw").unwrap();
            let err = mgr.connect(&bad_pw).await.unwrap_err();
            assert_eq!(err.code, "auth-failed", "got: {err:?}");
        }
    }

    /// Minimal `scheme://user:pass@host:port/db` parser for test URLs only.
    mod url_parts {
        pub struct Parts {
            pub host: String,
            pub port: u16,
            pub database: String,
            pub user: String,
            pub password: String,
        }

        pub fn parse(raw: &str) -> Option<Parts> {
            let after_scheme = raw.split("://").nth(1)?;
            let (userinfo, hostpart) = after_scheme.split_once('@')?;
            let (user, password) = userinfo.split_once(':')?;
            let (hostport, database) = hostpart.split_once('/')?;
            let (host, port) = hostport.split_once(':')?;
            Some(Parts {
                host: host.to_string(),
                port: port.parse().ok()?,
                database: database.to_string(),
                user: user.to_string(),
                password: password.to_string(),
            })
        }
    }
}
