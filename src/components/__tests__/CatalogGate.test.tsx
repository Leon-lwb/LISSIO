import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { tauriMock } from '../../test/setup';
import { CatalogGate } from '../BackendConnectionGate';
import { resetModelCatalogForTests, useModelCatalogStore } from '../../store/modelCatalogStore';
import { resetDescribeForTests } from '../../lib/models/describeStore';

describe('CatalogGate (启动屏障)', () => {
  afterEach(() => {
    resetModelCatalogForTests();
    resetDescribeForTests();
    tauriMock.invoke.mockReset();
  });

  it('keeps business UI unmounted while the catalog is loading', () => {
    useModelCatalogStore.setState({ status: 'loading' });
    render(<CatalogGate><div data-testid="business" /></CatalogGate>);
    expect(screen.queryByTestId('business')).toBeNull();
    expect(screen.getByText('正在加载模型目录…')).toBeInTheDocument();
  });

  it('renders business UI once the catalog is ready', () => {
    useModelCatalogStore.setState({ status: 'ready' });
    render(<CatalogGate><div data-testid="business" /></CatalogGate>);
    expect(screen.getByTestId('business')).toBeInTheDocument();
  });

  it('shows a retry page on catalog failure and does not mount children', async () => {
    const user = userEvent.setup();
    useModelCatalogStore.setState({ status: 'error', error: '后端目录缺失' });
    render(<CatalogGate><div data-testid="business" /></CatalogGate>);
    expect(screen.queryByTestId('business')).toBeNull();
    expect(screen.getByText('模型目录加载失败')).toBeInTheDocument();

    tauriMock.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_model_catalog') {
        return Promise.resolve({
          contractVersion: 1,
          revision: 'rev-mock',
          models: [{
            id: 'widget:Knob', family: 'widget', schemaVersion: 1,
            display: { fallbackLabel: 'Knob', category: 'display', sortValue: 0 },
            ui: { rendererKey: 'Knob', editorKey: 'Knob', icon: null },
            configuration: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null },
            defaultConfig: null, variants: [], actions: ['createNode'],
            availability: { state: 'available', reason: null },
          }],
        });
      }
      return Promise.resolve(undefined);
    });
    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getByTestId('business')).toBeInTheDocument());
    expect(useModelCatalogStore.getState().status).toBe('ready');
  });

  it('shows an incompatible page carrying the backend contract version', () => {
    useModelCatalogStore.setState({ status: 'incompatible', contractVersion: 99 });
    render(<CatalogGate><div data-testid="business" /></CatalogGate>);
    expect(screen.queryByTestId('business')).toBeNull();
    expect(screen.getByText('模型目录版本不兼容')).toBeInTheDocument();
    expect(screen.getByText(/99/)).toBeInTheDocument();
  });

  it('triggers a load when mounted while idle', async () => {
    tauriMock.invoke.mockClear();
    useModelCatalogStore.setState({ status: 'idle' });
    render(<CatalogGate><div data-testid="business" /></CatalogGate>);
    await waitFor(() => {
      expect(useModelCatalogStore.getState().status).not.toBe('idle');
    });
  });
});
