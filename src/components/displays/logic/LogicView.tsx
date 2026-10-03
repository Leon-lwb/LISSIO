import { useState } from 'react';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { LogicTimingChart } from './LogicTimingChart';
import { DecodedEventList } from './DecodedEventList';
import { PanelTabs } from '../../ui/PanelTabs';
import { ContextualHint } from '../../onboarding/ContextualHint';
import { usePrimaryProtocolConfig } from '../../../lib/hooks/usePrimaryNodes';
import { Activity, List } from 'lucide-react';

type ViewMode = 'timing' | 'events';

/// 逻辑分析仪综合视图 — 时序图 + 解码事件列表 两种视图模式切换
export function LogicView() {
  const lang = useAppStore((s) => s.lang);
  const protocolConfig = usePrimaryProtocolConfig();
  const openCategory = useAppStore((s) => s.openCategory);
  const [mode, setMode] = useState<ViewMode>('timing');

  const tabs = [
    { value: 'timing' as const, label: translate('timingDiagram', lang), icon: <Activity /> },
    { value: 'events' as const, label: translate('decodedEvents', lang), icon: <List /> },
  ];

  const isLogicProtocol = protocolConfig?.kind === 'LogicDecode';

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-bg-editor">
      {!isLogicProtocol && (
        <ContextualHint
          id="logic-protocol-mismatch"
          message={translate('logicHintMessage', lang)}
          action={{
            label: translate('logicHintAction', lang),
            onClick: () => openCategory('protocol'),
          }}
        />
      )}
      <PanelTabs tabs={tabs} active={mode} onChange={setMode} />
      <div className="flex-1 overflow-hidden min-h-0">
        {mode === 'timing' && <LogicTimingChart />}
        {mode === 'events' && <DecodedEventList />}
      </div>
    </div>
  );
}
