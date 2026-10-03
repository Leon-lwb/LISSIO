import type { EdgeClass, HirEdgeView, PortDomain } from '../../../store/slices/compileHir';

export interface EdgeModalState {
  open: boolean;
  mode: 'add' | 'modify';
  edge?: HirEdgeView;
  // 表单字段
  sourceNode: string;
  sourceHandle: string;
  targetNode: string;
  targetHandle: string;
}

export const EMPTY_MODAL: EdgeModalState = {
  open: false,
  mode: 'add',
  sourceNode: '',
  sourceHandle: '',
  targetNode: '',
  targetHandle: '',
};

/// 端口域 chip 颜色 (按域)
export const DOMAIN_CHIP_CLASS: Record<PortDomain, string> = {
  F32: 'state-info',
  Bytes: 'state-success',
  String: 'state-warning',
};

/// 边分类 badge 颜色
export function edgeClassChipClass(c: EdgeClass): string {
  switch (c.kind) {
    case 'byte':
      return 'state-success';
    case 'f32':
      return 'state-info';
    case 'str':
      return 'state-warning';
    case 'raw_data_marker':
      return 'state-neutral';
  }
}
