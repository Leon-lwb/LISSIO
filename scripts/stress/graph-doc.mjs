#!/usr/bin/env node
// Generates the workspace document JSON that backend-cli `graph update` needs (a stress-test graph).
//
// Two byte-rate designs (JustFloat frame = channels*4 + 4 bytes):
//   4ch    : fixed 4 channels, sample rate = target rate / 20 B — relies on the 5 MHz sample-rate validation ceiling;
//   multich: sample rate stays under 700 kHz, and the byte rate is scaled with the channel count (does not rely on the relaxed ceiling).
//
// Usage:
//   node scripts/stress/graph-doc.mjs --mode 4ch --mbps 50 --out /tmp/doc.json
// The document goes to --out; the rate-conversion metadata goes to stdout (a single JSON line, for the orchestrator to archive/check in reports).

import { writeFileSync } from 'node:fs';

const MAX_MULTICH_RATE = 700_000; // design constraint of multich mode: do not cross the original validation ceiling
const TAB_ID = 't1';
const DEVICE_ID = 'gen';
const PROTOCOL_ID = 'jf';
const WIDGET_ID = 'wave';

function parseArgs(argv) {
  const options = { mode: null, mbps: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} is missing a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--mode': options.mode = next(); break;
      case '--mbps': options.mbps = Number(next()); break;
      case '--out': options.out = next(); break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.mode !== '4ch' && options.mode !== 'multich') {
    throw new Error('--mode must be 4ch or multich');
  }
  if (!(options.mbps > 0) || !Number.isFinite(options.mbps)) {
    throw new Error('--mbps must be a positive number');
  }
  if (!options.out) throw new Error('--out is missing the output file path');
  return options;
}

// Convert from the target byte rate to (channels, sampleRate). See the scenario matrix in scripts/bench-stress.sh.
export function rateDesign(mode, mbps) {
  if (mode === '4ch') {
    const frameBytes = 4 * 4 + 4;
    const sampleRate = Math.round((mbps * 1e6) / frameBytes);
    return { channels: 4, frameBytes, sampleRate };
  }
  const channels = Math.max(1, Math.ceil((mbps * 1e6) / MAX_MULTICH_RATE / 4 - 1));
  const frameBytes = 4 * channels + 4;
  let sampleRate = Math.round((mbps * 1e6) / frameBytes);
  if (sampleRate > MAX_MULTICH_RATE) sampleRate = MAX_MULTICH_RATE;
  return { channels, frameBytes, sampleRate };
}

export function buildDocument({ channels }) {
  const documents = [
    {
      id: DEVICE_ID,
      tabId: TAB_ID,
      label: 'stress-gen',
      layout: { x: 0, y: 0 },
      kind: 'device',
      config: {
        enabled: true,
        capabilityEndpointId: 'device',
        driver: { driverId: 'udp', schemaVersion: 1, payload: {} },
      },
      attributes: {
        testData: {
          signal: { waveform: 'sine', frequency: 1, amplitude: 1, offset: 0 },
          sampleRate: null, // filled in by the caller
          seed: 1,
          channels,
          overrides: {},
          referenceNodeId: null,
          encoding: null,
        },
      },
    },
    {
      id: PROTOCOL_ID,
      tabId: TAB_ID,
      label: 'stress-justfloat',
      layout: { x: 240, y: 0 },
      kind: 'protocol',
      config: {
        protocol: { kind: 'JustFloat', channels },
        convertTo: null,
        schema: { preset: 'justFloat' },
      },
      attributes: {},
    },
    {
      id: WIDGET_ID,
      tabId: TAB_ID,
      label: 'stress-wave',
      layout: { x: 480, y: 0 },
      kind: 'widget',
      config: { widgetKind: 'Waveform', params: {} },
      attributes: {},
    },
  ];
  const edges = [
    { id: 'e-rx', source: DEVICE_ID, source_handle: 'rx', target: PROTOCOL_ID, target_handle: 'in' },
  ];
  for (let ch = 0; ch < channels; ch += 1) {
    edges.push({
      id: `e-ch${ch}`,
      source: PROTOCOL_ID,
      source_handle: `ch${ch}`,
      target: WIDGET_ID,
      target_handle: `CH${ch}`,
    });
  }
  return { documents, edges };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  const design = rateDesign(options.mode, options.mbps);
  const document = buildDocument(design);
  document.documents[0].attributes.testData.sampleRate = design.sampleRate;
  writeFileSync(options.out, `${JSON.stringify(document, null, 2)}\n`);
  console.log(JSON.stringify({
    mode: options.mode,
    target_MB_s: options.mbps,
    channels: design.channels,
    frame_bytes: design.frameBytes,
    sample_rate: design.sampleRate,
    nominal_MB_s: (design.sampleRate * design.frameBytes) / 1e6,
    source_node: DEVICE_ID,
    protocol_node: PROTOCOL_ID,
  }));
}
