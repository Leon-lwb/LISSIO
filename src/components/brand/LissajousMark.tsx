import { useEffect, useId, useMemo, useRef } from 'react';

const TAU = Math.PI * 2;
const PATH_STEPS = 360;

export interface LissajousMarkProps {
  size?: number;
  animated?: boolean;
  label?: string;
  className?: string;
}

/**
 * Lissio 的 3:4 利萨茹曲线。
 *
 * A = 24 + 6s
 * x(t) = 50 + sin(3t + π/2) · A
 * y(t) = 50 + sin(4t) · 0.92A
 */
export function buildLissajousPath(detailScale: number, steps = PATH_STEPS): string {
  const amp = 24 + Math.min(1, Math.max(0, detailScale)) * 6;
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const t = (index / steps) * TAU;
    const x = 50 + Math.sin(3 * t + Math.PI / 2) * amp;
    const y = 50 + Math.sin(4 * t) * amp * 0.92;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return points.join(' ');
}

export function LissajousMark({
  size = 48,
  animated = true,
  label,
  className = '',
}: LissajousMarkProps) {
  const gradientId = `lissio-gradient-${useId().split(':').join('')}`;
  const groupRef = useRef<SVGGElement>(null);
  const initialPath = useMemo(() => buildLissajousPath(0.76), []);

  useEffect(() => {
    if (!animated || !groupRef.current) return;
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (media?.matches) return;

    let frame = 0;
    const startedAt = performance.now();
    const render = (now: number) => {
      const pulse = (Math.sin(((now - startedAt) / 5400) * TAU + 0.55) + 1) / 2;
      const path = buildLissajousPath(0.52 + pulse * 0.48);
      groupRef.current?.querySelectorAll<SVGPathElement>('[data-lissio-path]')
        .forEach((node) => node.setAttribute('d', path));
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [animated]);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`lissajous-mark${animated ? ' lissajous-mark--animated' : ''} ${className}`.trim()}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="18" y1="18" x2="82" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#315CFF" />
          <stop offset="0.58" stopColor="#45E6C3" />
          <stop offset="1" stopColor="#C8FF4D" />
        </linearGradient>
      </defs>
      <g ref={groupRef}>
        <path data-lissio-path d={initialPath} className="lissajous-mark__track" pathLength="100" />
        <path
          data-lissio-path
          d={initialPath}
          className="lissajous-mark__trail"
          pathLength="100"
          stroke={`url(#${gradientId})`}
        />
        <path data-lissio-path d={initialPath} className="lissajous-mark__head" pathLength="100" />
      </g>
    </svg>
  );
}
