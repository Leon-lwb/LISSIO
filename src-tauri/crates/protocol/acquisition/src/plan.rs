//! 点表读取窗口合并 — modbus 与 s7 适配器共用的唯一算法。
//!
//! 两个适配器只是分组键与窗口上限不同 (Modbus: 区域 + 周期, 上限为 PDU 寄存器
//! 数量; S7: 区域 + 数据块 + 周期, 上限为协商后的字节预算), 合并、排序与偏移
//! 计算逐行相同。这里持有唯一实现, 适配器把窗口映射回自己的公开 `ReadPlan`。

use points::PointId;
use std::collections::BTreeMap;

/// 参与窗口合并的点 — 由各适配器的点表类型实现
pub trait WindowPoint {
    /// 分组键 (区域 / 数据块 / 轮询周期)
    type Group: Ord;
    /// 分组键
    fn group(&self) -> Self::Group;
    /// 点位 id
    fn id(&self) -> &PointId;
    /// 起始地址 (寄存器号或字节偏移)
    fn start(&self) -> u32;
    /// 读取长度 (寄存器数或字节数)
    fn read_len(&self) -> u32;
}

/// 合并窗口内的点位 — 相对窗口起点的偏移
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannedPoint {
    pub point_id: PointId,
    pub offset: u32,
}

/// 一次读取窗口 — 同组、地址相邻且不超过上限的点
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadWindow<G> {
    pub group: G,
    pub start: u32,
    pub len: u16,
    pub points: Vec<PlannedPoint>,
}

/// 合并失败原因
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PlanError {
    #[error("invalid point configuration: {0}")]
    InvalidConfig(String),
}

/// 合并同组内地址相邻的点为一次读取窗口
///
/// `limit` 给出每组一次读取的最大长度 (寄存器数或字节数)。空隙不做投机读取。
///
/// # Errors
/// 窗口长度溢出 `u16` 或点位地址溢出时返回 [`PlanError::InvalidConfig`]。
pub fn plan_windows<'a, P, G, L>(
    points: impl IntoIterator<Item = &'a P>,
    limit: L,
) -> Result<Vec<ReadWindow<G>>, PlanError>
where
    P: WindowPoint<Group = G> + 'a,
    G: Ord + Clone,
    L: Fn(&G) -> u32,
{
    let mut groups: BTreeMap<G, Vec<&P>> = BTreeMap::new();
    for point in points {
        groups.entry(point.group()).or_default().push(point);
    }

    let mut windows = Vec::new();
    for (group, mut points) in groups {
        points.sort_by_key(|point| point.start());
        let max_len = limit(&group);
        let mut current: Option<ReadWindow<G>> = None;
        for point in points {
            let point_len = point.read_len();
            let end = point
                .start()
                .checked_add(point_len)
                .ok_or_else(|| PlanError::InvalidConfig(point.id().0.clone()))?;
            let can_join = current.as_ref().is_some_and(|window| {
                let window_end = window.start.saturating_add(u32::from(window.len));
                point.start() <= window_end && end.saturating_sub(window.start) <= max_len
            });
            if can_join {
                if let Some(window) = &mut current {
                    let window_end = end.max(window.start.saturating_add(u32::from(window.len)));
                    window.len = u16::try_from(window_end - window.start)
                        .map_err(|_| PlanError::InvalidConfig(point.id().0.clone()))?;
                    window.points.push(PlannedPoint {
                        point_id: point.id().clone(),
                        offset: point.start() - window.start,
                    });
                }
            } else {
                if let Some(window) = current.take() {
                    windows.push(window);
                }
                current = Some(ReadWindow {
                    group: group.clone(),
                    start: point.start(),
                    len: u16::try_from(point_len)
                        .map_err(|_| PlanError::InvalidConfig(point.id().0.clone()))?,
                    points: vec![PlannedPoint {
                        point_id: point.id().clone(),
                        offset: 0,
                    }],
                });
            }
        }
        if let Some(window) = current {
            windows.push(window);
        }
    }
    Ok(windows)
}
