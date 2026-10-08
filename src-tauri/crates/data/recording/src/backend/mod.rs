//! Storage engines.
//!
//! Engine selection lives here: the single composition point that later grows a
//! settings-driven choice between compiled-in engines. Nothing above
//! [`crate::port`] names an engine type, so a new backend is one more module
//! plus one line in [`default_engine`].

mod duckdb;
mod duckdb_read_sql;
mod duckdb_sql;
// The SeaORM engine is compiled in behind `database`, but `default_engine` still
// selects DuckDB, so no production path constructs it yet and its whole module
// tree is unreachable. The `allow` is scoped to these modules and goes away with
// the engine switch, when `default_engine` selects `SeaOrmEngine`.
#[cfg(feature = "database")]
#[allow(dead_code)]
mod sea;
#[cfg(feature = "database")]
#[allow(dead_code)]
mod sea_cleanup;
#[cfg(feature = "database")]
#[allow(dead_code)]
mod sea_read_sql;
#[cfg(feature = "database")]
#[allow(dead_code)]
mod sea_sql;
#[cfg(all(test, feature = "database-sqlite"))]
mod sea_tests;

use std::sync::Arc;

use duckdb::DuckDbEngine;

use crate::port::StoreEngine;

/// The engine a store uses when the caller does not select one.
///
/// This is the seam a backend feature or setting replaces; every engine
/// implementation satisfies the same [`StoreEngine`] contract.
pub fn default_engine() -> Arc<dyn StoreEngine> {
    Arc::new(DuckDbEngine)
}
