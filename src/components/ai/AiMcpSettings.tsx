import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAiChatStore } from '../../store/aiChatStore';
import { translate } from '../../i18n';
import { DraftNumberInput } from '../ui/fields';

interface AiMcpSettingsProps {
  port: number;
  onPortChange: (port: number) => void;
}

/// AI 设置中的外部 MCP server 与工具管理。
export function AiMcpSettings({ port, onPortChange }: AiMcpSettingsProps) {
  const lang = useAppStore((s) => s.lang);
  const {
    servers, tools, serverRunning, serverPort, addServer, removeServer, setServerEnabled,
    refreshTools, refreshServerStatus, startLocalServer, stopLocalServer,
  } = useAiChatStore();
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<'stdio' | 'http'>('stdio');

  useEffect(() => {
    void refreshTools();
    void refreshServerStatus();
  }, [refreshTools, refreshServerStatus]);

  const canAdd =
    name.trim().length > 0 &&
    (kind === 'stdio' ? command.trim().length > 0 : url.startsWith('http://') || url.startsWith('https://'));

  const onAdd = async () => {
    const [executable, ...args] = command.trim().split(/\s+/);
    await addServer({
      id: `srv-${Date.now().toString(36)}`,
      name: name.trim(),
      transport:
        kind === 'stdio'
          ? { kind: 'stdio', command: executable, args, env: {} }
          : { kind: 'http', url: url.trim() },
      enabled: true,
    });
    setName('');
    setCommand('');
    setUrl('');
    await refreshTools();
  };

  return (
    <section className="space-y-3 py-4 text-xs">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium text-text-primary">{translate('settingsAiSectionMcp', lang)}</h3>
        <p className="text-xs text-text-secondary">{translate('settingAiMcpDesc', lang)}</p>
      </div>
      <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="text-text-primary">{translate('settingAiMcpServerPort', lang)}</div>
          <div className="mt-0.5 text-text-secondary">{translate('settingAiMcpServerPortDesc', lang)}</div>
        </div>
        <DraftNumberInput
          className="w-[120px] rounded border border-border bg-bg-input px-2 py-1 text-text-primary focus:border-accent focus:outline-none"
          value={port}
          min={1024}
          max={65535}
          step={1}
          onCommit={onPortChange}
        />
      </div>
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium text-text-primary">{translate('aiMcpServers', lang)}</h3>
        <p className="text-xs text-text-secondary">{translate('aiMcpServersHint', lang)}</p>
      </div>
      <div className="flex items-center justify-between gap-3 rounded border border-border-subtle px-3 py-2">
        <span className="min-w-0 truncate text-text-secondary">
          {serverRunning ? `127.0.0.1:${serverPort ?? ''}/mcp` : translate('aiServerStopped', lang)}
        </span>
        <button
          type="button"
          className="shrink-0 rounded px-2 py-1 text-text-primary hover:bg-bg-hover"
          onClick={() => void (serverRunning ? stopLocalServer() : startLocalServer())}
        >
          {translate(serverRunning ? 'aiServerStop' : 'aiServerStart', lang)}
        </button>
      </div>
      <div className="space-y-3">
        {servers.length === 0 && <div className="text-text-secondary">{translate('aiNoServers', lang)}</div>}
        {servers.map((srv) => (
          <div key={srv.id} className="flex items-center gap-2 rounded border border-border-subtle px-2 py-1.5">
            <input
              type="checkbox"
              checked={srv.enabled}
              onChange={(e) => { void setServerEnabled(srv.id, e.target.checked); }}
              className="accent-accent"
            />
            <span className="font-medium">{srv.name}</span>
            <span className="text-text-secondary truncate">
              {srv.transport.kind === 'stdio'
                ? `${srv.transport.command} ${srv.transport.args.join(' ')}`
                : srv.transport.url}
            </span>
            <button
              className="ml-auto p-1 rounded text-text-secondary hover:bg-bg-hover hover:text-danger"
              onClick={() => { void removeServer(srv.id); }}
              title={translate('aiDeleteServer', lang)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        <div className="rounded border border-border-subtle px-2 py-1.5 space-y-1.5">
          <div className="font-medium text-text-secondary">{translate('aiAddServer', lang)}</div>
          <div className="flex gap-1.5">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'stdio' | 'http')}
              className="bg-bg-hover rounded px-1 py-0.5 outline-none"
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={translate('aiServerName', lang)}
              className="flex-1 min-w-0 bg-bg-hover rounded px-1.5 py-0.5 outline-none focus:ring-1 ring-accent"
            />
          </div>
          {kind === 'stdio' ? (
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={translate('aiServerCommand', lang)}
              className="w-full bg-bg-hover rounded px-1.5 py-0.5 outline-none focus:ring-1 ring-accent"
            />
          ) : (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:8000/mcp"
              className="w-full bg-bg-hover rounded px-1.5 py-0.5 outline-none focus:ring-1 ring-accent"
            />
          )}
          <button
            className="px-2 py-0.5 rounded bg-accent text-accent-foreground disabled:opacity-disabled flex items-center gap-1"
            disabled={!canAdd}
            onClick={() => { void onAdd(); }}
          >
            <Plus size={11} />
            {translate('aiAddServer', lang)}
          </button>
        </div>

        {tools.length > 0 && (
          <div className="pt-1">
            <div className="font-medium text-text-secondary pb-1">
              {translate('aiToolCount', lang).replace('{n}', String(tools.length))}
            </div>
            <div className="flex flex-wrap gap-1">
              {tools.map((tool) => (
                <span
                  key={`${tool.server_id}-${tool.name}`}
                  title={tool.description}
                  className="px-1.5 py-0.5 rounded bg-bg-hover text-[10px]"
                >
                  {tool.prefixed_name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
