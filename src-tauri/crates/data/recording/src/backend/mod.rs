//! Storage engines.
//!
//! Engine selection lives here: the single composition point that later grows a
//! settings-driven choice between compiled-in engines. Nothing above
//! [`crate::port`] names an engine type, so a new backend is one more module
//! plus one line in [`default_engine`].

mod duckdb;
mod duckdb_read_sql;
mod duckdb_sql;

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
