use crate::{S7Area, S7Point};
use points::PointId;
use std::collections::BTreeMap;

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

/// Merge byte-adjacent points into single-read windows.
///
/// Points sharing area, data block and poll period are combined. Gaps are not
/// read speculatively and each window is bounded by the negotiated PDU payload
/// budget so one window is exactly one S7 read item.
pub fn plan_reads<'a>(
    points: impl IntoIterator<Item = &'a S7Point>,
    max_read_bytes: u32,
) -> Result<Vec<ReadPlan>, PlanError> {
    if max_read_bytes == 0 {
        return Err(PlanError::InvalidConfig(
            "read budget must be positive".into(),
        ));
    }
    let mut groups: BTreeMap<(S7Area, u16, u64), Vec<&S7Point>> = BTreeMap::new();
    for point in points {
        groups
            .entry((point.area, point.db_number, point.poll_period_ms))
            .or_default()
            .push(point);
    }
    let mut plans = Vec::new();
    for ((area, db_number, period_ms), mut points) in groups {
        points.sort_by_key(|point| point.byte_offset);
        let mut current: Option<ReadPlan> = None;
        for point in points {
            let end = point
                .byte_offset
                .checked_add(u32::from(point.read_byte_size()))
                .ok_or_else(|| PlanError::InvalidConfig(point.id.0.clone()))?;
            let can_join = current.as_ref().is_some_and(|plan| {
                let window_end = plan.start.saturating_add(u32::from(plan.byte_count));
                point.byte_offset <= window_end && end.saturating_sub(plan.start) <= max_read_bytes
            });
            if !can_join {
                if let Some(plan) = current.take() {
                    plans.push(plan);
                }
                current = Some(ReadPlan {
                    area,
                    db_number,
                    period_ms,
                    start: point.byte_offset,
                    byte_count: point.read_byte_size(),
                    points: vec![PlannedPoint {
                        point_id: point.id.clone(),
                        offset: 0,
                    }],
                });
            } else if let Some(plan) = &mut current {
                let window_end = end.max(plan.start.saturating_add(u32::from(plan.byte_count)));
                plan.byte_count = u16::try_from(window_end - plan.start)
                    .map_err(|_| PlanError::InvalidConfig(point.id.0.clone()))?;
                plan.points.push(PlannedPoint {
                    point_id: point.id.clone(),
                    offset: point.byte_offset - plan.start,
                });
            }
        }
        if let Some(plan) = current {
            plans.push(plan);
        }
    }
    Ok(plans)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::S7DataType;
    use points::PointId;

    fn point(
        id: &str,
        area: S7Area,
        db_number: u16,
        byte_offset: u32,
        size: S7DataType,
    ) -> S7Point {
        S7Point {
            id: PointId(id.into()),
            area,
            db_number,
            byte_offset,
            bit: 0,
            data_type: size,
            scale: 1.0,
            offset: 0.0,
            poll_period_ms: 100,
        }
    }

    #[test]
    fn merges_contiguous_bytes_within_the_same_block() {
        let points = [
            point("a", S7Area::Db, 10, 0, S7DataType::U16),
            point("b", S7Area::Db, 10, 2, S7DataType::F32),
        ];
        let plans = plan_reads(&points, 200).unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].start, 0);
        assert_eq!(plans[0].byte_count, 6);
        assert_eq!(plans[0].points[1].offset, 2);
    }

    #[test]
    fn splits_on_area_db_gap_and_period() {
        let mut points = [
            point("a", S7Area::Db, 10, 0, S7DataType::U16),
            point("b", S7Area::Db, 10, 2, S7DataType::U16),
            point("c", S7Area::Markers, 0, 4, S7DataType::U16),
            point("d", S7Area::Db, 11, 6, S7DataType::U16),
        ];
        points[1].poll_period_ms = 200;
        points[2].byte_offset = 100;
        let plans = plan_reads(&points, 200).unwrap();
        assert_eq!(plans.len(), 4);
    }

    #[test]
    fn respects_the_read_budget() {
        let points = [
            point("a", S7Area::Db, 10, 0, S7DataType::U16),
            point("b", S7Area::Db, 10, 2, S7DataType::U16),
        ];
        let plans = plan_reads(&points, 2).unwrap();
        assert_eq!(plans.len(), 2);
    }

    #[test]
    fn bools_share_their_containing_byte() {
        let mut a = point("a", S7Area::Markers, 0, 1, S7DataType::Bool);
        let mut b = point("b", S7Area::Markers, 0, 1, S7DataType::Bool);
        a.bit = 2;
        b.bit = 5;
        let plans = plan_reads(&[a, b], 200).unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].byte_count, 1);
    }
}
