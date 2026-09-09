import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildLissajousParticles, buildLissajousPath, LissajousMark } from '../LissajousMark';

describe('LissajousMark', () => {
  it('draws the 3:4 Lissajous path from the shared formula', () => {
    const path = buildLissajousPath(1, 4);
    expect(path).toMatch(/^M 80\.00 50\.00/);
    expect(path.split(' L ')).toHaveLength(5);
  });

  it('builds a fading comet trail of brand-colored particles', () => {
    const particles = buildLissajousParticles(0, 1);
    expect(particles).toHaveLength(68);
    expect(particles[0]).toMatchObject({ radius: 3.6, opacity: 1, color: 'rgb(200,255,77)' });
    expect(particles[67]).toMatchObject({ radius: 0.9, opacity: 0.04, color: 'rgb(49,92,255)' });
  });

  it('exposes an accessible label when used as a loading indicator', () => {
    render(<LissajousMark label="Loading" animated={false} />);
    expect(screen.getByRole('img', { name: 'Loading' })).toBeInTheDocument();
  });
});
