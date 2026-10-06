import type { Dispatch, SetStateAction } from 'react';
import { useAppStore } from '../store/appStore';
import { translate } from '../i18n';
import { useExitSnapshot } from '../lib/motion';
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
  const pending = useExitSnapshot(pendingChannel);
  const open = pendingChannel !== null;

  return (
    <DialogOverlay open={open} onDismiss={() => setPendingChannel(null)} zClassName="z-modal-secondary">
      <DialogSurface
        className="w-[360px] max-w-[90vw] p-5 gap-3"
        label={translate('updateChannelConfirmTitle', lang)}
      >
        <div className="text-sm font-semibold text-text-bright">
          {translate('updateChannelConfirmTitle', lang)}
        </div>
        <div className="text-xs text-text-secondary leading-relaxed">
          {translate(pending === 'beta' ? 'updateChannelToBetaMsg' : 'updateChannelToStableMsg', lang)}
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
            // 用捕获下来的 `pending` 而不是 `pendingChannel`: 退场期间后者已经是
            // `null`, 收窄不会穿过闭包边界, 类型上也不成立。
            onClick={() => {
              if (!pending) return;
              setUpdateChannel(pending);
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
