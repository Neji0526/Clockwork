/**
 * Minimal hairline sparkline — pure SVG, no deps.
 * Renders a soft gradient area + 1px primary stroke + a gold dot at the
 * latest value. Designed to live inside metric cards.
 */
export function Sparkline({
  data,
  width = 120,
  height = 36,
  className = "",
  strokeColor = "var(--color-primary)",
  dotColor = "var(--color-gold)",
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  strokeColor?: string;
  dotColor?: string;
}) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className={className} aria-hidden>
        <line
          x1={0}
          x2={width}
          y1={height - 2}
          y2={height - 2}
          stroke="var(--color-border)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const pad = 3;
  const h = height - pad * 2;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + h - ((v - min) / range) * h;
    return [x, y] as const;
  });

  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const area = `${path} L${width.toFixed(2)},${height} L0,${height} Z`;
  const [lastX, lastY] = points[points.length - 1];
  const gradId = `sparkline-grad-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={2.75} fill={dotColor} />
      <circle
        cx={lastX}
        cy={lastY}
        r={5}
        fill={dotColor}
        opacity={0.18}
      />
    </svg>
  );
}
