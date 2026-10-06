import { useEffect } from 'react';
import { useHistoryStore } from '../../store/historyStore';
import { dispatchShortcut, registerShortcut } from './shortcuts';

/**
 * 应用级全局加速键的唯一声明处。
 *
 * 这里只声明"哪个组合键做什么"; 按键该不该被接管 (尤其焦点在输入框里时让路) 由
 * `shortcuts` 注册表统一裁决, 免得每个监听者各写一遍判断。
 */
export function useAppShortcuts(openSettings: () => void): void {
  useEffect(() => {
    const offSettings = registerShortcut({
      id: 'open-settings',
      key: ',',
      meta: true,
      // 设置面板本身可能在输入框里被再次唤起, 这里允许在输入态生效
      whileTyping: true,
      run: () => {
        openSettings();
      },
    });

    // 文档域撤销/重做 — Ctrl/Cmd+Z / Ctrl+Y (Shift 反转 Z 方向)。
    // 输入框内让路 (注册表默认), 保留各控件自身的原生文本撤销, 与文档域历史互不干扰。
    // 先登记 Shift+Z: 派发按登记顺序短路, 它必须排在裸 Ctrl+Z 之前才不会先被 undo 吃掉。
    const offRedoShift = registerShortcut({
      id: 'history-redo-shift',
      key: 'z',
      ctrl: true,
      shift: true,
      run: () => {
        useHistoryStore.getState().redo();
      },
    });
    const offRedoY = registerShortcut({
      id: 'history-redo-y',
      key: 'y',
      ctrl: true,
      run: () => {
        useHistoryStore.getState().redo();
      },
    });
    const offUndo = registerShortcut({
      id: 'history-undo',
      key: 'z',
      ctrl: true,
      run: () => {
        useHistoryStore.getState().undo();
      },
    });

    return () => {
      offSettings();
      offRedoShift();
      offRedoY();
      offUndo();
    };
  }, [openSettings]);
}

/**
 * 唯一的 window 监听, 交给注册表派发。
 *
 * 多个 `useEffect` 各自 `addEventListener` 时, "谁先看到事件、谁先 preventDefault"
 * 取决于注册顺序, 很难推理; 收成一个入口后顺序由注册表显式决定。
 */
export function useShortcutDispatcher(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      dispatchShortcut(e);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
