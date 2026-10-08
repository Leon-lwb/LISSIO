//! Read model — historical sessions, bindings, database info, and read-only SQL.
//!
//! Every read travels over the writer task's **single** connection
//! ([`RecordingStore::reader`]); without an attached writer (construction, repair,
//! tests that open directly) it degrades to a private connection, driven through
//! [`crate::block_on`] because that path never runs inside a runtime. The
//! statements themselves belong to the engine
//! ([`StoreSession`](crate::port::StoreSession)), so this module holds none.

use crate::{
    BindingInfo, HistoryPage, HistoryQuery, RecordingDatabaseInfo, RecordingError, RecordingStore,
    SessionInfo, SessionSummary,
};

impl RecordingStore {
    pub fn list_sessions(&self) -> Result<Vec<SessionInfo>, RecordingError> {
        if let Some(reader) = self.reader() {
            return reader.sessions();
        }
        crate::block_on(async {
            let mut session = self.engine().connect_read_only(self.path()).await?;
            session.list_sessions().await
        })
    }

    /// Whether the session holds no batches at all (shared by the startup
    /// continuation probes).
    pub(crate) fn session_is_empty(&self, session_id: &str) -> Result<bool, RecordingError> {
        if let Some(reader) = self.reader() {
            return reader.session_is_empty(session_id);
        }
        crate::block_on(async {
            let mut session = self.engine().connect(self.path()).await?;
            session.session_is_empty(session_id).await
        })
    }

    pub fn list_session_summaries(&self) -> Result<Vec<SessionSummary>, RecordingError> {
        if let Some(reader) = self.reader() {
            return reader.session_summaries();
        }
        crate::block_on(async {
            let mut session = self.engine().connect_read_only(self.path()).await?;
            session.list_session_summaries().await
        })
    }

    pub fn list_bindings(&self, session_id: &str) -> Result<Vec<BindingInfo>, RecordingError> {
        if let Some(reader) = self.reader() {
            return reader.bindings(session_id);
        }
        crate::block_on(async {
            let mut session = self.engine().connect_read_only(self.path()).await?;
            session.list_bindings(session_id).await
        })
    }

    pub fn database_info(&self) -> Result<RecordingDatabaseInfo, RecordingError> {
        if let Some(reader) = self.reader() {
            return reader.database_info();
        }
        crate::block_on(async {
            let mut session = self.engine().connect_read_only(self.path()).await?;
            session.database_info().await
        })
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
        if let Some(reader) = self.reader() {
            return reader.history_page(query.clone());
        }
        crate::block_on(async {
            let mut session = self.engine().connect_read_only(self.path()).await?;
            session.history_page(query).await
        })
    }
}
