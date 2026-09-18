//! 全应用配置导出 / 导入 (单个 JSON 文件, 通过系统文件对话框)
//!
//! 备份范围: 设置 + 协议 + 传输 + 控件 + 节点图 + 数据标签页 + RawData 视图偏好 + 窗口组织
//! 用于备份 / 恢复 / 迁移到另一台机器。
//!
//! v2 起支持「拆分备份」: 快照可只含若干分区 (BackupSection), 导入时按分区应用。
//! 分区划分: 节点图 / 窗口组织 / 设置 / 传输与协议 / 控件与标签页。

import { platform } from '../platform';
import { canvasNode, nodeDocument, type NodeDocument } from '../nodes/document';
import { edgeToGraphEdge } from '../utils/nodeDef';
import type { GraphEdge } from '../utils/nodeDef';
import { useAppStore } from '../../store/appStore';
import { rebaseHistory } from '../../store/historyStore';
import { useSettingsStore } from '../../store/settingsStore';
import {
  useDockStore,
  ensurePropertiesExclusiveCard,
  type DockNode,
  type DockCard,
} from '../../store/dockStore';
import { useLayoutStore, type SidebarDock } from '../../store/layoutStore';
import { applyAppearance } from '../../settings/applyTheme';
import type { AppSettings } from '../../settings/defaults';
import type { ControlTab, DataTab } from '../../types';
import { api } from './tauri';
import { setRawDataPreviewCapacity } from '../buffers/rawDataPreviewRegistry';
import { canFrameBuffer } from '../buffers/canBuffer';
import { logicSampleBuffer } from '../buffers/logicBuffer';
import { notify, formatError } from './notifications';
import { t } from '../../i18n';
import { removeTabGraphFromBackend } from '../../store/appStoreHelpers';
import { getAllRawDataViewPrefs, useRawDataViewStore, type RawDataViewPrefs } from '../buffers/rawDataViewStore';

/// 备份分区 — 拆分备份/模板的最小单元
export type BackupSection = 'workspace' | 'windowLayout' | 'settings';

export const ALL_BACKUP_SECTIONS: BackupSection[] = ['workspace', 'windowLayout', 'settings'];

export interface WorkspaceDocument {
  tabs: Pick<ControlTab, 'id' | 'name'>[];
  graphs: { tab_id: string; documents: NodeDocument[]; edges: GraphEdge[] }[];
  dataTabs: DataTab[];
  activeDataTabId: string;
  activeControlTabId: string;
  rawDataViewPrefs: Record<string, unknown>;
}

/** Workspace is atomic: nodes, edges and tab ownership are never imported separately. */
export interface AppSnapshot {
  version: 4;
  exportedAt: string;
  sections?: BackupSection[];
  settings?: AppSettings;
  workspace?: WorkspaceDocument;
  dockRoot?: DockNode;
  dockCards?: Record<string, DockCard>;
  sidebarDock?: SidebarDock;
}

const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }];

// ==================== 文件对话框包装 ====================

/** 通过系统"另存为"对话框将数据写入 JSON 文件。
 *  用户取消返回 false, 写入失败返回 false, 成功返回 true。 */
export async function saveJsonFile(
  filename: string,
  data: unknown
): Promise<boolean> {
  try {
    const path = await platform.saveFile({
      defaultPath: `${filename}.json`,
      filters: JSON_FILTERS,
    });
    // 用户取消 — save 返回 null (或 undefined)
    if (!path) return false;
    const text =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await platform.writeTextFile(path, text);
    return true;
  } catch (e) {
    console.warn('[appExport] 保存文件失败:', e);
    return false;
  }
}

/** 通过系统"打开"对话框读取并解析备份文件; 用户取消/失败返回 null。 */
export async function readSnapshotFromFile(): Promise<AppSnapshot | null> {
  try {
    const selected = await platform.openFile({
      multiple: false,
      directory: false,
      filters: JSON_FILTERS,
    });
    if (!selected) return null;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (typeof path !== 'string' || path === '') return null;
    const json = await platform.readTextFile(path);
    return parseSnapshot(json);
  } catch (e) {
    const lang = useAppStore.getState().lang;
    notify.error(t(lang, 'backupImportFailed'), formatError(e), { source: 'importConfig' });
    return null;
  }
}

// ==================== 快照收集 / 序列化 / 解析 ====================

/// 读取所有 store 的当前状态并生成全量快照。
/// rfNodes/rfEdges 经 JSON 往返确保无函数 / undefined 等不可序列化字段。
/// 工作区节点配置仅存在于每页签的节点文档中。
export function collectSnapshot(): AppSnapshot {
  const app = useAppStore.getState();
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    sections: ALL_BACKUP_SECTIONS,
    // 导出剥离 API key — 密钥不入备份文件 (明文扩散面)
    settings: stripApiKey(useSettingsStore.getState().settings),
    workspace: {
      tabs: app.controlTabs.map(({ id, name }) => ({ id, name })),
      graphs: app.controlTabs.map(tab => {
        const nodes = app.rfNodes.filter(n => n.data.tabId === tab.id);
        const ids = new Set(nodes.map(n => n.id));
        return { tab_id: tab.id, documents: nodes.map(nodeDocument),
          edges: app.rfEdges.filter(e => ids.has(e.source) && ids.has(e.target)).map(edgeToGraphEdge) };
      }),
      dataTabs: app.dataTabs,
      activeDataTabId: app.activeDataTabId,
      activeControlTabId: app.activeControlTabId,
      rawDataViewPrefs: getAllRawDataViewPrefs(),
    },
    dockRoot: useDockStore.getState().root,
    dockCards: useDockStore.getState().cards,
    sidebarDock: useLayoutStore.getState().sidebarDock,
  };
}

/// 仅收集指定分区的快照 (拆分备份导出)
/// v3: 'transportProtocol' 分区 = 全局 Transport/Protocol 节点 (rfNodes 子集) + 其间的字节边
export function collectPartialSnapshot(sections: BackupSection[]): AppSnapshot {
  const full = collectSnapshot();
  const partial: AppSnapshot = {
    version: 4,
    exportedAt: full.exportedAt,
    sections: [...sections],
  };
  if (sections.includes('settings')) partial.settings = full.settings;
  if (sections.includes('workspace')) partial.workspace = full.workspace;
  if (sections.includes('windowLayout')) {
    partial.dockRoot = full.dockRoot;
    partial.dockCards = full.dockCards;
    partial.sidebarDock = full.sidebarDock;
  }
  return partial;
}

export function serializeSnapshot(snap: AppSnapshot): string {
  return JSON.stringify(snap, null, 2);
}

/// 解析备份 JSON 并做最小校验, 非法时抛出带清晰信息的 Error。
/// 仅接受 v3 快照 (v1/v2 备份不再支持 — 请用新版本导出后重新备份)。
export function parseSnapshot(json: string): AppSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  const data = parsed as Partial<AppSnapshot>;
  if (!data || typeof data !== 'object') {
    throw new Error('备份文件格式无效');
  }
  if (data.version !== 4) throw new Error('不支持的备份格式；请使用当前版本的节点文档。');
  if (data.workspace) validateWorkspace(data.workspace);
  const hasContent = (
    [
      'settings', 'workspace', 'dockRoot',
    ] as const
  ).some((k) => data[k] != null);
  if (!hasContent) {
    throw new Error('备份文件为空或缺少有效内容');
  }
  return { ...data, exportedAt: data.exportedAt ?? new Date().toISOString() } as AppSnapshot;
}

/// 检测快照实际包含哪些分区 (供拆分备份导入时的勾选预填), 按 ALL_BACKUP_SECTIONS 顺序返回
/// transportProtocol 分区内容 = rfNodes 中的全局 Transport/Protocol 节点
export function detectPresentSections(snap: AppSnapshot): BackupSection[] {
  return ALL_BACKUP_SECTIONS.filter(section => {
    if (section === 'workspace') return snap.workspace != null;
    if (section === 'settings') return snap.settings != null;
    return snap.dockRoot != null || snap.dockCards != null;
  });
}

function validateWorkspace(workspace: WorkspaceDocument): void {
  if (!Array.isArray(workspace.tabs) || !workspace.tabs.length || !Array.isArray(workspace.graphs)) throw new Error('工作区缺少页签文档');
  const tabs = new Set(workspace.tabs.map(tab => tab.id));
  if (tabs.size !== workspace.tabs.length || workspace.graphs.length !== tabs.size) throw new Error('工作区页签重复或缺少节点文档');
  const ids = new Set<string>();
  const graphTabs = new Set<string>();
  for (const graph of workspace.graphs) {
    if (!tabs.has(graph.tab_id) || graphTabs.has(graph.tab_id)) throw new Error('节点文档页签无效');
    graphTabs.add(graph.tab_id);
    const localIds = new Set(graph.documents.map(doc => doc.id));
    for (const doc of graph.documents) {
      if (!doc.id || ids.has(doc.id) || doc.tabId !== graph.tab_id || !doc.label?.trim()) throw new Error('节点标识或页签归属无效');
      if (!Number.isFinite(doc.layout.x) || !Number.isFinite(doc.layout.y) ||
        [doc.layout.width, doc.layout.height].some(size => size != null && (!Number.isFinite(size) || size <= 0))) throw new Error('节点布局无效');
      if (doc.kind !== 'device' && doc.attributes.testData) throw new Error('测试属性只能附加到设备');
      if (!['device', 'protocol', 'pointSelector', 'widget'].includes(doc.kind)) throw new Error('节点类型无效');
      canvasNode(doc);
      ids.add(doc.id);
    }
    if (graph.edges.some(edge => !localIds.has(edge.source) || !localIds.has(edge.target))) throw new Error('不允许跨页签或悬空连线');
  }
}

// ==================== 状态恢复 ====================

/// 将 data 分类的缓存容量设置同步到后端与前端 buffer 实例
/// (与 settingsStore.applyDataCapacity 相同 — 该函数未导出, 此处复刻)
/// v3: 波形/原始数据容量按源 (节点) 生效，对当前图中全部 Protocol/设备节点应用
function applyDataCapacity(settings: AppSettings) {
  const data = settings.data;
  const nodes = useAppStore.getState().rfNodes;
  for (const n of nodes) {
    if (n.type === 'protocol') {
      api.setWaveformBufferCapacity(n.id, data.waveformBufferPoints).catch((e: unknown) =>
        console.warn('[appExport] 设置波形缓冲区容量失败:', e)
      );
    } else if (n.type === 'acquisition') {
      api.setRawDataBufferCapacity(n.id, data.rawDataBufferBytes).catch((e: unknown) =>
        console.warn('[appExport] 设置原始数据缓冲区容量失败:', e)
      );
    }
  }
  api.setCanBufferCapacity(data.canBufferFrames).catch((e: unknown) =>
    console.warn('[appExport] 设置 CAN 缓冲区容量失败:', e)
  );
  api.setLogicBufferCapacity(data.logicBufferSamples).catch((e: unknown) =>
    console.warn('[appExport] 设置逻辑缓冲区容量失败:', e)
  );
  setRawDataPreviewCapacity(data.rawDataBufferBytes);
  canFrameBuffer.setCapacity(data.canBufferFrames);
  logicSampleBuffer.setCapacity(data.logicBufferSamples);
}

/// 剥离 AI API key — 钥匙串之外的任何副本 (磁盘 / 备份文件) 都不携带密钥
function stripApiKey(settings: AppSettings): AppSettings {
  return { ...settings, ai: { ...settings.ai, apiKey: '' } };
}

/// 恢复设置到 settings store, 并同步应用到磁盘 / 主题 / 容量
async function applySettings(settings: AppSettings): Promise<void> {
  // 导入文件中的密钥 (旧版备份) 迁入钥匙串, 不再落盘
  if (settings.ai.apiKey) {
    try {
      await api.aiSecretSet(settings.ai.adapter, settings.ai.apiKey);
    } catch (e) {
      console.warn('[appExport] 密钥迁入钥匙串失败:', e);
    }
  }
  useSettingsStore.setState({ settings });
  applyAppearance(settings.appearance);
  applyDataCapacity(settings);
  // 持久化到磁盘 (settings.json), 保证重启后仍生效
  try {
    const store = platform.createStore('settings.json');
    await store.set('app', stripApiKey(settings));
  } catch (e) {
    console.warn('[appExport] 设置持久化失败:', e);
  }
}

/// 解析要应用的分区集合 (显式指定 → 快照声明 → 全部)
function resolveSections(
  snap: AppSnapshot,
  opts?: { sections?: BackupSection[] }
): BackupSection[] {
  if (opts?.sections?.length) return opts.sections;
  if (snap.sections?.length) return snap.sections;
  return ALL_BACKUP_SECTIONS;
}

/// 将快照按分区应用到所有 store (恢复 / 模板应用)
export async function applySnapshot(
  snap: AppSnapshot,
  opts?: { sections?: BackupSection[] }
): Promise<void> {
  const want = new Set(resolveSections(snap, opts));
  // 应用前存在的 controlTabs — 应用后消失的 tab 需清理其后端残留图
  const prevTabIds = useAppStore.getState().controlTabs.map((t) => t.id);

  // 1. 设置
  if (want.has('settings') && snap.settings) {
    await applySettings(snap.settings);
  }

  if (want.has('workspace') && snap.workspace) {
    validateWorkspace(snap.workspace);
    const workspace = snap.workspace;
    // Replacement always restores disconnected configuration, including unchanged IDs.
    await Promise.all(useAppStore.getState().rfNodes.filter(n => n.type === 'acquisition')
      .map(n => api.closeTransport(n.id).catch(() => undefined)));
    const rfNodes = workspace.graphs.flatMap(graph => graph.documents.map(doc => canvasNode(doc)));
    const rfEdges = workspace.graphs.flatMap(graph => graph.edges.map(edge => ({
      id: edge.id, source: edge.source, target: edge.target,
      sourceHandle: edge.source_handle, targetHandle: edge.target_handle,
    })));
    useAppStore.setState({
      rfNodes, rfEdges,
      controlTabs: workspace.tabs.map(tab => ({ ...tab })),
      dataTabs: workspace.dataTabs,
      activeControlTabId: workspace.activeControlTabId,
      activeDataTabId: workspace.activeDataTabId,
      connectionStates: {},
    });
    useRawDataViewStore.setState({ prefsByWidget: workspace.rawDataViewPrefs as Record<string, RawDataViewPrefs> });
    for (const tabId of prevTabIds) {
      if (!workspace.tabs.some(tab => tab.id === tabId)) await removeTabGraphFromBackend(tabId);
    }
    for (const tab of workspace.tabs) {
      const error = await useAppStore.getState().syncTabGraph(tab.id);
      if (error) throw new Error(error);
    }
  }

  // 5. 窗口组织
  if (want.has('windowLayout') && snap.dockRoot && snap.dockCards) {
    // 净化属性专属卡 — 旧备份可能在右侧属性卡混装其他数据 tab
    // (旧版 reconcile 的安置缺陷), 导入时统一逐出/拆出
    const cleanDock = ensurePropertiesExclusiveCard(snap.dockRoot, snap.dockCards);
    useDockStore.setState({
      root: cleanDock.root,
      cards: cleanDock.cards,
      focusedCardId: null,
    });
    if (snap.sidebarDock) useLayoutStore.setState({ sidebarDock: snap.sidebarDock });
  }

  // 快照应用是批量覆盖而非用户单步操作 — 撤销历史重置为新基线
  rebaseHistory('opImportWorkspace');
}

// ==================== 导出 / 导入入口 ====================

/// 导出完整配置到文件 (用户选择保存位置)
export async function exportAppToFile(): Promise<void> {
  const lang = useAppStore.getState().lang;
  try {
    const snap = collectSnapshot();
    const json = serializeSnapshot(snap);
    const ok = await saveJsonFile('lissio-backup', json);
    if (ok) {
      notify.info(t(lang, 'backupExportSuccess'), t(lang, 'backupExportSuccessDesc'), {
        source: 'exportConfig',
      });
    }
    // 用户取消时不提示
  } catch (e) {
    notify.error(t(lang, 'backupExportFailed'), formatError(e), { source: 'exportConfig' });
  }
}

/// 从文件导入完整配置 (用户选择文件)
export async function importAppFromFile(): Promise<void> {
  const lang = useAppStore.getState().lang;
  try {
    const snap = await readSnapshotFromFile();
    if (!snap) return;
    await applySnapshot(snap);

    // 若当前有任一连接, 提示用户重新连接以应用导入的传输配置 (不自动连接)
    const isConnected = Object.values(useAppStore.getState().connectionStates).some((v) => v === 'Connected');
    notify.info(
      t(lang, 'backupImportSuccess'),
      isConnected ? t(lang, 'backupImportSuccessDescReconnect') : t(lang, 'backupImportSuccessDesc'),
      { source: 'importConfig' }
    );
  } catch (e) {
    notify.error(t(lang, 'backupImportFailed'), formatError(e), { source: 'importConfig' });
  }
}

/// 拆分备份: 仅导出所选分区到文件。返回是否成功 (false = 取消/失败)。
export async function exportSectionsToFile(sections: BackupSection[]): Promise<boolean> {
  const lang = useAppStore.getState().lang;
  try {
    const snap = collectPartialSnapshot(sections);
    const ok = await saveJsonFile('lissio-backup', serializeSnapshot(snap));
    if (ok) {
      notify.info(t(lang, 'backupExportSuccess'), t(lang, 'backupExportSuccessDesc'), {
        source: 'exportConfig',
      });
    }
    return ok;
  } catch (e) {
    notify.error(t(lang, 'backupExportFailed'), formatError(e), { source: 'exportConfig' });
    return false;
  }
}

/// 拆分备份: 从文件导入指定分区 (缺省 = 文件声明的分区 / 全部)。
export async function importSectionsFromFile(
  sections?: BackupSection[]
): Promise<boolean> {
  const lang = useAppStore.getState().lang;
  try {
    const snap = await readSnapshotFromFile();
    if (!snap) return false;
    await applySnapshot(snap, sections ? { sections } : undefined);
    const isConnected = Object.values(useAppStore.getState().connectionStates).some((v) => v === 'Connected');
    notify.info(
      t(lang, 'backupImportSuccess'),
      isConnected ? t(lang, 'backupImportSuccessDescReconnect') : t(lang, 'backupImportSuccessDesc'),
      { source: 'importConfig' }
    );
    return true;
  } catch (e) {
    notify.error(t(lang, 'backupImportFailed'), formatError(e), { source: 'importConfig' });
    return false;
  }
}
