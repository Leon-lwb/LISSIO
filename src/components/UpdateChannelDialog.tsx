import type { Dispatch, SetStateAction } from 'react';
import { activateOnKeyboard } from '../lib/utils/a11y';
import { useAppStore } from '../store/appStore';
import { translate } from '../i18n';
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
          {translate('updateChannelConfirmTitle', lang)}
        </div>
        <div className="text-xs text-text-secondary leading-relaxed">
          {translate(pendingChannel === 'beta' ? 'updateChannelToBetaMsg' : 'updateChannelToStableMsg', lang)}
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="dialog-button dialog-button--ghost"
            onClick={() => setPendingChannel(null)}
          >
            {translate('updateCancel', lang)}
          </button>
          <button
            className="dialog-button dialog-button--primary"
            onClick={() => {
              setUpdateChannel(pendingChannel);
              setPendingChannel(null);
            }}
          >
            {translate('updateConfirm', lang)}
          </button>
        </div>
      </DialogSurface>
    </DialogOverlay>
  );
}
