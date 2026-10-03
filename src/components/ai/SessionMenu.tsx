import { useMemo, useState } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAiChatStore } from '../../store/aiChatStore';
import { activateOnKeyboard } from '../../lib/utils/a11y';
import { translate } from '../../i18n';

export function SessionMenu() {
  const lang = useAppStore((s) => s.lang);
  const { sessions, activeSessionId, createSession, switchSession, renameSession, deleteSession } =
    useAiChatStore();
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const sorted = useMemo(() => [...sessions].sort((a, b) => b.updated_at - a.updated_at), [sessions]);
  const activeTitle = sessions.find((s) => s.id === activeSessionId)?.title ?? translate('aiSessionNew', lang);

  const commitRename = async () => {
    if (renamingId && draft.trim()) await renameSession(renamingId, draft.trim());
    setRenamingId(null);
  };

  const onDelete = async (id: string) => {
    await deleteSession(id);
    // 删空后自动补一个默认会话, 面板保持可用
    if (useAiChatStore.getState().sessions.length === 0) {
      await createSession(translate('aiSessionNew', lang));
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <button
        className="flex w-full min-w-0 items-center gap-1 px-1.5 h-5 rounded text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
        onClick={() => setOpen((v) => !v)}
        title={`${translate('aiSessionSwitch', lang)}: ${activeTitle}`}
      >
        <span className="truncate">{activeTitle}</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={translate('aiSessionSwitch', lang)}
            className="fixed inset-0 z-20 border-0 bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-6 z-30 w-56 max-w-[80vw] popover-surface py-1 flex flex-col animate-ai-menu-in">
            <div className="max-h-56 overflow-y-auto">
              {sorted.length === 0 && (
                <div className="px-2 py-1.5 text-[11px] text-text-secondary">{translate('aiSessionEmpty', lang)}</div>
              )}
              {sorted.map((s) => (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1 px-2 py-1 text-xs hover:bg-bg-hover cursor-pointer ${
                    s.id === activeSessionId ? 'text-accent' : 'text-text-primary'
                  }`}
                  onClick={() => {
                    if (s.id !== activeSessionId) void switchSession(s.id);
                    setOpen(false);
                  }}
                  onKeyDown={activateOnKeyboard}
                  role="button"
                  tabIndex={0}
                >
                  {renamingId === s.id ? (
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commitRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => void commitRename()}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-bg-input rounded px-1 outline-none focus:ring-1 ring-accent"
                    />
                  ) : (
                    <>
                      <span className="flex-1 min-w-0 truncate">{s.title}</span>
                      <button
                        className="p-0.5 rounded text-text-secondary opacity-0 group-hover:opacity-100 hover:text-text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(s.id);
                          setDraft(s.title);
                        }}
                        title={translate('aiSessionRename', lang)}
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        className="p-0.5 rounded text-text-secondary opacity-0 group-hover:opacity-100 hover:text-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDelete(s.id);
                        }}
                        title={translate('aiSessionDelete', lang)}
                      >
                        <Trash2 size={10} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <button
              className="w-full flex items-center gap-1 px-2 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary border-t border-border-subtle"
              onClick={() => {
                void createSession(translate('aiSessionNew', lang));
                setOpen(false);
              }}
            >
              <Plus size={11} />
              {translate('aiSessionNew', lang)}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/// AI 对话面板 — 可停靠 (右/左/下/浮动), 流式对话 + Markdown 渲染 +
/// 多会话 (后端持有) + MCP 工具调用展示
