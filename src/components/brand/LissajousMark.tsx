import { useEffect, useMemo, useRef } from 'react';

const TAU = Math.PI * 2;
const PATH_STEPS = 360;
const PARTICLE_COUNT = 68;
const TRAIL_SPAN = 0.34;
const DURATION_MS = 6000;
const PULSE_DURATION_MS = 5400;

// 品牌渐变三色: 头部荧光绿 → 中段信号青 → 尾部品牌蓝
const COLOR_STOPS = [
  { at: 0, rgb: [200, 255, 77] },
  { at: 0.5, rgb: [69, 230, 195] },
  { at: 1, rgb: [49, 92, 255] },
] as const;

export interface LissajousParticle {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  color: string;
}

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

function particleColor(tailOffset: number): string {
  const [a, b] =
    tailOffset <= 0.5 ? [COLOR_STOPS[0], COLOR_STOPS[1]] : [COLOR_STOPS[1], COLOR_STOPS[2]];
  const t = (tailOffset - a.at) / (b.at - a.at);
  const [r, g, bl] = a.rgb.map((channel, i) => Math.round(channel + (b.rgb[i] - channel) * t));
  return `rgb(${r},${g},${bl})`;
}

/**
 * Lissajous Drift 粒子拖尾: 头部粒子沿曲线前行 6s 一圈,
 * 尾部粒子沿轨迹按 fade = (1 - offset)^0.56 缩小并渐隐。
 */
export function buildLissajousParticles(
  progress: number,
  detailScale: number,
): LissajousParticle[] {
  const amp = 24 + Math.min(1, Math.max(0, detailScale)) * 6;
  return Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const tailOffset = index / (PARTICLE_COUNT - 1);
    const t = ((((progress - tailOffset * TRAIL_SPAN) % 1) + 1) % 1) * TAU;
    const fade = Math.pow(1 - tailOffset, 0.56);
    return {
      x: 50 + Math.sin(3 * t + Math.PI / 2) * amp,
      y: 50 + Math.sin(4 * t) * amp * 0.92,
      radius: 0.9 + fade * 2.7,
      opacity: 0.04 + fade * 0.96,
      color: particleColor(tailOffset),
    };
  });
}

function detailScaleAt(time: number): number {
  const pulse =
    (Math.sin(((time % PULSE_DURATION_MS) / PULSE_DURATION_MS) * TAU + 0.55) + 1) / 2;
  return 0.52 + pulse * 0.48;
}

export function LissajousMark({
  size = 48,
  animated = true,
  label,
  className = '',
}: LissajousMarkProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const particleRefs = useRef<(SVGCircleElement | null)[]>([]);
  const initialPath = useMemo(() => buildLissajousPath(0.76), []);
  const initialParticles = useMemo(() => buildLissajousParticles(0, 0.76), []);

  useEffect(() => {
    if (!animated || !pathRef.current) return;
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (media?.matches) return;

    let frame = 0;
    const startedAt = performance.now();
    const render = (now: number) => {
      const time = now - startedAt;
      const detailScale = detailScaleAt(time);
      const particles = buildLissajousParticles((time % DURATION_MS) / DURATION_MS, detailScale);
      pathRef.current?.setAttribute('d', buildLissajousPath(detailScale));
      particleRefs.current.forEach((node, index) => {
        const particle = particles[index];
        if (!node || !particle) return;
        node.setAttribute('cx', particle.x.toFixed(2));
        node.setAttribute('cy', particle.y.toFixed(2));
        node.setAttribute('r', particle.radius.toFixed(2));
        node.setAttribute('opacity', particle.opacity.toFixed(3));
      });
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
      <path ref={pathRef} d={initialPath} className="lissajous-mark__track" />
      {initialParticles.map((particle, index) => (
        <circle
          key={index}
          ref={(node) => {
            particleRefs.current[index] = node;
          }}
          className="lissajous-mark__particle"
          cx={particle.x}
          cy={particle.y}
          r={particle.radius}
          opacity={particle.opacity}
          fill={particle.color}
        />
      ))}
    </svg>
  );
}
