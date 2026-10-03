export * from './tauriTypes';

import { acquisitionApi } from './api/acquisition';
import { aiApi } from './api/ai';
import { canApi } from './api/can';
import { graphApi } from './api/graph';
import { observabilityApi } from './api/observability';
import { recordingApi } from './api/recording';
import { transportApi } from './api/transport';
import { waveformApi } from './api/waveform';

export const api = {
  ...acquisitionApi,
  ...transportApi,
  ...waveformApi,
  ...graphApi,
  ...canApi,
  ...observabilityApi,
  ...recordingApi,
  ...aiApi,
};
