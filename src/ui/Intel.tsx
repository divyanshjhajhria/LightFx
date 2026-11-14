import { STRATEGIES } from '../sim/types';
import type { BodyId, DeskView, StrategyId } from '../sim/types';
import type { Arena, World } from '../sim/world';
import { BODY_LABEL, MODE_LABEL, STATE, STRATEGY, signed } from './theme';

/** Total position over time. The trace turns red wherever it is outside the limit. */
function ExposureChart({ w }: { w: World }) {
  const L = w.cfg.limit;
  const pts = w.history;
  const top = Math.max(L * 1.25, w.metrics.maxAbsTotal * 1.08);
  const y = (v: number) => 32 - (v / top) * 30;
  const t0 = pts.length ? pts[0].t : 0;
  const span = Math.max(1, pts.length ? pts[pts.length - 1].t - t0 : 1);
  const x = (t: number) => ((t - t0) / span) * 300;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.total).toFixed(1)}`).join('');
  const area = pts.length ? `${line}L${x(pts[pts.length - 1].t).toFixed(1)},${y(0)}L0,${y(0)}Z` : '';
  const clip = `over-${w.strategy}`;
  return (
    <svg viewBox="0 0 300 64" className="chart" preserveAspectRatio="none" role="img" aria-label="Total position over time, with the limit marked">
      <defs>
        <clipPath id={clip}>
          <rect x="0" y="0" width="300" height={Math.max(0, y(L))} />
          <rect x="0" y={y(-L)} width="300" height={Math.max(0, 64 - y(-L))} />
        </clipPath>
      </defs>
      <line x1="0" x2="300" y1={y(L)} y2={y(L)} className="limitLine" />
      <line x1="0" x2="300" y1={y(-L)} y2={y(-L)} className="limitLine" />
      <path d={area} className="area" />
      <path d={line} className="trace" />
      <path d={line} className="trace over" clipPath={`url(#${clip})`} />
    </svg>
  );
}

function DeskRow({ d, limit, active, onSelect }: { d: DeskView; limit: number; active: boolean; onSelect: () => void }) {
  const cap = d.budget ?? limit;
  const used = cap > 0 ? Math.min(1, Math.abs(d.pos) / cap) : 1;
  return (
    <button className={`deskRow ${active ? 'active' : ''}`} onClick={onSelect}>
      <span className="who">
        <i className="dot" style={{ background: STATE[d.mode] }} />
        {BODY_LABEL[d.id]}
      </span>
      <span className="mode" style={d.mode === 'normal' ? undefined : { color: STATE[d.mode] }}>
        {MODE_LABEL[d.mode]}
      </span>
      <span className="posCell">
        <span className="num">
          {signed(d.pos)}
          {d.budget !== null && <em> of {d.budget}</em>}
        </span>
        <span className="bar">
          <span style={{ width: `${used * 100}%` }} />
        </span>
      </span>
      <span className="num right">{d.halfSpreadBps === null ? '' : `±${d.halfSpreadBps.toFixed(1)} bp`}</span>
      <span className="num right">{d.volFilled}</span>
    </button>
  );
}

interface ColumnProps {
  w: World;
  viewing: boolean;
  selected: BodyId | null;
  onView: () => void;
  onSelect: (b: BodyId) => void;
}

function StrategyColumn({ w, viewing, selected, onView, onSelect }: ColumnProps) {
  const L = w.cfg.limit;
  const m = w.metrics;
  const total = w.totalPosition();
  const over = Math.abs(total) > L;
  const fill = Math.round((100 * m.volFilled) / Math.max(1, m.volRequested));
  const overMin = m.breachTicks * w.cfg.dt;
  return (
    <section className={`column ${viewing ? 'viewing' : ''}`}>
      <button className="colHead" onClick={onView} aria-pressed={viewing}>
        <span className="name">
          {STRATEGY[w.strategy].name}
          {viewing && <span className="tag">On canvas</span>}
        </span>
        <span className="blurb">{STRATEGY[w.strategy].blurb}</span>
      </button>

      <div className="headline">
        <div className={`exposure ${over ? 'alert' : ''}`}>
          {signed(total)}
          <span>
            of {'±'}
            {L} limit
          </span>
        </div>
        <dl>
          <div className={overMin > 0 || over ? 'alert' : ''}>
            <dt>Over limit</dt>
            {/* Just crossed: say so, rather than "0 min" beside a total that is already red. */}
            <dd>{over && overMin < 1 ? 'now' : `${overMin.toFixed(0)} min`}</dd>
          </div>
          <div>
            <dt>Volume filled</dt>
            <dd>{fill}%</dd>
          </div>
          <div>
            <dt>Profit and loss</dt>
            <dd>{signed(w.pnl(), 2)}</dd>
          </div>
        </dl>
      </div>

      <ExposureChart w={w} />

      <div className="desks">
        <div className="deskHead">
          <span>Desk</span>
          <span>State</span>
          <span>Position</span>
          <span className="right">Spread</span>
          <span className="right">Filled</span>
        </div>
        {w.deskViews().map((d) => (
          <DeskRow key={d.id} d={d} limit={L} active={viewing && selected === d.id} onSelect={() => onSelect(d.id)} />
        ))}
      </div>
    </section>
  );
}

interface IntelProps {
  arena: Arena;
  view: StrategyId;
  selected: BodyId | null;
  onView: (s: StrategyId) => void;
  onSelect: (s: StrategyId, b: BodyId) => void;
}

/** The three strategies as one comparison: same events, same layout, different outcomes. */
export function Intel({ arena, view, selected, onView, onSelect }: IntelProps) {
  return (
    <div className="intel">
      {STRATEGIES.map((s) => (
        <StrategyColumn
          key={s}
          w={arena.worlds[s]}
          viewing={s === view}
          selected={selected}
          onView={() => onView(s)}
          onSelect={(b) => onSelect(s, b)}
        />
      ))}
    </div>
  );
}
