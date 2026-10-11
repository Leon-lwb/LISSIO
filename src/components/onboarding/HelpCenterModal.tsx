//! 帮助中心弹窗
//!
//! - 章节式布局，覆盖快速入门、数据接口、协议、控件、CAN、逻辑分析仪、自定义控件
//! - 从 ActivityBar 帮助图标或设置中打开

import { X, HelpCircle } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useOnboardingStore } from '../../store/onboardingStore';
import { translate } from '../../i18n';
import { HELP_SECTIONS } from './helpContent';
import { DialogOverlay, DialogSurface } from '../ui/Dialog';

export function HelpCenterModal() {
  const lang = useAppStore((s) => s.lang);
  const isOpen = useOnboardingStore((s) => s.isHelpOpen);
  const close = useOnboardingStore((s) => s.closeHelp);

  return (
    <DialogOverlay open={isOpen} onDismiss={close}>
      <DialogSurface
        className="flex flex-col w-[80vw] h-[85vh] max-w-[1000px] max-h-[800px]"
        label={translate('helpCenterTitle', lang)}
      >
        <div className="flex items-center gap-2 px-3 py-2 dialog-chrome border-b border-border text-text-primary font-semibold">
          <HelpCircle size={16} />
          <span>{translate('helpCenterTitle', lang)}</span>
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer ml-auto"
            onClick={close}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {HELP_SECTIONS.map((section) => {
            const Icon = section.icon;
            const steps = (translate(section.stepsKey, lang) || '').split('\n').filter(Boolean);
            return (
              <section key={section.id} className="flex flex-col gap-2">
                <h2 className="flex items-center gap-1.5 text-base font-semibold text-text-primary m-0 pb-1 border-b border-border">
                  <Icon size={14} className="text-accent flex-shrink-0" />
                  {translate(section.titleKey, lang)}
                </h2>
                <p className="m-0 text-sm text-text-secondary leading-[1.5]">
                  {translate(section.descKey, lang)}
                </p>
                {steps.length > 0 && (
                  <ol className="m-0 pl-5 text-sm text-text-primary leading-[1.7] list-decimal">
                    {steps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>

        <div className="px-3 py-2 flex justify-end dialog-chrome border-t border-border">
          <button
            className="px-3 py-1.5 mr-2 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-sm transition-colors hover:bg-bg-button-hover"
            onClick={() => useOnboardingStore.getState().openWizard()}
          >
            {translate('tourReplay', lang)}
          </button>
          <button
            className="px-3 py-1.5 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-sm text-center transition-colors hover:bg-bg-button-hover"
            onClick={close}
          >
            {translate('helpClose', lang)}
          </button>
        </div>
      </DialogSurface>
    </DialogOverlay>
  );
}

/// 懒加载入口 — 见 `components/lazy/lazyComponents.ts` (全仓唯一 React.lazy 清单)。
export default HelpCenterModal;
