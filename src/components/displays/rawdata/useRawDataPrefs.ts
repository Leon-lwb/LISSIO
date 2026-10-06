import { useEffect, useState } from 'react';
import { getRawDataViewPrefs, useRawDataViewStore, type RawDataViewPrefs } from '../../../lib/buffers/rawDataViewStore';
import type { RawDataGrouping } from './rawDataViewHelpers';

/// 视图侧把终端模式记成 `grouping === 'terminal'`, 而 store 用独立的 `viewMode` 字段。
/// 两者是同一件事的两种记法, 读写必须成对转换, 否则终端模式存下去就读不回来。
export function groupingFromStored(stored: RawDataViewPrefs): RawDataGrouping {
  return stored.viewMode === 'terminal' ? 'terminal' : stored.grouping;
}

/// 存下去时把视图记法翻译成 store 记法。
function groupingToStored(grouping: RawDataGrouping): Pick<RawDataViewPrefs, 'viewMode' | 'grouping'> {
  return {
    viewMode: grouping === 'terminal' ? 'terminal' : 'bytes',
    grouping: grouping === 'terminal' ? 'grid' : grouping,
  };
}

/// 这个视图可持久化的全部偏好 — 值与 setter 成对交出, 调用点解构即用。
export interface RawDataPrefsState {
  grouping: RawDataGrouping;
  setGrouping: (v: RawDataGrouping) => void;
  repr: RawDataViewPrefs['repr'];
  setRepr: (v: RawDataViewPrefs['repr']) => void;
  directionFilter: RawDataViewPrefs['directionFilter'];
  setDirectionFilter: (v: RawDataViewPrefs['directionFilter']) => void;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  showTimestamp: boolean;
  setShowTimestamp: (v: boolean) => void;
  showOffset: boolean;
  setShowOffset: (v: boolean) => void;
  appendMode: RawDataViewPrefs['appendMode'];
  setAppendMode: (v: RawDataViewPrefs['appendMode']) => void;
  sendPanelMode: RawDataViewPrefs['sendPanelMode'];
  setSendPanelMode: (v: RawDataViewPrefs['sendPanelMode']) => void;
  hexColorMode: RawDataViewPrefs['hexColorMode'];
  setHexColorMode: (v: RawDataViewPrefs['hexColorMode']) => void;
  localEcho: boolean;
  setLocalEcho: (v: boolean) => void;
  ansiDecode: boolean;
  setAnsiDecode: (v: boolean) => void;
}

/**
 * RawData 视图的持久化偏好: 挂载时读回, 变更时写回。
 *
 * 此前这个视图只在挂载时读、从不写回 —— `setPrefs` 成了没人调用的死代码, 用户调好的
 * 分组 / 进制 / 时间戳等每次重开都回到默认值。读写放在同一个 hook 里, 是为了让两种
 * 记法之间的转换 (见 `groupingFromStored`) 只有一处, 不会再各写一半。
 */
export function useRawDataPrefs(persistKey: string): RawDataPrefsState {
  // 惰性初始化: 只在首次挂载读一次, 之后由 state 自己承担真相
  const [grouping, setGrouping] = useState<RawDataGrouping>(() =>
    groupingFromStored(getRawDataViewPrefs(persistKey))
  );
  const [repr, setRepr] = useState<RawDataViewPrefs['repr']>(() => getRawDataViewPrefs(persistKey).repr);
  const [directionFilter, setDirectionFilter] = useState<RawDataViewPrefs['directionFilter']>(
    () => getRawDataViewPrefs(persistKey).directionFilter
  );
  const [autoScroll, setAutoScroll] = useState(() => getRawDataViewPrefs(persistKey).autoScroll);
  const [showTimestamp, setShowTimestamp] = useState(() => getRawDataViewPrefs(persistKey).showTimestamp);
  const [showOffset, setShowOffset] = useState(() => getRawDataViewPrefs(persistKey).showOffset);
  const [appendMode, setAppendMode] = useState<RawDataViewPrefs['appendMode']>(
    () => getRawDataViewPrefs(persistKey).appendMode
  );
  const [sendPanelMode, setSendPanelMode] = useState<RawDataViewPrefs['sendPanelMode']>(
    () => getRawDataViewPrefs(persistKey).sendPanelMode
  );
  const [hexColorMode, setHexColorMode] = useState<RawDataViewPrefs['hexColorMode']>(
    () => getRawDataViewPrefs(persistKey).hexColorMode
  );
  const [localEcho, setLocalEcho] = useState(() => getRawDataViewPrefs(persistKey).localEcho);
  const [ansiDecode, setAnsiDecode] = useState(() => getRawDataViewPrefs(persistKey).ansiDecode);

  useEffect(() => {
    useRawDataViewStore.getState().setPrefs(persistKey, {
      ...getRawDataViewPrefs(persistKey),
      ...groupingToStored(grouping),
      repr,
      directionFilter,
      autoScroll,
      showTimestamp,
      showOffset,
      appendMode,
      sendPanelMode,
      hexColorMode,
      localEcho,
      ansiDecode,
    });
  }, [
    persistKey,
    grouping,
    repr,
    directionFilter,
    autoScroll,
    showTimestamp,
    showOffset,
    appendMode,
    sendPanelMode,
    hexColorMode,
    localEcho,
    ansiDecode,
  ]);

  return {
    grouping,
    setGrouping,
    repr,
    setRepr,
    directionFilter,
    setDirectionFilter,
    autoScroll,
    setAutoScroll,
    showTimestamp,
    setShowTimestamp,
    showOffset,
    setShowOffset,
    appendMode,
    setAppendMode,
    sendPanelMode,
    setSendPanelMode,
    hexColorMode,
    setHexColorMode,
    localEcho,
    setLocalEcho,
    ansiDecode,
    setAnsiDecode,
  };
}
