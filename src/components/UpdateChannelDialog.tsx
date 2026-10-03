import type { Dispatch, SetStateAction } from 'react';
import { activateOnKeyboard } from '../lib/utils/a11y';
import { useAppStore } from '../store/appStore';
import { t } from '../i18n';
import type { UpdateChannel } from '../store/updateStore';
import { DialogOverlay, DialogSurface } from './ui/Dialog';

interface UpdateChannelDialogProps {
  pendingChannel: UpdateChannel | null;
  setPendingChannel: Dispatch<SetStateAction<UpdateChannel | null>>;
  setUpdateChannel: (channel: UpdateChannel) => void;
}

export function UpdateChannelDialog({
  pendingChannel,
  setPendingChannel,
  setUpdateChannel,
}: UpdateChannelDialogProps) {
  const lang = useAppStore((s) => s.lang);
  if (!pendingChannel) return null;

  return (
    <DialogOverlay
      zClassName="z-modal-secondary"
      onClick={(event) => {
        event.stopPropagation();
        setPendingChannel(null);
      }}
      onKeyDown={activateOnKeyboard}
      role="button"
      tabIndex={0}
    >
      <DialogSurface className="dialog-surface w-[360px] max-w-[90vw] p-5 gap-3 animate-[settings-slide-in_0.2s_ease-out]">
        <div className="text-sm font-semibold text-text-bright">
          {t(lang, 'updateChannelConfirmTitle')}
        </div>
        <div className="text-xs text-text-secondary leading-relaxed">
          {t(lang, pendingChannel === 'beta' ? 'updateChannelToBetaMsg' : 'updateChannelToStableMsg')}
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="dialog-button dialog-button--ghost"
            onClick={() => setPendingChannel(null)}
          >
            {t(lang, 'updateCancel')}
          </button>
          <button
            className="dialog-button dialog-button--primary"
            onClick={() => {
              setUpdateChannel(pendingChannel);
              setPendingChannel(null);
            }}
          >
            {t(lang, 'updateConfirm')}
          </button>
        </div>
      </DialogSurface>
    </DialogOverlay>
  );
}
