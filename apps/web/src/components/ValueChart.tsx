/** Static SVG area chart for the DEMO value series. No interactivity, no live data. */
export function ValueChart({ series, label }: { series: number[]; label: string }) {
  const w = 600, h = 120, pad = 4;
  const min = Math.min(...series), max = Math.max(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) => {
    const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w - pad},${h - pad} L${pad},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="h-28 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="vc-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#vc-fill)" />
      <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
