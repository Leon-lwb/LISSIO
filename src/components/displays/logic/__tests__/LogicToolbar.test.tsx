import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DecodedEventList } from '../DecodedEventList';
import { LogicTimingChart } from '../LogicTimingChart';

vi.mock('../../../../lib/buffers/logicSubscription', () => ({
  clearDecodedBuffer: vi.fn().mockResolvedValue(undefined),
  clearLogicBuffer: vi.fn().mockResolvedValue(undefined),
  subscribeDecodedEventsFiltered: vi.fn(() => ({ cancel: vi.fn() })),
}));

function expectHorizontalToolbar(container: HTMLElement) {
  const toolbar = container.querySelector('.horizontal-scroll-area');

  expect(toolbar).toHaveClass('flex-nowrap');
  expect(toolbar).toHaveClass('overflow-x-auto');
  expect(toolbar).toHaveClass('overflow-y-hidden');
  expect(container.querySelector('.horizontal-scroll-shadow-start')).not.toBeNull();
  expect(container.querySelector('.horizontal-scroll-shadow-end')).not.toBeNull();
}

describe('logic panel toolbars', () => {
  it('supports wheel scrolling and directional shadows in the timing toolbar', () => {
    const { container } = render(<LogicTimingChart />);

    expectHorizontalToolbar(container);
  });

  it('supports wheel scrolling and directional shadows in the decoded-event toolbar', () => {
    const { container } = render(<DecodedEventList />);

    expectHorizontalToolbar(container);
  });
});
