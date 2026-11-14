import type { TraceEvent } from '../sim/trace';
import { STRATEGIES } from '../sim/types';
import type { BodyId, StrategyId } from '../sim/types';
import type { Arena } from '../sim/world';
import { afterTime, inTime, minutes, tell } from './story';
import { BODY_LABEL, BODY_NAME, STRATEGY, clock } from './theme';

export interface FollowedTrade {
  trade: number;
  at: BodyId;
  side: 'buy' | 'sell';
  size: number;
}

/** Messages of this trade still on their way: where to, when sent and when they land. */
function inFlight(tr: readonly TraceEvent[], now: number, asker: BodyId): { to: BodyId; from: number; lands: number }[] {
  const out: { to: BodyId; from: number; lands: number }[] = [];
  tr.forEach((e, i) => {
    let to: BodyId;
    if (e.kind === 'told') to = e.to;
    else if (e.kind === 'asked-earth') to = 'earth';
    else if (e.kind === 'earth-approved') to = asker;
    else return;
    if (e.landsAt <= now) return;
    // A message that was never delivered, or was destroyed on the way, is not on its way anywhere.
    if (tr.slice(i + 1).some((x) => (x.kind === 'not-delivered' || x.kind === 'destroyed') && x.to === to)) return;
    out.push({ to, from: e.t, lands: e.landsAt });
  });
  return out;
}

/** The line that says how the trade ended at this bank, or null while it is still under way. */
function outcome(tr: readonly TraceEvent[], strategy: StrategyId): string | null {
  // Giving up is the visitor's own ending, whatever arrives afterwards.
  const gave = tr.find((e) => e.kind === 'gave-up');
  if (gave?.kind === 'gave-up') return `You gave up ${afterTime(gave.waited)}`;
  for (let i = tr.length - 1; i >= 0; i--) {
    const e = tr[i];
    if (e.kind === 'filled') {
      if (e.waited === 0) return 'Done in 0 minutes';
      return `Done ${afterTime(e.waited)}`;
    }
    if (e.kind === 'refused') return 'Refused';
    if (e.kind === 'gave-up') return `You gave up ${afterTime(e.waited)}`;
    if (e.kind === 'too-late') return 'Too late: you had already left';
  }
  return strategy === 'central' && tr.length ? 'Still waiting' : null;
}

function StoryColumn({
  arena,
  strategy,
  followed,
  viewing,
  onView,
  onGiveUp,
}: {
  arena: Arena;
  strategy: StrategyId;
  followed: FollowedTrade;
  viewing: boolean;
  onView: () => void;
  onGiveUp: () => void;
}) {
  const w = arena.worlds[strategy];
  const now = w.now;
  const tr = w.trace(followed.trade);
  const result = outcome(tr, strategy);
  const waiting = result === 'Still waiting';
  const flights = inFlight(tr, now, followed.at);
  return (
    <section className={`column storyColumn ${viewing ? 'viewing' : ''}`}>
      <button className="colHead" onClick={onView} aria-pressed={viewing}>
        <span className="name">
          {STRATEGY[strategy].name}
          {viewing && <span className="tag">On canvas</span>}
        </span>
        <span className="blurb">{STRATEGY[strategy].blurb}</span>
      </button>
      <div className="steps">
        <ol>
          {tr.map((e, i) => (
            <li key={i}>
              <time>{clock(e.t)}</time>
              <span>{tell(e, strategy, now, followed.at)}</span>
            </li>
          ))}
        </ol>
        {flights.map((f) => (
          <div className="liveRow" key={`${f.to}-${f.from}`}>
            <span>
              On its way to {BODY_NAME[f.to]}: lands {inTime(f.lands - now)}
            </span>
            <span className="bar">
              <span style={{ width: `${Math.min(100, (100 * (now - f.from)) / (f.lands - f.from))}%` }} />
            </span>
          </div>
        ))}
        {waiting && (
          <div className="liveRow waitRow">
            <span>
              Waiting for Earth.{' '}
              {now - tr[0].t < 1 ? 'Less than a minute so far.' : `${minutes(now - tr[0].t)} so far.`}
            </span>
            <button className="quiet" onClick={onGiveUp}>
              Give up waiting
            </button>
          </div>
        )}
        {result && !waiting && <p className="outcome">{result}</p>}
        {waiting && <p className="outcome">Still waiting</p>}
      </div>
    </section>
  );
}

/** "Your trade": one column per bank telling, step by step and in plain words, what the visitor's trade set off. */
export function Story({
  arena,
  followed,
  view,
  onView,
  onDone,
}: {
  arena: Arena;
  followed: FollowedTrade | null;
  view: StrategyId;
  onView: (s: StrategyId) => void;
  onDone: () => void;
}) {
  if (!followed) {
    return <p className="storyEmpty">Click a planet and place a trade to see what happens next.</p>;
  }
  return (
    <div className="story">
      <div className="storyHead">
        <p>
          {followed.side === 'sell'
            ? `You offered to sell ${followed.size} Mars credits to the ${BODY_LABEL[followed.at]} desk.`
            : `You asked to buy ${followed.size} Mars credits from the ${BODY_LABEL[followed.at]} desk.`}
        </p>
        <button className="quiet" onClick={onDone}>
          Done
        </button>
      </div>
      <div className="storyGrid">
        {STRATEGIES.map((s) => (
          <StoryColumn
            key={s}
            arena={arena}
            strategy={s}
            followed={followed}
            viewing={s === view}
            onView={() => onView(s)}
            onGiveUp={() => arena.cancelTrade(followed.trade)}
          />
        ))}
      </div>
    </div>
  );
}
