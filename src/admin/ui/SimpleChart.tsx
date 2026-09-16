import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useElementWidth } from '../lib/hooks';

export interface ChartPoint {
  label: string;
  value: number;
}

interface SimpleChartProps {
  kind: 'line' | 'bar';
  points: ChartPoint[];
  title: string;
  description: string;
  formatValue: (v: number) => string;
  height?: number;
  /** counts: ticks land on whole numbers */
  integer?: boolean;
}

const PAD = { top: 16, right: 12, bottom: 28, left: 56 };

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/**
 * Single-series SVG chart (one axis). Line gets a crosshair + tooltip; bars get
 * a per-bar tooltip. Arrow keys move the highlighted point for keyboard users.
 */
export function SimpleChart({ kind, points, title, description, formatValue, height = 220, integer }: SimpleChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const descId = useId();

  const w = Math.max(width, 280);
  const innerW = w - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const rawMax = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const max = integer ? Math.max(4, Math.ceil(rawMax / 4) * 4) : rawMax;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const n = points.length;

  const band = n ? innerW / n : innerW;
  const xAt = (i: number) => (kind === 'bar' ? PAD.left + band * i + band / 2 : PAD.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1)));
  const yAt = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const indexFromX = (clientX: number, rect: DOMRect) => {
    const x = clientX - rect.left - PAD.left;
    if (kind === 'bar') return Math.min(n - 1, Math.max(0, Math.floor(x / band)));
    return Math.min(n - 1, Math.max(0, Math.round((x / innerW) * (n - 1))));
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!n) return;
    setActive(indexFromX(e.clientX, e.currentTarget.getBoundingClientRect()));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!n) return;
    if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 90))));
  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join('');
  const areaPath = n > 1 ? `${linePath}L${xAt(n - 1).toFixed(1)},${PAD.top + innerH}L${xAt(0).toFixed(1)},${PAD.top + innerH}Z` : '';
  const barW = Math.max(2, Math.min(28, band - 2));
  const activePoint = active !== null ? points[active] : undefined;

  return (
    <div className="adm-chart" ref={ref}>
      {width > 0 && (
        <svg
          width={w}
          height={height}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>{description}</desc>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={yAt(t)} y2={yAt(t)} className={t === 0 ? 'adm-chart__base' : 'adm-chart__grid'} />
              <text x={PAD.left - 8} y={yAt(t)} dy="0.32em" textAnchor="end" className="adm-chart__tick">
                {formatValue(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={`x${i}`} x={xAt(i)} y={height - 8} textAnchor={i === 0 && kind === 'line' ? 'start' : i === n - 1 && kind === 'line' ? 'end' : 'middle'} className="adm-chart__tick">
                {i === n - 1 && i % labelEvery !== 0 && n > 2 ? '' : p.label}
              </text>
            ) : null,
          )}
          {kind === 'line' ? (
            <>
              {areaPath && <path d={areaPath} className="adm-chart__area" />}
              <path d={linePath} className="adm-chart__line" />
              {n === 1 && points[0] && <circle cx={xAt(0)} cy={yAt(points[0].value)} r={4} className="adm-chart__dot" />}
            </>
          ) : (
            points.map((p, i) => {
              const h = Math.max(0, PAD.top + innerH - yAt(p.value));
              const x = xAt(i) - barW / 2;
              const y = PAD.top + innerH - h;
              const r = Math.min(4, barW / 2, h);
              return (
                <path
                  key={i}
                  className={active === i ? 'adm-chart__bar adm-chart__bar--on' : 'adm-chart__bar'}
                  d={h > 0 ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${y + h}Z` : ''}
                />
              );
            })
          )}
          {activePoint && active !== null && kind === 'line' && (
            <>
              <line x1={xAt(active)} x2={xAt(active)} y1={PAD.top} y2={PAD.top + innerH} className="adm-chart__cross" />
              <circle cx={xAt(active)} cy={yAt(activePoint.value)} r={4.5} className="adm-chart__dot" />
            </>
          )}
        </svg>
      )}
      {activePoint && active !== null && (
        <div
          className="adm-chart__tip"
          style={{
            left: Math.min(Math.max(xAt(active), 70), w - 70),
            top: Math.max(0, yAt(activePoint.value) - 12),
          }}
          aria-live="polite"
        >
          <span className="adm-chart__tiplabel">{activePoint.label}</span>
          <strong>{formatValue(activePoint.value)}</strong>
        </div>
      )}
    </div>
  );
}
