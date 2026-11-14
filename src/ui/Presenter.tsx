// The guided demo's on-screen pieces: the caption bar, the presenter's hint, and the results card.
import type { Guide } from '../sim/guide';
import type { TraceEvent } from '../sim/trace';
import type { BodyId } from '../sim/types';
import type { Arena } from '../sim/world';
import { afterTime, waitedFor } from './story';

/**
 * How the visitor's order ended at the bank that asks Earth, as one or two sentences, from whatever its story actually
 * holds. Covers every way a central story can go: filled (at once or after a wait), refused, declined, lost on the way
 * there or back, too late, gave up, left when patience ran out, or still waiting.
 */
export function centralOutcome(tr: readonly TraceEvent[], asker: BodyId): string {
  const has = (k: TraceEvent['kind'], to?: BodyId) =>
    tr.some((e) => e.kind === k && (to === undefined || ('to' in e && e.to === to)));
  const filled = tr.find((e) => e.kind === 'filled');
  if (filled?.kind === 'filled') {
    const when = filled.waited === 0 ? 'straight away' : afterTime(filled.waited);
    return filled.units < filled.of
      ? `Your order was part-filled ${when}: ${filled.units} of ${filled.of}.`
      : `Your order was filled ${when}.`;
  }
  if (has('refused')) return 'Your order was refused: the bank was at its limit.';

  let how: string;
  if (has('destroyed', 'earth') || has('not-delivered', 'earth')) how = 'Your order never reached head office';
  else if (has('earth-declined')) how = `Your order was declined by head office, and ${asker === 'moon' ? 'the Moon' : 'Mars'} never heard`;
  else if (has('earth-approved') && (has('destroyed', asker) || has('not-delivered', asker))) {
    how = "Your order was approved, but head office's answer was lost on the way back";
  } else if (has('earth-approved')) how = 'Your order was approved by head office';
  else how = 'Your order is on its way to head office';

  const late = tr.find((e) => e.kind === 'too-late');
  const gave = tr.find((e) => e.kind === 'gave-up');
  const left =
    gave?.kind === 'gave-up' ? (gave.patience ? `you left after ${waitedFor(gave.waited)}` : `you gave up ${afterTime(gave.waited)}`) : '';
  if (gave && late?.kind === 'too-late') return `${how}; ${left}, and the answer came after you had gone.`;
  if (late?.kind === 'too-late') return `${how}, but the answer came ${afterTime(late.waited)}, after you had left.`;
  if (gave) return `${how}, and ${left}.`;
  return `${how}. You are still waiting.`;
}

export function CaptionBar({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="captionBar glass" aria-live="polite">
      {text}
    </div>
  );
}

/** Bottom right: what the next press does, progress through the beats, and the other keys. */
export function PresenterHint({ guide, muted }: { guide: Guide; muted: boolean }) {
  const b = guide.beat;
  const pressPlacesTrade = guide.index === 0 && guide.trade === null;
  const ready = guide.canAdvance && (b.advance === 'space' || pressPlacesTrade);
  let next: string;
  if (pressPlacesTrade) next = 'sell 5 for the visitor';
  else if (b.advance !== 'space') next = 'wait for the message';
  else next = guide.nextLabel ?? 'Finish';
  return (
    <div className="presenterHint" aria-label="Presenter keys">
      <p className={ready ? '' : 'waiting'}>
        <kbd>Space</kbd> then: {next}
      </p>
      <p className="dots" aria-label={`Step ${guide.index + 1} of ${guide.beats.length}`}>
        {guide.beats.map((x, i) => (
          <i key={x.id} className={i < guide.index ? 'done' : i === guide.index ? 'now' : ''} />
        ))}
      </p>
      <p>{muted ? 'Muted. M to unmute' : 'M to mute'}, Esc to leave</p>
    </div>
  );
}

export interface Results {
  ours: { overMin: number; served: number };
  naive: { overMin: number };
  central: { outcome: string; marsServedInStorm: number };
}

/** Read the results off the simulation at the end of the demo. Nothing here is fixed text. */
export function readResults(arena: Arena, trade: number | null, marsServedInStorm: number): Results {
  const { leased, naive, central } = arena.worlds;
  const dt = leased.cfg.dt;
  const ct = trade === null ? [] : central.trace(trade);
  const asker = ct[0]?.body ?? 'mars';
  return {
    ours: { overMin: leased.metrics.breachTicks * dt, served: leased.metrics.served },
    naive: { overMin: naive.metrics.breachTicks * dt },
    central: { outcome: ct.length ? centralOutcome(ct, asker) : 'No order was placed.', marsServedInStorm },
  };
}

const mins = (m: number) => `${Number.isInteger(m) ? m : m.toFixed(1)} ${m === 1 ? 'minute' : 'minutes'}`;

export function ResultsCard({ r }: { r: Results }) {
  return (
    <div className="resultsCard glass" role="dialog" aria-label="Results">
      <dl>
        <div>
          <dt>Our bank</dt>
          <dd>
            <span className={r.ours.overMin > 0 ? 'alert' : ''}>{mins(r.ours.overMin)} over its limit.</span>{' '}
            {r.ours.served} customers served.
          </dd>
        </div>
        <div>
          <dt>The bank that trusts old news</dt>
          <dd>
            <span className={r.naive.overMin > 0 ? 'alert' : ''}>{mins(r.naive.overMin)} over its limit.</span>
          </dd>
        </div>
        <div>
          <dt>The bank that asks Earth</dt>
          <dd>
            {r.central.outcome} Mars office served {r.central.marsServedInStorm}{' '}
            {r.central.marsServedInStorm === 1 ? 'customer' : 'customers'} during the storm.
          </dd>
        </div>
      </dl>
      <p>Space to run it again. Esc to explore on your own.</p>
    </div>
  );
}
