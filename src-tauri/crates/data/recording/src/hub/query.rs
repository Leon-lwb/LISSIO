//! 历史读取、导出与清理 — 全部经由在册 writer 的 store。
//!
//! 不可用时**必须带真实原因**: 打不开数据库时把 `unavailable` 里存着的 DuckDB 报错
//! 原样带出去, writer 已死时用健康报告里的原因替换通道层的 `Closed`。统一退化成
//! 「recording writer is closed」会让用户看到一个既真实又不可行动的提示, 而文件
//! 损坏、开关关掉这些真正可行动的信息只剩在健康报告里。

use std::sync::Arc;

use super::RecordingHub;
use crate::writer::QueryCancellation;
use crate::{
    BindingInfo, RecordingCleanupPolicy, RecordingCleanupResult, RecordingDatabaseInfo,
    RecordingError, RecordingStore, SessionSummary,
};

impl RecordingHub {
    pub fn delete_session(&self, session_id: &str) -> Result<(), RecordingError> {
        self.cleanup_sessions(RecordingCleanupPolicy {
            session_ids: Vec::from([session_id.to_string()]),
            ..RecordingCleanupPolicy::default()
        })
        .map(|_| ())
    }

    /// 一条读 — 没有 recorder 时带真实原因失败, writer 已死时把通道层的 `Closed`
    /// 换成健康报告里的原因。
    fn read<T>(
        &self,
        run: impl FnOnce(&RecordingStore) -> Result<T, RecordingError>,
    ) -> Result<T, RecordingError> {
        let store = self.store().ok_or_else(|| self.unavailable_error())?;
        run(&store).map_err(|error| self.explain_closed(error))
    }

    pub fn list_bindings(&self, session_id: &str) -> Result<Vec<BindingInfo>, RecordingError> {
        self.read(|store| store.list_bindings(session_id))
    }

    pub fn list_session_summaries(&self) -> Result<Vec<SessionSummary>, RecordingError> {
        let mut summaries = self.read(RecordingStore::list_session_summaries)?;
        if let Some(current_id) = self.current_session_id() {
            for summary in &mut summaries {
                if summary.session.id == current_id {
                    summary.active = true;
                }
            }
        }
        Ok(summaries)
    }

    pub fn database_info(&self) -> Result<RecordingDatabaseInfo, RecordingError> {
        self.read(RecordingStore::database_info)
    }

    pub fn cleanup_sessions(
        &self,
        policy: RecordingCleanupPolicy,
    ) -> Result<RecordingCleanupResult, RecordingError> {
        let sessions = self.read(RecordingStore::list_sessions)?;
        // 锁在块内释放: `unavailable_error` 自己还要拿一次读锁。
        let recorder = {
            let state = self.state.read();
            state.recorder.clone()
        }
        .ok_or_else(|| self.unavailable_error())?;
        let current_id = recorder.session().id.clone();
        let session_ids = super::cleanup_session_ids(&sessions, &current_id, &policy)?;
        if session_ids.is_empty() {
            return Ok(RecordingCleanupResult::default());
        }
        recorder
            .delete_sessions(session_ids)
            .map_err(|error| self.explain_closed(error))
    }

    /// 只读 SQL — 在写线程的**唯一**连接上执行 (不再新开实例), 可经
    /// [`Self::cancel_query`] 中断。
    pub fn query_sql(
        &self,
        query_id: &str,
        sql: &str,
        max_rows: usize,
    ) -> Result<crate::SqlResult, RecordingError> {
        if query_id.is_empty() {
            return Err(RecordingError::Invalid("query id is empty".into()));
        }
        let store = self.store().ok_or_else(|| self.unavailable_error())?;
        let cancellation = Arc::new(QueryCancellation::default());
        {
            let mut queries = self.queries.write();
            if queries.contains_key(query_id) {
                return Err(RecordingError::Invalid("query id is already active".into()));
            }
            queries.insert(query_id.to_string(), cancellation.clone());
        }
        let result = store.query_sql_cancellable(sql, max_rows, &cancellation);
        self.queries.write().remove(query_id);
        result.map_err(|error| self.explain_closed(error))
    }

    /// 取消进行中的查询 — 句柄由写线程在执行时登记, 取消先到也会被记住。
    pub fn cancel_query(&self, query_id: &str) -> bool {
        let cancellation = self.queries.read().get(query_id).cloned();
        cancellation.is_some_and(|cancellation| {
            cancellation.cancel();
            true
        })
    }
}
