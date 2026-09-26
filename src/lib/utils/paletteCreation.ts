import { useAppStore } from '../../store/appStore';
import { addAcquisitionNode } from '../acquisition/acquisitionNodes';
import type { DeviceCardModel } from '../acquisition/deviceCardModel';
import type { DiscoveredEndpoint } from '../../types';
import { applyTestAttribute } from '../acquisition/simulation';
import { createNodeFromCatalog, CatalogError } from '../models/createFromCatalog';
import { notify, formatError } from '../tauri/notifications';
import { t } from '../../i18n';

/// 面板创建条目的公共形状 (PaletteEntry 与 WidgetDragSpec 的交集)
export interface PaletteCreateSpec {
  modelId?: string;
  variantId?: string;
  documentLabel?: string;
  nodeType?: 'protocol' | 'acquisition' | 'point-selector';
  attribute?: 'test-data';
  acquisition?: DeviceCardModel;
  discoveredEndpoint?: DiscoveredEndpoint;
}

/// 点击与画布投放共用的创建入口。
///
/// - test-data 属性 → 测试属性注入
/// - 设备 → 目录 `driver:*` 创建 + 能力端点绑定 (点击的发现端点经 configPatch
///   传入 prepare; 卡片/端口视图数据与工作区水合同源装配)
/// - 协议 / 点位选择 / 控件 → 目录创建服务 (prepare_node_documents)
///
/// 返回 true 表示该条目已处理; false = 非创建条目 (调用方自行兜底)。
export function addPaletteNode(
  spec: PaletteCreateSpec,
  position: { x: number; y: number },
  tabId = useAppStore.getState().activeControlTabId,
): boolean {
  if (spec.attribute === 'test-data') {
    applyTestAttribute();
    return true;
  }

  if (spec.nodeType === 'acquisition') {
    if (spec.acquisition) {
      void addAcquisitionNode(spec.acquisition, position, tabId, spec.discoveredEndpoint)
        .catch((error: unknown) => {
          notify.error(t(useAppStore.getState().lang, 'catalogCreateFailed'), formatError(error), { source: 'paletteCreate' });
        });
    }
    return true;
  }

  const app = useAppStore.getState();
  const create = (modelId: string, label?: string, variantId?: string): void => {
    void createNodeFromCatalog({ modelId, variantId, position, tabId, label })
      .catch((error: unknown) => {
        if (error instanceof CatalogError) {
          notify.error(t(app.lang, 'catalogCreateFailed'), error.message, { source: 'paletteCreate' });
          return;
        }
        notify.error(t(app.lang, 'catalogCreateFailed'), formatError(error), { source: 'paletteCreate' });
      });
  };

  if (spec.nodeType === 'point-selector') {
    create('pointSelector', '点位选择');
    return true;
  }
  if (spec.nodeType === 'protocol') {
    create('protocol:JustFloat');
    return true;
  }
  if (spec.modelId) {
    create(spec.modelId, spec.documentLabel, spec.variantId);
    return true;
  }
  return false;
}
