import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/// RawData 视图的持久化偏好 — 按 widgetId 分别保存, 无 widget 时使用 'global' key
export interface RawDataViewPrefs {
  /// 显示模式: bytes = 网格/行字节视图, terminal = 串口终端 (ANSI 彩色 + UTF-8/GBK)
  viewMode: 'bytes' | 'terminal';
  grouping: 'grid' | 'line';
  repr: 'hex' | 'ascii' | 'utf8' | 'gbk';
  directionFilter: 'all' | 'rx' | 'tx';
  showTimestamp: boolean;
  showOffset: boolean;
  autoScroll: boolean;
  hexColorMode: 'none' | 'printable' | 'range';
  sendPanelMode: 'bottom' | 'separate';
  appendMode: 'none' | 'nl' | 'tab' | 'nl_tab';
  /// 终端模式: 发送后在视图回显 (设备不回显时开启)
  localEcho: boolean;
  /// 终端模式: 解释 ANSI 转义序列 (关闭则序列原文可见, 调试用)
  ansiDecode: boolean;
}

/// 默认偏好 — 与 RawDataView 初始 useState 一致
export const DEFAULT_RAW_DATA_PREFS: RawDataViewPrefs = {
  viewMode: 'bytes',
  grouping: 'grid',
  repr: 'hex',
  directionFilter: 'all',
  showTimestamp: true,
  showOffset: true,
  autoScroll: true,
  hexColorMode: 'printable',
  sendPanelMode: 'bottom',
  appendMode: 'nl',
  localEcho: false,
  ansiDecode: true,
};

interface RawDataViewStore {
  /// key: widgetId (无 widget 时为 'global')
  prefsByWidget: Record<string, RawDataViewPrefs>;
  setPrefs: (widgetId: string, prefs: RawDataViewPrefs) => void;
}

/// 每个 RawData widget 独立持久化其 UI 配置 — localStorage 持久化 (key: vofa-rawdata-view)
export const useRawDataViewStore = create<RawDataViewStore>()(
  persist(
    (set) => ({
      prefsByWidget: {},
      setPrefs: (widgetId, prefs) =>
        set((s) => ({ prefsByWidget: { ...s.prefsByWidget, [widgetId]: prefs } })),
    }),
    {
      name: 'vofa-rawdata-view',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ prefsByWidget: s.prefsByWidget }),
    }
  )
);

/// 读取指定 widget 的偏好, 未持久化过时返回默认值
/// 旧版本持久化数据缺新字段 (如 viewMode/localEcho), 用默认值补齐
export function getRawDataViewPrefs(widgetId: string): RawDataViewPrefs {
  const stored = useRawDataViewStore.getState().prefsByWidget[widgetId];
  return stored ? { ...DEFAULT_RAW_DATA_PREFS, ...stored } : DEFAULT_RAW_DATA_PREFS;
}

/// 全部 widget 的偏好 (供未来导出使用)
export function getAllRawDataViewPrefs(): Record<string, RawDataViewPrefs> {
  return useRawDataViewStore.getState().prefsByWidget;
}
