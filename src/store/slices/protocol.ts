import { api } from '../../lib/tauri/tauri';
import { notify } from '../../lib/tauri/notifications';
import { nodeError } from '../../lib/tauri/errorGuidance';
import { translate } from '../../i18n';
import type { ProtocolConfig, ProtocolSchema } from '../../types';
import type { AppSlice } from './types';
import type { ProtocolNodeData } from '../appStoreHelpers';
import { prepareProtocolDocument } from '../../lib/models/createFromCatalog';
import { schemaPortNames } from '../../lib/utils/protocolSchema';
import {
  withHistoryOp,
  beginHistoryOp,
  commitHistoryOp,
  type HistoryTarget,
} from '../historyStore';

/** 协议类操作目标 — 行首徽章用画布 Protocol 节点同款 (主题色 Binary) */
const protocolTarget = (): HistoryTarget => ({ kind: 'node', node: { kind: 'protocol' } });

export interface ProtocolSlice {
  /// 自动检测到的通道数 — 按 Protocol 节点 id (仅自动模式有值, 由后端
  /// `protocol:channels-detected` 事件驱动写入)
  detectedChannels: Record<string, number | null>;
  /// 更新 Protocol 节点配置 (节点 data + 后端运行时引擎 + 全 tab 图同步)
  /// 预设路径下 schema 随 config 工厂重建; custom schema 保持 (由 setProtocolNodeSchema 管理)
  setProtocolNodeConfig: (nodeId: string, config: ProtocolConfig) => Promise<void>;
  /// 更新 Protocol 节点的协议转换目标 (null = 无转换)
  setProtocolNodeConvertTo: (nodeId: string, convertTo: ProtocolConfig | null) => void;
  /// 更新 Protocol 节点的帧 schema (custom 块编辑 / 重置为预设)
  setProtocolNodeSchema: (nodeId: string, schema: ProtocolSchema) => void;
}

export const createProtocolSlice: AppSlice<ProtocolSlice> = (set, get) => {
  return {
    detectedChannels: {},

    setProtocolNodeConfig: async (nodeId, config) => {
      // 1. schema 单一来源: 目录 prepare 产出与 config 对应的预设协议文档
      //    (custom schema 由 setProtocolNodeSchema 管理, preset 变化时才重建)
      const prevNode = get().rfNodes.find((n) => n.id === nodeId);
      const prevSchema = prevNode ? (prevNode.data as ProtocolNodeData).schema : undefined;
      const keepCustom = prevSchema?.preset === 'custom';
      let prepared: Awaited<ReturnType<typeof prepareProtocolDocument>> | null = null;
      if (!keepCustom) {
        try {
          prepared = await prepareProtocolDocument(config);
        } catch (error) {
          const lang = get().lang;
          notify.error(translate('notifSetProtocolFailed', lang), nodeError(lang, error), { source: 'setProtocol' });
          return;
        }
      }
      const nextConfig = prepared?.protocol ?? config;
      const schema = keepCustom
        ? (prevSchema)
        : prepared!.schema;
      const channels = schemaPortNames(schema.decode).length;
      beginHistoryOp();
      set((s) => ({
        rfNodes: s.rfNodes.map((n) =>
          n.id === nodeId && n.type === 'protocol'
            ? { ...n, data: { ...n.data, config: nextConfig, channels, schema, label: nextConfig.kind } }
            : n
        ),
      }));
      // 文档变更已在上面同步完成 — 立即提交历史 (await 之后的后端调用不属于文档态)
      commitHistoryOp(
        { opKey: 'opUpdateProtocolConfig', detailText: nextConfig.kind, target: protocolTarget() },
        { coalesceKey: `protocol.config.${nodeId}` }
      );
      // 2. 后端运行时引擎 (图同步是权威, 此调用让引擎立即重建;
      //    手动模式 buffer 通道数 + 推送记录复位都在 set_protocol 内一并完成,
      //    自动模式由后端 protocol:channels-detected 事件驱动前端响应)
      try {
        await api.setProtocol(nodeId, nextConfig);
        if ((nextConfig.kind === 'JustFloat' || nextConfig.kind === 'FireWater') && nextConfig.channels != null) {
          set((s) => ({ detectedChannels: { ...s.detectedChannels, [nodeId]: null } }));
        }
      } catch (e) {
        const lang = get().lang;
        notify.error(translate('notifSetProtocolFailed', lang), nodeError(lang, e), { source: 'setProtocol' });
      }
      // 3. 全 tab 图同步
      get().controlTabs.forEach((tab) => { void get().syncTabGraph(tab.id); });
    },

    setProtocolNodeConvertTo: (nodeId, convertTo) =>
      withHistoryOp(
        {
          opKey: 'opConvertProtocolTo',
          detailText: convertTo?.kind ?? undefined,
          target: protocolTarget(),
        },
        () => {
          set((s) => ({
            rfNodes: s.rfNodes.map((n) =>
              n.id === nodeId && n.type === 'protocol'
                ? { ...n, data: { ...n.data, convertTo } }
                : n
            ),
          }));
          get().controlTabs.forEach((tab) => { void get().syncTabGraph(tab.id); });
        }
      ),

    setProtocolNodeSchema: (nodeId, schema) =>
      withHistoryOp({ opKey: 'opUpdateProtocolSchema', target: protocolTarget() }, () => {
        set((s) => ({
          rfNodes: s.rfNodes.map((n) => {
            if (n.id !== nodeId || n.type !== 'protocol') return n;
            // custom 下节点端口数跟随 decode 块派生 (schemaPortNames, 与 Rust port_names 同规则)
            const channels = schema.preset === 'custom'
              ? schemaPortNames(schema.decode).length
              : (n.data as ProtocolNodeData).channels;
            return { ...n, data: { ...n.data, schema, channels } };
          }),
        }));
        // 图同步为权威 (NodeKind::Protocol.schema 随图下发, 引擎按 schema 重建)
        get().controlTabs.forEach((tab) => { void get().syncTabGraph(tab.id); });
      }),
  };
}
