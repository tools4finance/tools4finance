"use client";

export type DonutSlice = {
  key: string;
  label: string;
  amount: number;
  pct: number;
  color: string;
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, startPct: number, endPct: number) {
  const startAngle = startPct * 3.6;
  const endAngle = Math.max(endPct * 3.6, startAngle + 0.01);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const outerStart = polarToCartesian(cx, cy, rOuter, startAngle);
  const outerEnd = polarToCartesian(cx, cy, rOuter, endAngle);
  const innerStart = polarToCartesian(cx, cy, rInner, startAngle);
  const innerEnd = polarToCartesian(cx, cy, rInner, endAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

// Real SVG donut (not a CSS conic-gradient div) so it scales naturally on
// any screen size, supports a native hover tooltip per slice (<title>, zero
// JS), and can carry on-ring % labels — none of which a conic-gradient
// background can do. Legend is capped at maxWidth rather than flex:1, so it
// doesn't stretch all the way across a wide panel and strand its numbers far
// from their labels.
export function DonutChart({
  slices,
  centerLabel,
  centerValue,
  formatAmount,
  formatPct,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
  formatAmount: (n: number) => string;
  formatPct: (n: number) => string;
}) {
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 92;
  const rInner = 55;
  const rLabel = (rOuter + rInner) / 2;
  const innerPct = (rInner / (size / 2)) * 100;
  const innerOffset = (100 - innerPct) / 2;

  let cum = 0;
  const withRanges = slices.map((s) => {
    const start = cum;
    cum += s.pct;
    return { ...s, start, end: cum };
  });

  return (
    <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ position: "relative", width: 200, maxWidth: "100%", flexShrink: 0 }}>
        <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", height: "auto", display: "block" }}>
          {withRanges.map((s) => (
            <path key={s.key} d={arcPath(cx, cy, rOuter, rInner, s.start, s.end)} fill={s.color}>
              <title>{`${s.label}: ${formatAmount(s.amount)} (${formatPct(s.pct)})`}</title>
            </path>
          ))}
          {withRanges
            .filter((s) => s.pct >= 6)
            .map((s) => {
              const mid = (s.start + s.end) / 2;
              const pos = polarToCartesian(cx, cy, rLabel, mid * 3.6);
              return (
                <text
                  key={`label-${s.key}`}
                  x={pos.x}
                  y={pos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={9}
                  fontWeight={600}
                  fill="#FFFFFF"
                  style={{ pointerEvents: "none" }}
                >
                  {formatPct(s.pct)}
                </text>
              );
            })}
        </svg>
        <div
          style={{
            position: "absolute",
            top: `${innerOffset}%`,
            left: `${innerOffset}%`,
            width: `${innerPct}%`,
            height: `${innerPct}%`,
            borderRadius: "50%",
            background: "var(--surface)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 4,
          }}
        >
          <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {centerLabel}
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{centerValue}</div>
        </div>
      </div>

      <div style={{ flex: "1 1 220px", minWidth: 220, maxWidth: 380, display: "flex", flexDirection: "column", gap: 10 }}>
        {slices.map((seg) => (
          <div key={seg.key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: seg.color, flexShrink: 0 }} />
            <span className="wrap" style={{ flex: 1, color: "var(--text)" }}>
              {seg.label}
            </span>
            <span style={{ color: "var(--text2)", whiteSpace: "nowrap" }}>{formatAmount(seg.amount)}</span>
            <span style={{ color: "var(--text3)", width: 48, textAlign: "right", flexShrink: 0 }}>
              {formatPct(seg.pct)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
