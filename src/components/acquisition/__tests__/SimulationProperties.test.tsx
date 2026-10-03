import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';;
import type { Node } from '@xyflow/react';
import { useAppStore } from '../../../store/appStore';
import { api } from '../../../lib/tauri/tauri';
import { SimulationProperties } from '../SimulationProperties';
import { acquisitionNodeFromDecl } from '../../../test/acquisitionFixtures';
import type { DeviceTreeNodeDecl, SimulationConfig } from '../../../types';
import type { AcquisitionNodeData } from '../../../lib/acquisition/acquisitionNodes';

/// 带测试数据子节点的设备声明 (encoding 由用例注入)
function declWithSimulation(encoding: SimulationConfig['encoding']): DeviceTreeNodeDecl {
  return {
    id: 'device-1',
    name: 'Serial',
    driver: 'serial',
    schemaVersion: 1,
    config: {},
    enabled: true,
    capabilityEndpointId: 'device',
    children: [{
      id: 'device-1::simulation',
      name: 'simulation',
      driver: 'simulation',
      schemaVersion: 1,
      config: {
        signal: { waveform: 'sine', frequency: 1, amplitude: 1, offset: 0 },
        sampleRate: 100,
        seed: 1,
        channels: 4,
        overrides: {},
        referenceNodeId: null,
        encoding,
      } satisfies SimulationConfig,
      enabled: true,
      children: [],
    }],
  };
}

function nodeOf(decl: DeviceTreeNodeDecl): Node {
  const node = acquisitionNodeFromDecl(decl);
  return { ...node, data: { ...(node.data), ports: [] } };
}

describe('SimulationProperties 生成格式', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'updateTabGraph').mockResolvedValue({ nodes: [], version: 1 });
    useAppStore.setState({
      rfNodes: [],
      rfEdges: [],
      controlTabs: [{ id: 'default', name: 'One' }],
      activeControlTabId: 'default',
    });
  });

  it('无下游解析器时可选 Slcan/CandleLight (测试数据要能产出 CAN 帧)', () => {
    const node = nodeOf(declWithSimulation(null));
    useAppStore.setState({ rfNodes: [node] });
    renderWithI18n(<SimulationProperties node={node} />);

    const select = screen.getByLabelText('生成格式');
    const options = within(select).getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['', 'JustFloat', 'FireWater', 'RawData', 'Slcan', 'CandleLight']);
  });

  it('选择 Slcan 后编码写入设备文档', () => {
    const node = nodeOf(declWithSimulation(null));
    useAppStore.setState({ rfNodes: [node] });
    renderWithI18n(<SimulationProperties node={node} />);

    fireEvent.change(screen.getByLabelText('生成格式'), { target: { value: 'Slcan' } });

    const device = useAppStore.getState().rfNodes.find((n) => n.id === 'device-1');
    const child = (device?.data as AcquisitionNodeData | undefined)?.node.children
      .find((c) => c.driver === 'simulation');
    expect((child?.config as { encoding?: { protocol?: { kind?: string } } }).encoding?.protocol?.kind)
      .toBe('Slcan');
  });

  it('生成速率的量纲与上限随已选协议收窄 (帧率不得与采样率同界)', () => {
    const slcan = nodeOf(declWithSimulation(
      { protocol: { kind: 'Slcan' }, schema: null },
    ));
    useAppStore.setState({ rfNodes: [slcan] });
    const slcanView = renderWithI18n(<SimulationProperties node={slcan} />);

    const frameRate = screen.getByLabelText<HTMLInputElement>('生成速率 (帧/秒)');
    expect(frameRate.max).toBe('20000');
    slcanView.unmount();

    const justFloat = nodeOf(declWithSimulation(
      { protocol: { kind: 'JustFloat', channels: 4 }, schema: null },
    ));
    useAppStore.setState({ rfNodes: [justFloat] });
    renderWithI18n(<SimulationProperties node={justFloat} />);

    const sampleRate = screen.getByLabelText<HTMLInputElement>('生成速率 (采样/秒)');
    expect(sampleRate.max).toBe('5000000');
  });
});
