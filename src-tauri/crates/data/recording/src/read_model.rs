//! Read model — historical sessions, bindings, database info, and read-only SQL.
//!
//! Every read travels over the writer thread's **single** connection
//! ([`RecordingStore::reader`]); without an attached writer (construction, repair,
//! tests that open directly) it degrades to a private connection. The statements
//! themselves belong to the engine
//! ([`StoreSession`](crate::port::StoreSession)), so this module holds none.

use crate::{
    BindingInfo, HistoryPage, HistoryQuery, RecordingDatabaseInfo, RecordingError, RecordingStore,
    SessionInfo, SessionSummary,
};

impl RecordingStore {
    pub fn list_sessions(&self) -> Result<Vec<SessionInfo>, RecordingError> {
        match self.reader() {
            Some(reader) => reader.sessions(),
            None => self.connect_read_only()?.list_sessions(),
        }
    }

    /// Whether the session holds no batches at all (shared by the startup
    /// continuation probes).
    pub(crate) fn session_is_empty(&self, session_id: &str) -> Result<bool, RecordingError> {
        match self.reader() {
            Some(reader) => reader.session_is_empty(session_id),
            None => self.connect()?.session_is_empty(session_id),
        }
    }

    pub fn list_session_summaries(&self) -> Result<Vec<SessionSummary>, RecordingError> {
        match self.reader() {
            Some(reader) => reader.session_summaries(),
            None => self.connect_read_only()?.list_session_summaries(),
        }
    }

    pub fn list_bindings(&self, session_id: &str) -> Result<Vec<BindingInfo>, RecordingError> {
        match self.reader() {
            Some(reader) => reader.bindings(session_id),
            None => self.connect_read_only()?.list_bindings(session_id),
        }
    }

    pub fn database_info(&self) -> Result<RecordingDatabaseInfo, RecordingError> {
        match self.reader() {
            Some(reader) => reader.database_info(),
            None => self.connect_read_only()?.database_info(),
        }
    }

    pub fn history_page(
        &self,
        session_id: &str,
        binding_id: Option<&str>,
        after_row_id: i64,
        limit: usize,
        include_payload: bool,
    ) -> Result<HistoryPage, RecordingError> {
        self.history_page_query(&HistoryQuery {
            session_id: session_id.to_string(),
            binding_id: binding_id.map(ToString::to_string),
            after_row_id,
            from_us: None,
            to_us: None,
            limit,
            include_payload,
        })
    }

    pub fn history_page_query(&self, query: &HistoryQuery) -> Result<HistoryPage, RecordingError> {
        match self.reader() {
            Some(reader) => reader.history_page(query.clone()),
            None => self.connect_read_only()?.history_page(query),
        }
    }
}
