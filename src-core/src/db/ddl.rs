//! `CREATE TABLE` generation from a [`TableDef`](super::schema::TableDef).
//! Used by "Copy DDL / View definition". Dialect-aware per engine.

use crate::connections::Engine;
use super::schema::TableDef;

/// Render `CREATE TABLE <schema>.<table> (...)` for the target engine.
/// Native introspected types pass through untouched.
pub fn create_table(def: &TableDef, engine: Engine) -> String {
    let mut out = String::new();
    out.push_str(&format!("CREATE TABLE {} (\n", qualified(&def.schema, &def.name, engine)));
    let pk = def.pk_columns();
    let single_pk = pk.len() == 1;
    for (i, col) in def.columns.iter().enumerate() {
        out.push_str(&format!(
            "    {} {}{}",
            quote(&col.name, engine),
            col.data_type.clone(),
            if single_pk && col.pk_position.is_some() { " PRIMARY KEY" } else { "" },
        ));
        if !col.nullable {
            out.push_str(" NOT NULL");
        }
        if let Some(d) = &col.default {
            out.push_str(&format!(" DEFAULT {d}"));
        }
        if i + 1 < def.columns.len() || !pk.is_empty() && !single_pk || !def.foreign_keys.is_empty() {
            out.push(',');
        }
        out.push('\n');
    }
    if !single_pk && !pk.is_empty() {
        let cols: Vec<_> = pk.iter().map(|c| quote(&c.name, engine)).collect();
        out.push_str(&format!("    PRIMARY KEY ({})", cols.join(", ")));
        if !def.foreign_keys.is_empty() {
            out.push(',');
        }
        out.push('\n');
    }
    for (i, fk) in def.foreign_keys.iter().enumerate() {
        let cols: Vec<_> = fk.columns.iter().map(|c| quote(c, engine)).collect();
        let refs: Vec<_> = fk.ref_columns.iter().map(|c| quote(c, engine)).collect();
        out.push_str(&format!(
            "    CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
            quote(&fk.name, engine),
            cols.join(", "),
            qualified(&fk.ref_schema, &fk.ref_table, engine),
            refs.join(", ")
        ));
        if i + 1 < def.foreign_keys.len() {
            out.push(',');
        }
        out.push('\n');
    }
    out.push_str(");\n");
    for idx in &def.indexes {
        if idx.primary {
            continue;
        }
        let cols: Vec<_> = idx.columns.iter().map(|c| quote(c, engine)).collect();
        out.push_str(&format!(
            "CREATE {}INDEX {} ON {} ({});\n",
            if idx.unique { "UNIQUE " } else { "" },
            quote(&idx.name, engine),
            qualified(&def.schema, &def.name, engine),
            cols.join(", ")
        ));
    }
    out
}

fn qualified(schema: &str, table: &str, engine: Engine) -> String {
    match engine {
        // SQLite has no schemas in the introspected sense (`main` is implicit).
        Engine::Sqlite => quote(table, engine),
        _ => format!("{}.{}", quote(schema, engine), quote(table, engine)),
    }
}

fn quote(name: &str, engine: Engine) -> String {
    match engine {
        Engine::Mysql => format!("`{}`", name.replace('`', "``")),
        _ => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}


#[cfg(test)]
mod tests {
    use super::super::schema::*;
    use super::*;

    fn sample() -> TableDef {
        TableDef {
            schema: "public".to_string(),
            name: "orders".to_string(),
            kind: TableKind::Table,
            columns: vec![
                ColumnInfo {
                    name: "id".to_string(),
                    data_type: "bigint".to_string(),
                    nullable: false,
                    default: None,
                    pk_position: Some(1),
                },
                ColumnInfo {
                    name: "total".to_string(),
                    data_type: "numeric".to_string(),
                    nullable: true,
                    default: Some("0".to_string()),
                    pk_position: None,
                },
            ],
            indexes: vec![IndexInfo {
                name: "orders_total_idx".to_string(),
                columns: vec!["total".to_string()],
                unique: false,
                primary: false,
            }],
            foreign_keys: vec![],
        }
    }

    #[test]
    fn renders_single_pk_inline() {
        let ddl = create_table(&sample(), Engine::Postgres);
        assert!(ddl.contains("CREATE TABLE \"public\".\"orders\""), "{ddl}");
        assert!(ddl.contains("\"id\" bigint PRIMARY KEY"), "{ddl}");
        assert!(ddl.contains("CREATE INDEX \"orders_total_idx\""), "{ddl}");
    }

    #[test]
    fn sqlite_omits_schema_prefix_and_mysql_backticks() {
        let ddl = create_table(&sample(), Engine::Sqlite);
        assert!(ddl.contains("CREATE TABLE \"orders\""), "{ddl}");
        let my = create_table(&sample(), Engine::Mysql);
        assert!(my.contains("CREATE TABLE `public`.`orders`"), "{my}");
    }
}
