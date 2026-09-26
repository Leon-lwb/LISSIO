//! 首次启动种子 — 目录就绪 + 后端确认"首次空工作区"后创建一次
//! RawData 节点, 再由能力目录补齐 设备→协议解析 初始通路 (计划边界 7)。
//!
//! 屏障: App 只在模型目录 ready 后挂载, 因此本模块运行时目录必然就绪;
//! 重复 effect / StrictMode 双挂载由 in-flight 去重 + 空画布前置检查防重。

import { useAppStore } from '../../store/appStore';
import { createNodeFromCatalog } from './createFromCatalog';

let seedInFlight: Promise<void> | null = null;

/** 启动种子 — 幂等: 并发调用共享同一次创建; 画布非空时不创建。 */
export function seedStartupWorkspace(): Promise<void> {
  if (seedInFlight) return seedInFlight;
  seedInFlight = (async () => {
    try {
      const st = useAppStore.getState();
      if (st.rfNodes.length > 0 || st.dataTabs.some((t) => t.type === 'raw')) return;
      const rawNode = await createNodeFromCatalog({
        modelId: 'widget:RawData',
        position: { x: 560, y: 120 },
      });
      // 空图时再给出 设备→协议解析→RawData 初始连线, 新用户开箱即有完整数据通路
      const fresh = useAppStore.getState();
      if (!fresh.rfNodes.some((n) => n.type === 'acquisition' || n.type === 'protocol')) {
        await fresh.seedInitialGraph(rawNode.id);
      }
    } finally {
      seedInFlight = null;
    }
  })();
  return seedInFlight;
}
