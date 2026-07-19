import React, { useMemo } from 'react';

// Brand-flavoured confetti colors (coral / sage / amber ramps).
const COLORS = ['#E85D4C', '#F5A794', '#7A9B76', '#F59E0B', '#2F9E56', '#FCD34D'];

export interface ConfettiBurstProps {
  count?: number;
}

/**
 * A subtle, pure-CSS confetti drizzle for the "all as per LAP" celebration.
 * Uses the theme's `confetti-fall` keyframes; renders once and fades away
 * (animation fill: forwards) — no JS animation loop, no dependencies.
 */
const ConfettiBurst: React.FC<ConfettiBurstProps> = ({ count = 28 }) => {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.6,
        duration: 3.2 + Math.random() * 2.2,
        size: 6 + Math.random() * 6,
        color: COLORS[i % COLORS.length],
        round: i % 3 === 0,
      })),
    [count],
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`absolute top-0 block animate-confetti-fall ${p.round ? 'rounded-full' : 'rounded-[2px]'}`}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.55,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
};

export default ConfettiBurst;
