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

    pub async fn run_query(&self, id: &str, sql: &str) -> Result<crate::db::query::QueryPage, FriendlyError> {
        self.live_adapter(id)?.query(sql).await
    }

    /// `CREATE TABLE` for an introspected table in its own dialect.
    pub async fn table_ddl(&self, id: &str, schema: &str, table: &str) -> Result<String, FriendlyError> {
        let profile = self.get_profile(id).ok_or_else(|| FriendlyError::new("Connection not found.", "not-found", &[]))?;
        let def = self.describe_table(id, schema, table).await?;
        Ok(crate::db::ddl::create_table(&def, profile.engine))
    }

    fn engine_of(&self, id: &str) -> Result<Engine, FriendlyError> {
        self.get_profile(id).map(|p| p.engine).ok_or_else(|| FriendlyError::new("Connection not found.", "not-found", &[]))
    }

    pub async fn table_page(
        &self,
        id: &str,
        schema: &str,
        table: &str,
        opts: crate::db::tabledata::PageOpts,
    ) -> Result<crate::db::tabledata::TablePage, FriendlyError> {
        let engine = self.engine_of(id)?;
        let (rows_sql, count_sql) = crate::db::tabledata::select_page(engine, schema, table, &opts);
        let adapter = self.live_adapter(id)?;
        let page = adapter.query(&rows_sql).await?;
        let count_page = adapter.query(&count_sql).await?;
        let total_rows = count_page.rows.first().and_then(|r| r.first()).and_then(|v| v.as_u64()).unwrap_or(0);
        let (page_index, page_size) = opts.safe();
        Ok(crate::db::tabledata::TablePage { page, total_rows, page_index, page_size })
    }

    pub async fn update_cell(
        &self,
        id: &str,
        schema: &str,
        table: &str,
        pk: Vec<(String, Option<String>)>,
        column: &str,
        value: Option<String>,
    ) -> Result<u64, FriendlyError> {
        let engine = self.engine_of(id)?;
        let sql = crate::db::tabledata::update_sql(engine, schema, table, &pk, column, &value)?;
        self.live_adapter(id)?.execute(&sql).await
    }

    pub async fn delete_row(
        &self,
        id: &str,
        schema: &str,
        table: &str,
        pk: Vec<(String, Option<String>)>,
    ) -> Result<u64, FriendlyError> {
        let engine = self.engine_of(id)?;
        let sql = crate::db::tabledata::delete_sql(engine, schema, table, &pk)?;
        self.live_adapter(id)?.execute(&sql).await
    }

    pub async fn insert_row(
        &self,
        id: &str,
        schema: &str,
        table: &str,
        values: Vec<(String, Option<String>)>,
    ) -> Result<u64, FriendlyError> {
        let engine = self.engine_of(id)?;
        let sql = crate::db::tabledata::insert_sql(engine, schema, table, &values);
        self.live_adapter(id)?.execute(&sql).await
    }

    async fn ensure_journal(&self, id: &str) -> Result<(), FriendlyError> {
        let engine = self.engine_of(id)?;
        self.live_adapter(id)?.execute(&crate::migrations::journal_ddl(engine)).await?;
        Ok(())
    }

    async fn applied_versions(&self, id: &str) -> Result<std::collections::HashMap<String, (String, String)>, FriendlyError> {
        self.ensure_journal(id).await?;
        let page = self
            .live_adapter(id)?
            .query(&format!("SELECT version, name, checksum FROM {}", crate::migrations::JOURNAL_TABLE))
            .await?;
        let mut map = std::collections::HashMap::new();
        for row in page.rows {
            let cells: Vec<String> = row.into_iter().map(|v| v.as_str().unwrap_or_default().to_string()).collect();
            if cells.len() >= 3 {
                map.insert(cells[0].clone(), (cells[1].clone(), cells[2].clone()));
            }
        }
        Ok(map)
    }

    pub async fn migration_status(
        &self,
        id: &str,
        files: Vec<crate::migrations::MigrationFile>,
    ) -> Result<Vec<crate::migrations::MigrationState>, FriendlyError> {
        let applied = self.applied_versions(id).await?;
        Ok(files
            .into_iter()
            .map(|f| {
                let (is_applied, ok) = match applied.get(&f.version) {
                    Some((_, sum)) => (true, *sum == f.checksum),
                    None => (false, true),
                };
                crate::migrations::MigrationState { version: f.version, name: f.name, applied: is_applied, checksum_ok: ok }
            })
            .collect())
    }

    async fn run_script(&self, id: &str, version: &str, script: &str) -> Result<(), FriendlyError> {
        let adapter = self.live_adapter(id)?;
        for stmt in crate::migrations::split_statements(script) {
            adapter.execute(&stmt).await.map_err(|e| {
                FriendlyError::new(
                    &format!("Migration {version} failed."),
                    &e.code,
                    &[&e.title, "Fix the migration file — nothing was recorded as applied."],
                )
            })?;
        }
        Ok(())
    }

    pub async fn migrate_up(&self, id: &str, file: crate::migrations::MigrationFile) -> Result<(), FriendlyError> {
        let applied = self.applied_versions(id).await?;
        if let Some((_, sum)) = applied.get(&file.version) {
            if *sum != file.checksum {
                return Err(FriendlyError::new(
                    &format!("Migration {} changed since it was applied.", file.version),
                    "checksum-mismatch",
                    &["The file no longer matches the applied checksum.", "Restore it or roll back first."],
                ));
            }
            return Ok(());
        }
        self.run_script(id, &file.version, &file.up_sql).await?;
        self.live_adapter(id)?
            .execute(&format!(
                "INSERT INTO {} (version, name, checksum) VALUES ('{}', '{}', '{}')",
                crate::migrations::JOURNAL_TABLE,
                file.version.replace('\'', "''"),
                file.name.replace('\'', "''"),
                file.checksum
            ))
            .await?;
        Ok(())
    }

    pub async fn migrate_down(&self, id: &str, file: crate::migrations::MigrationFile) -> Result<(), FriendlyError> {
        let down = file.down_sql.as_deref().ok_or_else(|| {
            FriendlyError::new(
                &format!("Migration {} has no DOWN section.", file.version),
                "irreversible",
                &["Add a `-- DOWN` section to roll this migration back."],
            )
        })?;
        let applied = self.applied_versions(id).await?;
        if !applied.contains_key(&file.version) {
            return Ok(());
        }
        self.run_script(id, &file.version, down).await?;
        self.live_adapter(id)?
            .execute(&format!(
                "DELETE FROM {} WHERE version = '{}'",
                crate::migrations::JOURNAL_TABLE,
                file.version.replace('\'', "''")
            ))
            .await?;
        Ok(())
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
    async fn sqlite_query_decodes_types_caps_rows_and_counts_dml() {
        use serde_json::Value;
        let mut mgr = ConnectionManager::new(MemoryStore::new());
        let profile = sqlite_profile(":memory:");
        mgr.connect(&profile).await.unwrap();
        let id = &profile.id;
        mgr.execute(id, "CREATE TABLE m (i INTEGER, r REAL, t TEXT, b BLOB, n TEXT)").await.unwrap();
        mgr.execute(id, "INSERT INTO m VALUES (42, 1.5, 'hi', x'00ff', NULL)").await.unwrap();

        let page = mgr.run_query(id, "SELECT * FROM m").await.unwrap();
        assert_eq!(page.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["i", "r", "t", "b", "n"]);
        assert_eq!(page.rows[0], [Value::from(42), Value::from(1.5), Value::from("hi"), Value::from("00ff"), Value::Null]);
        assert!(!page.truncated);

        // 600 rows → capped at 500 with truncation flag.
        mgr.execute(id, "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 600) INSERT INTO m (i) SELECT x FROM c").await.unwrap();
        let big = mgr.run_query(id, "SELECT i FROM m ORDER BY i").await.unwrap();
        assert_eq!(big.rows.len(), 500);
        assert!(big.truncated);

        // DML returns affected counts, no rows (i=42 exists twice: seed + CTE).
        let updated = mgr.run_query(id, "UPDATE m SET t = 'x' WHERE i = 42").await.unwrap();
        assert!(updated.rows.is_empty());
        assert_eq!(updated.rows_affected, 2);

        // Engine errors surface as friendly errors, secrets intact-free.
        let err = mgr.run_query(id, "SELECT nope FROM m").await.unwrap_err();
        assert!(!err.title.is_empty());
    }

    #[tokio::test]
    async fn sqlite_table_page_filters_sorts_and_mutates() {
        use crate::db::tabledata::{Filter, FilterOp, PageOpts, Sort};
        let mut mgr = ConnectionManager::new(MemoryStore::new());
        let profile = mgr.save_profile(sqlite_profile(":memory:"), "").expect("profile saves");
        mgr.connect(&profile).await.unwrap();
        let id = &profile.id;
        mgr.execute(id, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, total NUMERIC)").await.unwrap();
        mgr.execute(id, "INSERT INTO t VALUES (1, 'a', 10), (2, 'b', 200), (3, 'c', 30)").await.unwrap();

        let opts = PageOpts { page: 0, page_size: 50, sort: Some(Sort { column: "total".to_string(), desc: true }), filters: vec![Filter { column: "total".to_string(), op: FilterOp::Gt, value: "20".to_string() }] };
        let tp = mgr.table_page(id, "main", "t", opts).await.unwrap();
        assert_eq!(tp.total_rows, 2);
        assert_eq!(tp.page.rows.len(), 2);
        assert_eq!(tp.page.rows[0][1], serde_json::Value::from("b"));

        let p1 = mgr.table_page(id, "main", "t", PageOpts { page: 1, page_size: 10, sort: None, filters: vec![] }).await.unwrap();
        assert_eq!(p1.total_rows, 3);
        assert!(p1.page.rows.is_empty());

        let pk = vec![("id".to_string(), Some("1".to_string()))];
        assert_eq!(mgr.update_cell(id, "main", "t", pk.clone(), "name", Some("z".to_string())).await.unwrap(), 1);
        let one = mgr.run_query(id, "SELECT name FROM t WHERE id = 1").await.unwrap();
        assert_eq!(one.rows[0][0], serde_json::Value::from("z"));
        assert_eq!(mgr.delete_row(id, "main", "t", pk).await.unwrap(), 1);
        assert_eq!(mgr.insert_row(id, "main", "t", vec![("id".to_string(), Some("9".to_string())), ("name".to_string(), None), ("total".to_string(), Some("5".to_string()))]).await.unwrap(), 1);
        let count = mgr.table_page(id, "main", "t", PageOpts { page: 0, page_size: 50, sort: None, filters: vec![] }).await.unwrap();
        assert_eq!(count.total_rows, 3);
    }

    #[tokio::test]
    async fn sqlite_migration_up_down_cycle_with_guards() {
        use crate::migrations::parse_file;
        let mut mgr = ConnectionManager::new(MemoryStore::new());
        let profile = mgr.save_profile(sqlite_profile(":memory:"), "").expect("profile saves");
        mgr.connect(&profile).await.unwrap();
        let id = &profile.id;
        let m1 = parse_file("001_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);\n-- DOWN\nDROP TABLE users;").unwrap();
        let m2 = parse_file("002_seed.sql", "INSERT INTO users (email) VALUES ('a@x.io');").unwrap();

        let st = mgr.migration_status(id, vec![m1.clone(), m2.clone()]).await.unwrap();
        assert!(st.iter().all(|s| !s.applied));

        mgr.migrate_up(id, m1.clone()).await.unwrap();
        mgr.migrate_up(id, m2.clone()).await.unwrap();
        // Re-running applied migrations is a no-op, not an error.
        mgr.migrate_up(id, m1.clone()).await.unwrap();
        let st = mgr.migration_status(id, vec![m1.clone(), m2.clone()]).await.unwrap();
        assert!(st.iter().all(|s| s.applied && s.checksum_ok));
        let n = mgr.run_query(id, "SELECT COUNT(*) FROM users").await.unwrap();
        assert_eq!(n.rows[0][0], serde_json::Value::from(1));

        // Edited-after-apply is flagged and refuses to re-run.
        let edited = parse_file("001_users.sql", "CREATE TABLE users (id TEXT);\n-- DOWN\nDROP TABLE users;").unwrap();
        let st = mgr.migration_status(id, vec![edited]).await.unwrap();
        assert!(!st[0].checksum_ok);

        // Irreversible migration refuses rollback.
        let err = mgr.migrate_down(id, m2.clone()).await.unwrap_err();
        assert_eq!(err.code, "irreversible");

        // Rollback drops the table and clears the journal row.
        mgr.migrate_down(id, m1.clone()).await.unwrap();
        let st = mgr.migration_status(id, vec![m1.clone()]).await.unwrap();
        assert!(!st[0].applied);
        assert!(mgr.run_query(id, "SELECT * FROM users").await.is_err());
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
            mgr.execute(&profile.id, "INSERT INTO lumi_itest.users (email) VALUES ('a@x.io')").await.unwrap();
            let page = mgr.run_query(&profile.id, "SELECT id, email FROM lumi_itest.users").await.unwrap();
            assert_eq!(page.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["id", "email"]);
            assert_eq!(page.rows.len(), 1);
            assert_eq!(page.rows[0][1], serde_json::Value::from("a@x.io"));
            let bad = mgr.run_query(&profile.id, "SELECT nope FROM lumi_itest.users").await.unwrap_err();
            assert!(bad.title.contains("nope") || !bad.causes.is_empty(), "got: {bad:?}");
            // Migration up/down round-trip on the live server.
            let mig = crate::migrations::parse_file("090_lumi_itest.sql", "CREATE TABLE lumi_itest.mig (id BIGINT PRIMARY KEY);\n-- DOWN\nDROP TABLE lumi_itest.mig;").unwrap();
            mgr.migrate_up(&profile.id, mig.clone()).await.unwrap();
            let st = mgr.migration_status(&profile.id, vec![mig.clone()]).await.unwrap();
            assert!(st[0].applied && st[0].checksum_ok);
            mgr.migrate_down(&profile.id, mig).await.unwrap();
            let st = mgr.migration_status(&profile.id, vec![crate::migrations::parse_file("090_lumi_itest.sql", "CREATE TABLE lumi_itest.mig (id BIGINT PRIMARY KEY);\n-- DOWN\nDROP TABLE lumi_itest.mig;").unwrap()]).await.unwrap();
            assert!(!st[0].applied);
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
            mgr.execute(&profile.id, "INSERT INTO lumi_users (email) VALUES ('a@x.io')").await.unwrap();
            let page = mgr.run_query(&profile.id, "SELECT id, email FROM lumi_users").await.unwrap();
            assert_eq!(page.rows.len(), 1);
            assert_eq!(page.rows[0][1], serde_json::Value::from("a@x.io"));
            let mig = crate::migrations::parse_file("090_lumi_itest.sql", "CREATE TABLE lumi_mig (id BIGINT PRIMARY KEY);\n-- DOWN\nDROP TABLE lumi_mig;").unwrap();
            mgr.migrate_up(&profile.id, mig.clone()).await.unwrap();
            let st = mgr.migration_status(&profile.id, vec![mig.clone()]).await.unwrap();
            assert!(st[0].applied && st[0].checksum_ok);
            mgr.migrate_down(&profile.id, mig).await.unwrap();
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
