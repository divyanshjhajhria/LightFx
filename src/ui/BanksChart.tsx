import { useEffect, useId, useRef, useState } from 'react';
import { STRATEGIES } from '../sim/types';
import type { StrategyId } from '../sim/types';
import type { Arena } from '../sim/world';
import { hourTicks, overLimitRegions, spreadLabels, timeDomain, yDomain } from './chartMath';
import type { Pt, TimeMode } from './chartMath';
import { ALERT_RGB, STRATEGY, WARM, clock, signed } from './theme';

const LINE: Record<StrategyId, { width: number; alpha: number; dash?: string }> = {
  leased: { width: 2.25, alpha: 1 },
  naive: { width: 1.5, alpha: 0.6 },
  central: { width: 1.5, alpha: 0.6, dash: '5 4' },
};

interface Props {
  arena: Arena;
  mode: TimeMode;
  /** The bank on the canvas. */
  view: StrategyId;
  onView: (s: StrategyId) => void;
  /** The hover read-out; off in presenter mode. */
  hover: boolean;
}

/** The bank's true total over time, one point a minute plus where it stands now, inside the window. */
function seriesOf(arena: Arena, s: StrategyId, [t0, t1]: [number, number]): Pt[] {
  const w = arena.worlds[s];
  const pts = w.history.filter((p) => p.t >= t0 && p.t <= t1).map((p) => ({ t: p.t, v: p.total }));
  if (w.now >= t0 && w.now <= t1 && pts.at(-1)?.t !== w.now) pts.push({ t: w.now, v: w.totalPosition() });
  return pts;
}

/**
 * One chart for the three banks: their true totals on one shared scale, the bank's limit, the storm and panic, the
 * visitor's trades, and every breach as a filled red shape (width: how long; height: how far).
 */
export function BanksChart({ arena, mode, view, onView, hover }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const clipId = useId().replace(/:/g, '');

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const narrow = width > 0 && width < 700;
  const H = narrow ? 120 : 150;
  const RIGHT = narrow ? 110 : 170;
  const LEFT = 12;
  const TOP = narrow ? 28 : 34;
  const BOTTOM = H - 18;
  const L = arena.worlds.leased.cfg.limit;
  const now = arena.now;
  const domain = timeDomain(mode, now);
  const [t0, t1] = domain;
  const series = Object.fromEntries(STRATEGIES.map((s) => [s, seriesOf(arena, s, domain)])) as Record<StrategyId, Pt[]>;
  const [lo, hi] = yDomain(STRATEGIES.flatMap((s) => series[s].map((p) => p.v)), L);
  const plotW = Math.max(10, width - LEFT - RIGHT);
  const x = (t: number) => LEFT + ((t - t0) / (t1 - t0)) * plotW;
  const y = (v: number) => TOP + ((hi - v) / (hi - lo)) * (BOTTOM - TOP);
  const path = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const alert = `rgb(${ALERT_RGB})`;

  const latest = STRATEGIES.map((s) => ({ s, v: arena.worlds[s].totalPosition() }));
  const lastX = x(Math.min(Math.max(now, t0), t1));
  const labelYs = spreadLabels(latest.map((l) => y(l.v)), 17, TOP + 6, BOTTOM - 4);

  // The visitor's trades, newest first: drop an older label that would collide with a newer one.
  const marks: { x: number }[] = [];
  for (const m of [...arena.tradeMarks()].reverse()) {
    if (m.t < t0 || m.t > t1) continue;
    const mx = x(m.t);
    if (marks.every((k) => Math.abs(k.x - mx) > 64)) marks.push({ x: mx });
  }

  const spans = arena.worlds.leased.spans
    .map((sp) => ({ ...sp, a: Math.max(sp.from, t0), b: Math.min(sp.to ?? now, t1) }))
    .filter((sp) => sp.b > sp.a);

  const sentence = latest
    .map(({ s, v }) => `${STRATEGY[s].name} holds ${signed(v)}, ${Math.abs(v) > L ? 'over' : 'inside'} its limit.`)
    .join(' ');

  const at = (s: StrategyId, t: number) => {
    const h = arena.worlds[s].history;
    let best: number | null = null;
    let d = Infinity;
    for (const p of h) if (Math.abs(p.t - t) < d) (d = Math.abs(p.t - t)), (best = p.total);
    return best;
  };

  return (
    <div className="banksChart" ref={wrap} style={{ height: H }}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={`The three banks' totals over time against the bank's limit of ${L}. ${sentence}`}
          onMouseMove={(e) => {
            if (!hover) return;
            const r = e.currentTarget.getBoundingClientRect();
            const t = t0 + ((e.clientX - r.left - LEFT) / plotW) * (t1 - t0);
            setHoverT(t >= t0 && t <= Math.min(t1, now) ? Math.round(t) : null);
          }}
          onMouseLeave={() => setHoverT(null)}
        >
          <defs>
            <clipPath id={`${clipId}-out`}>
              <rect x={0} y={0} width={width} height={Math.max(0, y(L))} />
              <rect x={0} y={y(-L)} width={width} height={Math.max(0, H - y(-L))} />
            </clipPath>
          </defs>

          {/* The safe zone, the limit and zero. */}
          <rect x={LEFT} y={y(L)} width={plotW} height={y(-L) - y(L)} fill={`rgba(${WARM},0.04)`} />
          <line x1={LEFT} x2={LEFT + plotW} y1={y(0)} y2={y(0)} stroke={`rgba(${WARM},0.08)`} />
          {[L, -L].map((v) => (
            <line key={v} x1={LEFT} x2={LEFT + plotW} y1={y(v)} y2={y(v)} stroke={`rgba(${WARM},0.35)`} />
          ))}
          <text x={LEFT + 4} y={y(L) - 5} className="chartLabel limitLabel">
            Limit +{L}
          </text>
          {/* Above its line: below it there are only a few pixels before the time axis on the ±1.2 × limit scale. */}
          <text x={LEFT + 4} y={y(-L) - 5} className="chartLabel limitLabel">
            Limit −{L}
          </text>

          {/* Hours along the bottom. */}
          {hourTicks(domain).map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={BOTTOM} y2={BOTTOM + 4} stroke={`rgba(${WARM},0.35)`} />
              <text x={x(t)} y={BOTTOM + 15} textAnchor="middle" className="chartLabel">
                {clock(t)}
              </text>
            </g>
          ))}

          {/* Storm and panic strips along the top. */}
          {spans.map((sp, i) => (
            <g key={`${sp.kind}-${sp.from}-${i}`}>
              <rect
                x={x(sp.a)}
                y={sp.kind === 'storm' ? 2 : 8}
                width={x(sp.b) - x(sp.a)}
                height={4}
                fill={sp.kind === 'storm' ? `rgba(${ALERT_RGB},0.6)` : `rgba(${WARM},0.45)`}
              />
              <text
                x={x(sp.a)}
                y={sp.kind === 'storm' ? 19 : 30}
                className="chartLabel"
                fill={sp.kind === 'storm' ? `rgba(${ALERT_RGB},0.9)` : `rgba(${WARM},0.6)`}
              >
                {sp.kind === 'storm' ? 'Solar storm' : 'Panic'}
              </text>
            </g>
          ))}

          {/* Breaches: the area between a trace and the limit it crossed. */}
          {STRATEGIES.flatMap((s) =>
            overLimitRegions(series[s], L).map((r, i) => (
              <path key={`${s}-${i}`} d={`${path(r.points)}Z`} fill={`rgba(${ALERT_RGB},0.22)`} />
            )),
          )}

          {/* The three totals, then the same lines again in the alert colour wherever they are outside the limit. */}
          {STRATEGIES.map((s) => (
            <g key={s}>
              <path
                d={path(series[s])}
                fill="none"
                stroke={`rgba(${WARM},${LINE[s].alpha})`}
                strokeWidth={LINE[s].width}
                strokeDasharray={LINE[s].dash}
                strokeLinejoin="round"
              />
              <path
                d={path(series[s])}
                fill="none"
                stroke={alert}
                strokeWidth={LINE[s].width}
                strokeDasharray={LINE[s].dash}
                strokeLinejoin="round"
                clipPath={`url(#${clipId}-out)`}
              />
              <path d={path(series[s])} fill="none" stroke="transparent" strokeWidth={12} className="traceHit" onClick={() => onView(s)} />
            </g>
          ))}

          {/* The visitor's trades on the time axis. */}
          {marks.map((m) => (
            <g key={m.x}>
              <path d={`M${m.x},${BOTTOM - 4}L${m.x + 4},${BOTTOM}L${m.x},${BOTTOM + 4}L${m.x - 4},${BOTTOM}Z`} fill={`rgba(${WARM},0.9)`} />
              <text x={m.x} y={BOTTOM - 8} textAnchor="middle" className="chartLabel">
                Your trade
              </text>
            </g>
          ))}

          {/* Where each bank stands now. */}
          {latest.map(({ s, v }) => (
            <circle key={s} cx={lastX} cy={y(v)} r={3} fill={Math.abs(v) > L ? alert : `rgba(${WARM},${LINE[s].alpha})`} />
          ))}

          {hover && hoverT !== null && (
            <line x1={x(hoverT)} x2={x(hoverT)} y1={TOP - 4} y2={BOTTOM} stroke={`rgba(${WARM},0.5)`} />
          )}
        </svg>
      )}

      {width > 0 &&
        latest.map(({ s, v }, i) => (
          <button
            key={s}
            className={`endLabel ${Math.abs(v) > L ? 'over' : ''}`}
            style={{ left: lastX + 8, top: labelYs[i] - 9 }}
            aria-pressed={s === view}
            onClick={() => onView(s)}
          >
            {STRATEGY[s].short} {signed(v)}
            {s === view && <span className="tag">On canvas</span>}
          </button>
        ))}

      {hover && hoverT !== null && width > 0 && (
        <div className="chartReadout glass" style={{ left: Math.min(x(hoverT) + 10, width - 180), top: TOP }}>
          <b>{clock(hoverT)}</b>
          {STRATEGIES.map((s) => {
            const v = at(s, hoverT);
            return (
              <span key={s} className={v !== null && Math.abs(v) > L ? 'alert' : ''}>
                {STRATEGY[s].short} {v === null ? '' : signed(v)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
