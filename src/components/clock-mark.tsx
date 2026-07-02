/**
 * Animated clock mark — live ticking SVG logo.
 * Second hand sweeps once per minute; minute & hour hands track real time.
 * Renders crisp at any size. Tints follow currentColor with a gold accent.
 */
import { useEffect, useState } from "react";

export function ClockMark({
  size = 32,
  className = "",
  live = true,
}: {
  size?: number;
  className?: string;
  /** When false, hands freeze at 10:10 for a "marketing" pose. */
  live?: boolean;
}) {
  const [now, setNow] = useState<Date | null>(live ? new Date() : null);

  useEffect(() => {
    if (!live) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [live]);

  // 10:10 marketing pose by default (and on SSR / first paint before mount)
  let hourDeg = (10 % 12) * 30 + 10 * 0.5; // 305
  let minuteDeg = 10 * 6;                  // 60
  let secondDeg = 0;

  if (now) {
    const h = now.getHours() % 12;
    const m = now.getMinutes();
    const s = now.getSeconds();
    const ms = now.getMilliseconds();
    hourDeg = h * 30 + m * 0.5;
    minuteDeg = m * 6 + s * 0.1;
    secondDeg = s * 6 + (ms / 1000) * 6;
  }

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="ClockWork"
    >
      <defs>
        <radialGradient id="cw-face" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.08" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cw-bezel" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      {/* Bezel */}
      <circle cx="32" cy="32" r="29" fill="none" stroke="url(#cw-bezel)" strokeWidth="2.5" />
      {/* Inner face */}
      <circle cx="32" cy="32" r="26" fill="url(#cw-face)" />

      {/* Hour ticks */}
      {Array.from({ length: 12 }).map((_, i) => {
        const long = i % 3 === 0;
        return (
          <line
            key={i}
            x1="32"
            y1={long ? 7 : 8.5}
            x2="32"
            y2={long ? 12 : 10.5}
            stroke="currentColor"
            strokeOpacity={long ? 0.85 : 0.45}
            strokeWidth={long ? 1.6 : 1}
            strokeLinecap="round"
            transform={`rotate(${i * 30} 32 32)`}
          />
        );
      })}

      {/* Hour hand */}
      <line
        x1="32" y1="36" x2="32" y2="20"
        stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"
        transform={`rotate(${hourDeg} 32 32)`}
        style={{ transition: live ? "transform 600ms cubic-bezier(0.22,1,0.36,1)" : undefined }}
      />
      {/* Minute hand */}
      <line
        x1="32" y1="37" x2="32" y2="14"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
        transform={`rotate(${minuteDeg} 32 32)`}
        style={{ transition: live ? "transform 600ms cubic-bezier(0.22,1,0.36,1)" : undefined }}
      />
      {/* Second hand — gold accent, smooth sweep */}
      <g
        transform={`rotate(${secondDeg} 32 32)`}
        style={{ transition: live ? "transform 950ms cubic-bezier(0.4,2.2,0.55,0.9)" : undefined }}
      >
        <line
          x1="32" y1="40" x2="32" y2="11"
          stroke="var(--color-gold)" strokeWidth="1.4" strokeLinecap="round"
        />
        <circle cx="32" cy="11.5" r="1.6" fill="var(--color-gold)" />
      </g>

      {/* Center pin */}
      <circle cx="32" cy="32" r="2.6" fill="currentColor" />
      <circle cx="32" cy="32" r="1" fill="var(--color-gold)" />
    </svg>
  );
}
