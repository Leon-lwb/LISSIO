use crate::{S7Area, S7Point};
use acquisition::plan::{WindowPoint, plan_windows};
use points::PointId;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannedPoint {
    pub point_id: PointId,
    /// Byte offset of the point inside the merged read window.
    pub offset: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadPlan {
    pub area: S7Area,
    pub db_number: u16,
    pub period_ms: u64,
    pub start: u32,
    pub byte_count: u16,
    pub points: Vec<PlannedPoint>,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PlanError {
    #[error("invalid S7 configuration: {0}")]
    InvalidConfig(String),
    #[error("unknown S7 point: {0}")]
    UnknownPoint(String),
}

impl WindowPoint for S7Point {
    type Group = (S7Area, u16, u64);

    fn group(&self) -> Self::Group {
        (self.area, self.db_number, self.poll_period_ms)
    }

    fn id(&self) -> &PointId {
        &self.id
    }

    fn start(&self) -> u32 {
        self.byte_offset
    }

    fn read_len(&self) -> u32 {
        u32::from(self.read_byte_size())
    }
}

/// Merge byte-adjacent points into single-read windows.
///
/// Points sharing area, data block and poll period are combined. Gaps are not
/// read speculatively and each window is bounded by the negotiated PDU payload
/// budget so one window is exactly one S7 read item.
///
/// # Errors
/// 读取预算为 0 或配置/窗口长度非法时返回 [`PlanError`]。
pub fn plan_reads<'a>(
    points: impl IntoIterator<Item = &'a S7Point>,
    max_read_bytes: u32,
) -> Result<Vec<ReadPlan>, PlanError> {
    if max_read_bytes == 0 {
        return Err(PlanError::InvalidConfig(
            "read budget must be positive".into(),
        ));
    }
    let windows = plan_windows(points, |_| max_read_bytes)
        .map_err(|error| PlanError::InvalidConfig(error.to_string()))?;
    Ok(windows
        .into_iter()
        .map(|window| {
            let (area, db_number, period_ms) = window.group;
            ReadPlan {
                area,
                db_number,
                period_ms,
                start: window.start,
                byte_count: window.len,
                points: window
                    .points
                    .into_iter()
                    .map(|point| PlannedPoint {
                        point_id: point.point_id,
                        offset: point.offset,
                    })
                    .collect(),
            }
        })
        .collect())
}

#[cfg(test)]
#[path = "planner_tests.rs"]
mod tests;
