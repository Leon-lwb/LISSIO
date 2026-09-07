use crate::{ModbusArea, ModbusPoint};
use points::PointId;
use std::collections::BTreeMap;

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

/// Merge consecutive points with the same area and poll period while respecting
/// Modbus PDU quantity limits. Gaps are not read speculatively.
pub fn plan_reads<'a>(
    points: impl IntoIterator<Item = &'a ModbusPoint>,
) -> Result<Vec<ReadPlan>, PlanError> {
    let mut groups: BTreeMap<(ModbusArea, u64), Vec<&ModbusPoint>> = BTreeMap::new();
    for point in points {
        groups
            .entry((point.area, point.poll_period_ms))
            .or_default()
            .push(point);
    }
    let mut plans = Vec::new();
    for ((area, period_ms), mut points) in groups {
        points.sort_by_key(|point| point.address);
        let mut current: Option<ReadPlan> = None;
        for point in points {
            let point_end = point.address.saturating_add(point.quantity());
            let can_join = current.as_ref().is_some_and(|plan| {
                let end = plan.start.saturating_add(plan.quantity);
                point.address <= end
                    && point_end.saturating_sub(plan.start) <= area.max_read_quantity()
            });
            if !can_join {
                if let Some(plan) = current.take() {
                    plans.push(plan);
                }
                current = Some(ReadPlan {
                    area,
                    period_ms,
                    start: point.address,
                    quantity: point.quantity(),
                    points: vec![PlannedPoint {
                        point_id: point.id.clone(),
                        offset: 0,
                    }],
                });
            } else if let Some(plan) = &mut current {
                plan.quantity = point_end.saturating_sub(plan.start).max(plan.quantity);
                plan.points.push(PlannedPoint {
                    point_id: point.id.clone(),
                    offset: point.address.saturating_sub(plan.start),
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
    use crate::{ByteOrder, ModbusDataType, WordOrder};

    fn point(id: &str, address: u16, data_type: ModbusDataType) -> ModbusPoint {
        ModbusPoint {
            id: PointId(id.into()),
            area: ModbusArea::HoldingRegisters,
            address,
            data_type,
            byte_order: ByteOrder::Big,
            word_order: WordOrder::Big,
            scale: 1.0,
            offset: 0.0,
            poll_period_ms: 100,
        }
    }

    #[test]
    fn merges_contiguous_registers() {
        let points = [
            point("a", 10, ModbusDataType::U16),
            point("b", 11, ModbusDataType::F32),
        ];
        let plans = plan_reads(&points).unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!((plans[0].start, plans[0].quantity), (10, 3));
    }

    #[test]
    fn does_not_merge_gaps_or_periods() {
        let mut points = [
            point("a", 10, ModbusDataType::U16),
            point("b", 12, ModbusDataType::U16),
        ];
        points[1].poll_period_ms = 200;
        assert_eq!(plan_reads(&points).unwrap().len(), 2);
    }
}
