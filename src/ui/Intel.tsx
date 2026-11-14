import { STRATEGIES } from '../sim/types';
import type { BodyId, DeskView, StrategyId } from '../sim/types';
import type { Arena, World } from '../sim/world';
import { BanksChart } from './BanksChart';
import type { TimeMode } from './chartMath';
import { BODY_LABEL, MODE_LABEL, STATE, STRATEGY, signed } from './theme';
import { verdict } from './verdict';

function DeskRow({ d, active, onSelect }: { d: DeskView; active: boolean; onSelect: () => void }) {
  const used = d.budget ? Math.min(1, Math.abs(d.pos) / d.budget) : 0;
  return (
    <button className={`deskRow ${active ? 'active' : ''}`} onClick={onSelect}>
      <span className="who">
        <i className="dot" style={{ background: STATE[d.mode] }} />
        {BODY_LABEL[d.id]}
      </span>
      <span className="mode" style={d.mode === 'normal' ? undefined : { color: STATE[d.mode] }}>
        {d.mode === 'reduce-only' ? 'Playing safe' : MODE_LABEL[d.mode]}
      </span>
      <span className="holds">
        <span className="num">
          {signed(d.pos)}
          {d.budget !== null && <em> of {d.budget}</em>}
        </span>
        {d.budget !== null && (
          <span className="bar">
            <span style={{ width: `${used * 100}%` }} />
          </span>
        )}
      </span>
      <span className="num right">{d.served}</span>
    </button>
  );
}

interface ColumnProps {
  w: World;
  viewing: boolean;
  /** Our bank only: who is making its desks' judgment calls, in the interface's words. */
  runBy?: string;
  selected: BodyId | null;
  onView: () => void;
  onSelect: (b: BodyId) => void;
}

function StrategyColumn({ w, viewing, runBy, selected, onView, onSelect }: ColumnProps) {
  const v = verdict(w);
  const servedPct = Math.round((100 * w.metrics.served) / Math.max(1, w.metrics.arrived));
  return (
    <section className={`column ${viewing ? 'viewing' : ''}`}>
      <div className="colTop">
        <button className="colHead" onClick={onView} aria-pressed={viewing}>
          <span className="name">{STRATEGY[w.strategy].name}</span>
          {/* Agent-run, the line says who decides; on rules it is the bank's one-line description, as before. */}
          {runBy && runBy !== 'Rules' ? (
            <span className="blurb runBy">Run by {runBy.replace(/^Scripted/, 'scripted')}</span>
          ) : (
            <span className="blurb">{STRATEGY[w.strategy].blurb}</span>
          )}
          {viewing && <span className="tag">On canvas</span>}
        </button>
        <span className="profit">Profit {signed(w.pnl(), 2)}</span>
      </div>

      <p className={`verdict ${v.tone}`}>
        <i className="dot" style={{ background: v.tone === 'ok' ? STATE.normal : STATE['reduce-only'] }} />
        {v.text}
      </p>

      <div className="served">
        <span className="label">Customers served</span>
        <span className="bar" role="img" aria-label={`${servedPct}% of customers served`}>
          <span style={{ width: `${servedPct}%` }} />
        </span>
        <b>{servedPct}%</b>
      </div>

      <div className="desks">
        <div className="deskHead">
          <span>Desk</span>
          <span>State</span>
          <span>Holds</span>
          <span className="right">Served</span>
        </div>
        {w.deskViews().map((d) => (
          <DeskRow key={d.id} d={d} active={viewing && selected === d.id} onSelect={() => onSelect(d.id)} />
        ))}
      </div>
    </section>
  );
}

interface IntelProps {
  arena: Arena;
  view: StrategyId;
  selected: BodyId | null;
  mode: TimeMode;
  /** The chart's hover read-out (off in presenter mode). */
  hover: boolean;
  /** Who runs our bank's desks, in the interface's words ("AI agents (live)", "Scripted stand-in", "Rules"). */
  runBy?: string;
  onView: (s: StrategyId) => void;
  onSelect: (s: StrategyId, b: BodyId) => void;
}

/** "The banks": one shared chart of the three banks against the limit, then a column for each. */
export function Intel({ arena, view, selected, mode, hover, runBy, onView, onSelect }: IntelProps) {
  return (
    <div className="banksPanel">
      <BanksChart arena={arena} mode={mode} view={view} onView={onView} hover={hover} />
      <div className="intel">
        {STRATEGIES.map((s) => (
          <StrategyColumn
            key={s}
            w={arena.worlds[s]}
            viewing={s === view}
            runBy={s === 'leased' ? runBy : undefined}
            selected={selected}
            onView={() => onView(s)}
            onSelect={(b) => onSelect(s, b)}
          />
        ))}
      </div>
    </div>
  );
}
