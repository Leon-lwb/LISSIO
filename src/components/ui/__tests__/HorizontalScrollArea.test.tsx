import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HorizontalScrollArea } from '../HorizontalScrollArea';

function setScrollMetrics(
  element: HTMLElement,
  { scrollLeft = 0, scrollWidth = 800, clientWidth = 200 } = {}
) {
  Object.defineProperties(element, {
    scrollLeft: { configurable: true, value: scrollLeft, writable: true },
    scrollWidth: { configurable: true, value: scrollWidth },
    clientWidth: { configurable: true, value: clientWidth },
  });
}

describe('HorizontalScrollArea', () => {
  it('maps mouse wheel movement to horizontal scrolling', () => {
    render(
      <HorizontalScrollArea data-testid="scroll-area">
        <div style={{ width: 800 }}>content</div>
      </HorizontalScrollArea>
    );
    const area = screen.getByTestId('scroll-area');
    setScrollMetrics(area);

    const wheel = createEvent.wheel(area, { deltaY: 120 });
    fireEvent(area, wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(area.scrollLeft).toBe(120);
  });

  it('shows a shadow only in directions that still have content', () => {
    const { container } = render(
      <HorizontalScrollArea data-testid="scroll-area">
        <div style={{ width: 800 }}>content</div>
      </HorizontalScrollArea>
    );
    const area = screen.getByTestId('scroll-area');
    const start = container.querySelector('.horizontal-scroll-shadow-start');
    const end = container.querySelector('.horizontal-scroll-shadow-end');

    setScrollMetrics(area, { scrollLeft: 0 });
    fireEvent.scroll(area);
    expect(start).toHaveAttribute('data-visible', 'false');
    expect(end).toHaveAttribute('data-visible', 'true');

    setScrollMetrics(area, { scrollLeft: 300 });
    fireEvent.scroll(area);
    expect(start).toHaveAttribute('data-visible', 'true');
    expect(end).toHaveAttribute('data-visible', 'true');

    setScrollMetrics(area, { scrollLeft: 600 });
    fireEvent.scroll(area);
    expect(start).toHaveAttribute('data-visible', 'true');
    expect(end).toHaveAttribute('data-visible', 'false');
  });

  it('does not intercept wheel input when there is no overflow', () => {
    render(
      <HorizontalScrollArea data-testid="scroll-area">
        <div>content</div>
      </HorizontalScrollArea>
    );
    const area = screen.getByTestId('scroll-area');
    setScrollMetrics(area, { scrollWidth: 200, clientWidth: 200 });

    const wheel = createEvent.wheel(area, { deltaY: 120 });
    fireEvent(area, wheel);

    expect(wheel.defaultPrevented).toBe(false);
    expect(area.scrollLeft).toBe(0);
  });
});
