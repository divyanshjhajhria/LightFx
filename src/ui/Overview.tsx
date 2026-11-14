// "Overview": the default bottom panel. Three bank cards a judge can rank at a glance, and the evidence from the
// survival map. Every figure comes from the simulation or from sweep.json.
import { useEffect, useState } from 'react';
import type { SweepFile } from '../sim/sweep';
import type { TogetherFile } from '../sim/together';
import { Tip } from './Tip';
import { rushFigure } from './togetherFigure';
import { STRATEGIES } from '../sim/types';
import type { StrategyId } from '../sim/types';
import type { Arena } from '../sim/world';
import { gaugeMarker, gaugeTicks } from './gauge';
import { summarise } from './sweepSummary';
import type { SweepSummary } from './sweepSummary';
import { SHORT_NAME, STATE, signed } from './theme';
import { verdict, verdictWord } from './verdict';

/** sweep.json, fetched once per page: a summary, or null when there is no map yet. */
let evidenceCache: Promise<SweepSummary | null> | null = null;
function loadEvidence(): Promise<SweepSummary | null> {
  evidenceCache ??= fetch('sweep.json')
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null))
    .then((d: SweepFile | null) => (d && Array.isArray(d.cells) ? summarise(d) : null))
    .catch(() => null);
  return evidenceCache;
}

/** together.json, fetched once per page, or null when there is none. */
let togetherCache: Promise<TogetherFile | null> | null = null;
function loadTogether(): Promise<TogetherFile | null> {
  togetherCache ??= fetch('together.json')
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null))
    .then((d: TogetherFile | null) => (d && d.overall && d.byMarket ? d : null))
    .catch(() => null);
  return togetherCache;
}

function BankCard({
  arena,
  s,
  viewing,
  chip,
  onView,
}: {
  arena: Arena;
  s: StrategyId;
  viewing: boolean;
  chip: string | null;
  onView: () => void;
}) {
  const w = arena.worlds[s];
  const holds = w.totalPosition();
  const limit = w.cfg.limit;
  const over = Math.abs(holds) > limit;
  const status = verdictWord(w);
  const v = verdict(w);
  const served = Math.round((100 * w.metrics.served) / Math.max(1, w.metrics.arrived));
  const marker = gaugeMarker(holds, limit);
  const [low, zero, high] = gaugeTicks();
  return (
    <button className={`bankCard ${viewing ? 'viewing' : ''}`} aria-pressed={viewing} onClick={onView}>
      <span className="cardTop">
        <span className="cardName">
          {SHORT_NAME[s]}
          {chip && <span className="chip">{chip}</span>}
        </span>
        <span className={`status ${status.tone === 'alert' ? 'alert' : ''}`}>
          <i className="dot" style={{ background: status.tone === 'ok' ? STATE.normal : STATE['reduce-only'] }} />
          {status.word}
        </span>
      </span>
      <span className="cardHolds">
        <b className={over ? 'alert' : ''}>{signed(holds)}</b>
        <span>of ±{limit} limit</span>
      </span>
      <span
        className="gauge"
        role="img"
        aria-label={`Holds ${signed(holds)}, against a limit of ${limit} either way${over ? ', over the limit' : ''}`}
      >
        <i className="out left" style={{ width: `${low * 100}%` }} />
        <i className="in" style={{ left: `${low * 100}%`, width: `${(high - low) * 100}%` }} />
        <i className="out right" style={{ left: `${high * 100}%`, width: `${(1 - high) * 100}%` }} />
        {[low, zero, high].map((t) => (
          <i key={t} className="tick" style={{ left: `${t * 100}%` }} />
        ))}
        <i className={`marker ${over ? 'over' : ''}`} style={{ left: `${marker.at * 100}%` }} />
      </span>
      <span className={`cardVerdict ${v.tone === 'alert' ? 'alert' : ''}`}>{v.text}</span>
      <span className="cardServed">
        Served {served}% of customers
        {viewing && <span className="tag">On canvas</span>}
      </span>
      {s === 'leased' && (
        <span className="cardSharing">
          Sharing: {Math.round(w.allowanceShared())} of allowance handed over, {Math.round(w.metrics.nettedUnits)} cancelled
          between desks
        </span>
      )}
    </button>
  );
}

function Evidence({ onOpenMap }: { onOpenMap: () => void }) {
  const [summary, setSummary] = useState<SweepSummary | null | undefined>(undefined);
  const [together, setTogether] = useState<TogetherFile | null>(null);
  useEffect(() => {
    let live = true;
    void loadEvidence().then((s) => live && setSummary(s));
    void loadTogether().then((t) => live && setTogether(t));
    return () => {
      live = false;
    };
  }, []);
  // Only what was measured, and only when it is worth saying: null leaves the figure off the card.
  const team = together ? rushFigure(together) : null;
  // No map yet: leave the card out entirely.
  if (!summary) return null;
  const f = summary.overall;
  const ours = f.banks.leased.breachedRuns;
  return (
    <section className="evidenceCard" aria-label="The evidence">
      <h3>Tested in {f.runs.toLocaleString('en-GB')} simulated storms</h3>
      <p className="evidenceHero">
        <b className={ours > 0 ? 'alert' : ''}>{ours.toLocaleString('en-GB')}</b>
        <span>times our bank went over its limit</span>
      </p>
      <p className="evidenceFigure">
        <b>{Math.round(f.banks.naive.breachedPct)}%</b>
        <span>of storms, the bank that trusts old news did</span>
      </p>
      {team && (
        <Tip text={team.detail}>
          <p className="evidenceFigure evidenceTeam" tabIndex={0}>
            <b>{team.figure}</b>
            <span>{team.label}</span>
          </p>
        </Tip>
      )}
      <button className="quiet" onClick={onOpenMap}>
        Open the survival map
      </button>
    </section>
  );
}

export function Overview({
  arena,
  view,
  ourChip,
  onView,
  onOpenMap,
}: {
  arena: Arena;
  view: StrategyId;
  /** Who runs our bank's desks, as a chip beside its name; null on rules. */
  ourChip: string | null;
  onView: (s: StrategyId) => void;
  onOpenMap: () => void;
}) {
  return (
    <div className="overview">
      {STRATEGIES.map((s) => (
        <BankCard key={s} arena={arena} s={s} viewing={s === view} chip={s === 'leased' ? ourChip : null} onView={() => onView(s)} />
      ))}
      <Evidence onOpenMap={onOpenMap} />
    </div>
  );
}
