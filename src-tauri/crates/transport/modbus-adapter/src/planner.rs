use crate::{ModbusArea, ModbusPoint};
use acquisition::plan::{WindowPoint, plan_windows};
use points::PointId;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannedPoint {
    pub point_id: PointId,
    pub offset: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadPlan {
    pub area: ModbusArea,
    pub period_ms: u64,
    pub start: u16,
    pub quantity: u16,
    pub points: Vec<PlannedPoint>,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PlanError {
    #[error("invalid Modbus configuration: {0}")]
    InvalidConfig(String),
    #[error("unknown Modbus point: {0}")]
    UnknownPoint(String),
}

impl WindowPoint for ModbusPoint {
    type Group = (ModbusArea, u64);

    fn group(&self) -> Self::Group {
        (self.area, self.poll_period_ms)
    }

    fn id(&self) -> &PointId {
        &self.id
    }

    fn start(&self) -> u32 {
        u32::from(self.address)
    }

    fn read_len(&self) -> u32 {
        u32::from(self.quantity())
    }
}

/// Merge consecutive points with the same area and poll period while respecting
/// Modbus PDU quantity limits. Gaps are not read speculatively.
///
/// # Errors
/// 配置或窗口长度非法时返回 [`PlanError`]。
pub fn plan_reads<'a>(
    points: impl IntoIterator<Item = &'a ModbusPoint>,
) -> Result<Vec<ReadPlan>, PlanError> {
    let windows = plan_windows(points, |(area, _)| u32::from(area.max_read_quantity()))
        .map_err(|error| PlanError::InvalidConfig(error.to_string()))?;
    windows
        .into_iter()
        .map(|window| {
            let (area, period_ms) = window.group;
            let start = u16::try_from(window.start)
                .map_err(|_| PlanError::InvalidConfig("read start exceeds u16".into()))?;
            let points = window
                .points
                .into_iter()
                .map(|point| {
                    Ok(PlannedPoint {
                        point_id: point.point_id,
                        offset: u16::try_from(point.offset).map_err(|_| {
                            PlanError::InvalidConfig("point offset exceeds u16".into())
                        })?,
                    })
                })
                .collect::<Result<Vec<_>, PlanError>>()?;
            Ok(ReadPlan {
                area,
                period_ms,
                start,
                quantity: window.len,
                points,
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "planner_tests.rs"]
mod tests;
