import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildLissajousPath, LissajousMark } from '../LissajousMark';

describe('LissajousMark', () => {
  it('draws the 3:4 Lissajous path from the shared formula', () => {
    const path = buildLissajousPath(1, 4);
    expect(path).toMatch(/^M 80\.00 50\.00/);
    expect(path.split(' L ')).toHaveLength(5);
  });

  it('exposes an accessible label when used as a loading indicator', () => {
    render(<LissajousMark label="Loading" animated={false} />);
    expect(screen.getByRole('img', { name: 'Loading' })).toBeInTheDocument();
  });
});
