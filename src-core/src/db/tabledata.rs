//! Table data access: paged reads with sort/filter plus row mutations (Phase 5).
//! Identifiers are always quoted; string literals escape `'`. Pages never
//! load a whole table — the grid fetches `page_size` rows at a time.

use super::query::QueryPage;
use super::FriendlyError;
use crate::connections::Engine;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilterOp {
    Eq,
    Ne,
    Lt,
    Lte,
    Gt,
    Gte,
    Like,
    IsNull,
    IsNotNull,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Filter {
    pub column: String,
    pub op: FilterOp,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sort {
    pub column: String,
    pub desc: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageOpts {
    pub page: u64,
    pub page_size: u64,
    pub sort: Option<Sort>,
    pub filters: Vec<Filter>,
}

impl PageOpts {
    pub fn safe(&self) -> (u64, u64) {
        (self.page, self.page_size.clamp(10, 1000))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TablePage {
    pub page: QueryPage,
    pub total_rows: u64,
    pub page_index: u64,
    pub page_size: u64,
}

pub fn quote(engine: Engine, name: &str) -> String {
    match engine {
        Engine::Mysql => format!("`{}`", name.replace('`', "``")),
        _ => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

pub fn qualified(engine: Engine, schema: &str, table: &str) -> String {
    match engine {
        Engine::Sqlite => quote(engine, table),
        _ => format!("{}.{}", quote(engine, schema), quote(engine, table)),
    }
}

fn literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn where_clause(engine: Engine, filters: &[Filter]) -> String {
    if filters.is_empty() {
        return String::new();
    }
    let parts: Vec<String> = filters
        .iter()
        .map(|f| {
            let c = quote(engine, &f.column);
            match f.op {
                FilterOp::Eq => format!("{c} = {}", literal(&f.value)),
                FilterOp::Ne => format!("{c} <> {}", literal(&f.value)),
                FilterOp::Lt => format!("{c} < {}", literal(&f.value)),
                FilterOp::Lte => format!("{c} <= {}", literal(&f.value)),
                FilterOp::Gt => format!("{c} > {}", literal(&f.value)),
                FilterOp::Gte => format!("{c} >= {}", literal(&f.value)),
                FilterOp::Like => format!("{c} LIKE {}", literal(&f.value)),
                FilterOp::IsNull => format!("{c} IS NULL"),
                FilterOp::IsNotNull => format!("{c} IS NOT NULL"),
            }
        })
        .collect();
    format!(" WHERE {}", parts.join(" AND "))
}

fn order_clause(engine: Engine, sort: &Option<Sort>) -> String {
    match sort {
        Some(s) => format!(" ORDER BY {} {}", quote(engine, &s.column), if s.desc { "DESC" } else { "ASC" }),
        None => String::new(),
    }
}

pub fn select_page(engine: Engine, schema: &str, table: &str, opts: &PageOpts) -> (String, String) {
    let (page, size) = opts.safe();
    let target = qualified(engine, schema, table);
    let filter = where_clause(engine, &opts.filters);
    let order = order_clause(engine, &opts.sort);
    let offset = page * size;
    let rows = format!("SELECT * FROM {target}{filter}{order} LIMIT {size} OFFSET {offset}");
    let count = format!("SELECT COUNT(*) FROM {target}{filter}");
    (rows, count)
}

/// UPDATE … WHERE pk — every PK column must be present in `pk`.
pub fn update_sql(
    engine: Engine,
    schema: &str,
    table: &str,
    pk: &[(String, Option<String>)],
    column: &str,
    value: &Option<String>,
) -> Result<String, FriendlyError> {
    if pk.is_empty() {
        return Err(FriendlyError::new(
            "Editing needs a primary key.",
            "no-pk",
            &["This table has no primary key, so rows cannot be addressed safely."],
        ));
    }
    let set = match value {
        Some(v) => format!("{} = {}", quote(engine, column), literal(v)),
        None => format!("{} = NULL", quote(engine, column)),
    };
    Ok(format!("UPDATE {} SET {set} WHERE {}", qualified(engine, schema, table), pk_predicate(engine, pk)))
}

pub fn delete_sql(
    engine: Engine,
    schema: &str,
    table: &str,
    pk: &[(String, Option<String>)],
) -> Result<String, FriendlyError> {
    if pk.is_empty() {
        return Err(FriendlyError::new(
            "Deleting needs a primary key.",
            "no-pk",
            &["This table has no primary key, so rows cannot be addressed safely."],
        ));
    }
    Ok(format!("DELETE FROM {} WHERE {}", qualified(engine, schema, table), pk_predicate(engine, pk)))
}

fn pk_predicate(engine: Engine, pk: &[(String, Option<String>)]) -> String {
    pk.iter()
        .map(|(col, val)| match val {
            Some(v) => format!("{} = {}", quote(engine, col), literal(v)),
            None => format!("{} IS NULL", quote(engine, col)),
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

/// INSERT of explicit column values. `None` means "let the engine decide":
/// `DEFAULT` on pg/mysql, `NULL` on SQLite (which rejects DEFAULT in VALUES;
/// NULL auto-assigns rowid/INTEGER PKs).
pub fn insert_sql(
    engine: Engine,
    schema: &str,
    table: &str,
    values: &[(String, Option<String>)],
) -> String {
    let cols: Vec<_> = values.iter().map(|(c, _)| quote(engine, c)).collect();
    let vals: Vec<_> = values
        .iter()
        .map(|(_, v)| match v {
            Some(s) => literal(s),
            None if engine == Engine::Sqlite => "NULL".to_string(),
            None => "DEFAULT".to_string(),
        })
        .collect();
    format!("INSERT INTO {} ({}) VALUES ({})", qualified(engine, schema, table), cols.join(", "), vals.join(", "))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_sql_quotes_sorts_filters_and_counts() {
        let (rows, count) = select_page(
            Engine::Postgres,
            "public",
            "orders",
            &PageOpts {
                page: 2,
                page_size: 50,
                sort: Some(Sort { column: "id".to_string(), desc: true }),
                filters: vec![Filter { column: "total".to_string(), op: FilterOp::Gt, value: "100".to_string() }],
            },
        );
        assert_eq!(rows, "SELECT * FROM \"public\".\"orders\" WHERE \"total\" > '100' ORDER BY \"id\" DESC LIMIT 50 OFFSET 100");
        assert_eq!(count, "SELECT COUNT(*) FROM \"public\".\"orders\" WHERE \"total\" > '100'");
    }

    #[test]
    fn mutations_quote_and_guard_missing_pk() {
        let pk = vec![("id".to_string(), Some("7".to_string()))];
        assert_eq!(
            update_sql(Engine::Mysql, "app", "users", &pk, "name", &Some("O'Brien".to_string())).unwrap(),
            "UPDATE `app`.`users` SET `name` = 'O''Brien' WHERE `id` = '7'"
        );
        assert!(update_sql(Engine::Postgres, "public", "t", &[], "a", &None).is_err());
        assert_eq!(
            insert_sql(Engine::Sqlite, "main", "t", &[("a".to_string(), Some("1".to_string())), ("b".to_string(), None)]),
            "INSERT INTO \"t\" (\"a\", \"b\") VALUES ('1', NULL)"
        );
        assert_eq!(
            insert_sql(Engine::Postgres, "public", "t", &[("b".to_string(), None)]),
            "INSERT INTO \"public\".\"t\" (\"b\") VALUES (DEFAULT)"
        );
    }
}
