//! 控件端口视图类型 — 端口内容来自 describe_node_documents (单一权威),
//! 本模块只保留画布渲染所需的最小形状。

import type { DomainType } from '../../types';

/// 端口定义 — domain 标注该端口承载的是时域还是频域信号
export interface WidgetPort {
  id: string;
  label: string;
  domain: DomainType;
}
