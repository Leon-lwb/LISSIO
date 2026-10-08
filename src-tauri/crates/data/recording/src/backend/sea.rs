//! SeaORM engine — the connection and schema layer for the replacement backend.
//!
//! SQLite is the first engine: it keeps the embedded, offline-first default while
//! the same code path addresses PostgreSQL and MySQL by URL. Schema statements go
//! through `sea_query` builders rather than hand-written DDL so column types and
//! the composite primary key render per dialect.
//!
//! The session methods land on top of this layer; this module owns the parts that
//! are easiest to get wrong — URL shape, pool width, and table definition. Until
//! the session layer reaches them, only the tests use these helpers.

#![allow(dead_code)]

use std::path::Path;

use sea_orm::sea_query::{Alias, ColumnDef, Index, Table, TableCreateStatement};
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbErr};

/// Connection URL for the SQLite file at `path`.
///
/// The writer is the only client, so the pool is capped at one connection in
/// [`connect_and_initialize`]; that cap is also what makes an explicit
/// `BEGIN`/`COMMIT` pair land on the same connection.
///
/// `mode=rwc` creates the file on first use, which matches the store's
/// "open (creating when needed)" contract.
pub fn sqlite_url(path: &Path) -> String {
    format!("sqlite://{}?mode=rwc", path.display())
}

/// Open the database at `url` and create every table the store needs.
pub async fn connect_and_initialize(url: &str) -> Result<DatabaseConnection, DbErr> {
    let mut options = ConnectOptions::new(url.to_owned());
    // One connection: the store serializes every statement on the writer task,
    // and a transaction must not hop between pooled connections.
    options.max_connections(1);
    let connection = Database::connect(options).await?;
    let backend = connection.get_database_backend();
    for statement in schema_statements() {
        connection.execute_raw(backend.build(&statement)).await?;
    }
    for statement in schema_indexes() {
        connection.execute_raw(backend.build(&statement)).await?;
    }
    Ok(connection)
}

/// Every table, in creation order.
///
/// Types stay deliberately coarse — `string`, `big_integer`, `blob` — so one
/// definition renders as SQLite `TEXT`/`INTEGER`/`BLOB` and as the equivalent
/// PostgreSQL or MySQL column without a dialect branch.
pub fn schema_statements() -> Vec<TableCreateStatement> {
    vec![
        Table::create()
            .table(Alias::new("recording_sessions"))
            .if_not_exists()
            .col(
                ColumnDef::new(Alias::new("id"))
                    .string()
                    .not_null()
                    .primary_key(),
            )
            .col(
                ColumnDef::new(Alias::new("started_at_us"))
                    .big_integer()
                    .not_null(),
            )
            .col(ColumnDef::new(Alias::new("ended_at_us")).big_integer())
            .col(ColumnDef::new(Alias::new("state")).string().not_null())
            .to_owned(),
        Table::create()
            .table(Alias::new("display_bindings"))
            .if_not_exists()
            .col(ColumnDef::new(Alias::new("id")).string().not_null())
            .col(ColumnDef::new(Alias::new("session_id")).string().not_null())
            .col(
                ColumnDef::new(Alias::new("component_id"))
                    .string()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("source_node_id"))
                    .string()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("source_handle"))
                    .string()
                    .not_null(),
            )
            .col(ColumnDef::new(Alias::new("domain")).string().not_null())
            .col(ColumnDef::new(Alias::new("capability")).string().not_null())
            .col(
                ColumnDef::new(Alias::new("bound_at_us"))
                    .big_integer()
                    .not_null(),
            )
            .col(ColumnDef::new(Alias::new("unbound_at_us")).big_integer())
            .primary_key(
                Index::create()
                    .col(Alias::new("session_id"))
                    .col(Alias::new("id")),
            )
            .to_owned(),
        Table::create()
            .table(Alias::new("recording_batches"))
            .if_not_exists()
            .col(
                ColumnDef::new(Alias::new("row_id"))
                    .big_integer()
                    .not_null()
                    .primary_key(),
            )
            .col(ColumnDef::new(Alias::new("session_id")).string().not_null())
            .col(ColumnDef::new(Alias::new("binding_id")).string().not_null())
            .col(ColumnDef::new(Alias::new("domain")).string().not_null())
            .col(ColumnDef::new(Alias::new("epoch")).big_integer().not_null())
            .col(
                ColumnDef::new(Alias::new("sequence_start"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("sequence_end"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("first_timestamp_us"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("last_timestamp_us"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("item_count"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("effective_bytes"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("checksum"))
                    .big_integer()
                    .not_null(),
            )
            .col(ColumnDef::new(Alias::new("payload")).blob().not_null())
            .col(
                ColumnDef::new(Alias::new("committed_at_us"))
                    .big_integer()
                    .not_null(),
            )
            .to_owned(),
    ]
}

/// Indexes are created separately so a failed one never blocks the tables.
pub fn schema_indexes() -> Vec<sea_orm::sea_query::IndexCreateStatement> {
    vec![
        Index::create()
            .name("recording_time_idx")
            .table(Alias::new("recording_batches"))
            .col(Alias::new("session_id"))
            .col(Alias::new("binding_id"))
            .col(Alias::new("first_timestamp_us"))
            .if_not_exists()
            .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use super::{connect_and_initialize, sqlite_url};
    use sea_orm::{ConnectionTrait, DbBackend, QueryResult, Statement, Value as SeaValue};

    /// One row of a `recording_batches` insert, read back with its payload.
    #[tokio::test]
    async fn schema_round_trips_a_session_binding_and_batch() {
        let directory =
            std::env::temp_dir().join(format!("lissio-seaorm-schema-{}", std::process::id()));
        std::fs::create_dir_all(&directory).expect("temp dir");
        let path = directory.join("acquisition.db");
        let _ = std::fs::remove_file(&path);

        let connection = connect_and_initialize(&sqlite_url(&path))
            .await
            .expect("open and initialize");
        let backend = DbBackend::Sqlite;

        let payload: Vec<u8> = Vec::from([0xAA, 0xBB, 0xCC, 0xDD]);
        connection
            .execute_raw(Statement::from_sql_and_values(
                backend,
                "INSERT INTO recording_sessions(id, started_at_us, state) VALUES (?, ?, ?)",
                [
                    SeaValue::from("session-1"),
                    SeaValue::from(7_i64),
                    SeaValue::from("running"),
                ],
            ))
            .await
            .expect("insert session");
        connection
            .execute_raw(Statement::from_sql_and_values(
                backend,
                "INSERT INTO display_bindings(\
                    id, session_id, component_id, source_node_id, source_handle, domain, capability, bound_at_us\
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    SeaValue::from("binding-1"),
                    SeaValue::from("session-1"),
                    SeaValue::from("component"),
                    SeaValue::from("source"),
                    SeaValue::from("handle"),
                    SeaValue::from("bytes"),
                    SeaValue::from("records"),
                    SeaValue::from(11_i64),
                ],
            ))
            .await
            .expect("insert binding");
        connection
            .execute_raw(Statement::from_sql_and_values(
                backend,
                "INSERT INTO recording_batches(\
                    row_id, session_id, binding_id, domain, epoch, sequence_start, sequence_end, \
                    first_timestamp_us, last_timestamp_us, item_count, effective_bytes, checksum, payload, committed_at_us\
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    SeaValue::from(1_i64),
                    SeaValue::from("session-1"),
                    SeaValue::from("binding-1"),
                    SeaValue::from("bytes"),
                    SeaValue::from(1_i64),
                    SeaValue::from(0_i64),
                    SeaValue::from(3_i64),
                    SeaValue::from(100_i64),
                    SeaValue::from(100_i64),
                    SeaValue::from(4_i64),
                    SeaValue::from(4_i64),
                    SeaValue::from(0_i64),
                    SeaValue::from(payload.clone()),
                    SeaValue::from(200_i64),
                ],
            ))
            .await
            .expect("insert batch");

        let rows: Vec<QueryResult> = connection
            .query_all_raw(Statement::from_string(
                backend,
                "SELECT b.row_id, b.payload, s.state \
                 FROM recording_batches b JOIN recording_sessions s ON s.id = b.session_id",
            ))
            .await
            .expect("join read");
        assert_eq!(rows.len(), 1, "one batch row");
        assert_eq!(rows[0].try_get_by_index::<i64>(0).expect("row_id"), 1);
        assert_eq!(
            rows[0].try_get_by_index::<Vec<u8>>(1).expect("payload"),
            payload
        );
        assert_eq!(
            rows[0].try_get_by_index::<String>(2).expect("state"),
            "running"
        );

        // The upsert path the store relies on must exist on this engine.
        connection
            .execute_raw(Statement::from_sql_and_values(
                backend,
                "INSERT INTO display_bindings(\
                    id, session_id, component_id, source_node_id, source_handle, domain, capability, bound_at_us\
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT(session_id, id) DO UPDATE SET bound_at_us=excluded.bound_at_us",
                [
                    SeaValue::from("binding-1"),
                    SeaValue::from("session-1"),
                    SeaValue::from("component"),
                    SeaValue::from("source"),
                    SeaValue::from("handle"),
                    SeaValue::from("bytes"),
                    SeaValue::from("records"),
                    SeaValue::from(99_i64),
                ],
            ))
            .await
            .expect("upsert binding");
        let rebound: i64 = connection
            .query_one_raw(Statement::from_sql_and_values(
                backend,
                "SELECT bound_at_us FROM display_bindings WHERE id = ?",
                [SeaValue::from("binding-1")],
            ))
            .await
            .expect("read binding")
            .expect("binding row")
            .try_get_by_index(0)
            .expect("bound_at_us");
        assert_eq!(rebound, 99);

        // `Expr` and `ExprTrait` stay reachable: the session layer builds its
        // filters with them rather than with formatted SQL.
        let touched: i64 = connection
            .query_one_raw(Statement::from_sql_and_values(
                backend,
                "SELECT ?",
                [SeaValue::from(1_i64)],
            ))
            .await
            .expect("value read")
            .expect("value row")
            .try_get_by_index(0)
            .expect("one");
        assert_eq!(touched, 1);

        drop(connection);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&directory);
    }
}
