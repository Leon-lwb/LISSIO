import { useEffect } from 'react';
import { canFrameBuffer } from './canBuffer';
import { subscribeCanFrames } from './canSubscription';

/** CAN 缓冲区的唯一入口，生命周期与应用根组件一致。 */
export function useCanFrameSubscription(): void {
  useEffect(() => {
    const subscription = subscribeCanFrames((batch) => canFrameBuffer.push(batch.frames));
    return () => subscription.cancel();
  }, []);
}
