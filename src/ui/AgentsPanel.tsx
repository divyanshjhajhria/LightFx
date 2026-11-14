// "The agents": one column per desk of our bank, saying who is deciding, what it last thought and chose, and the notes it
// has received and sent. What became of a sent note is a god-view fact for the viewer; the agent itself is never told.
import type { AgentRunner } from '../agents/runner';
import type { LeasedDesk } from '../sim/desks';
import { BODIES } from '../sim/types';
import type { BodyId } from '../sim/types';
import type { Arena } from '../sim/world';
import { minutes } from './story';
import { BODY_LABEL, BODY_NAME, clock } from './theme';

/** Who is deciding, in the words the interface uses. Only a real model, live or recorded, is ever called AI. */
export interface Decider {
  /** "AI agents (live)", "AI agents (replay)", "Scripted stand-in", "Scripted stand-in (replay)" or "Rules". */
  label: string;
  /** True only for a language model, live or recorded. */
  ai: boolean;
}

/** The chip beside our bank's name: who decides, or nothing when it runs on rules. */
export function runByChip(label: string): string | null {
  if (label === 'Rules') return null;
  return label.replace(/ \((live|replay)\)$/, ', $1');
}

const PRICING = { keen: 'Pricing keenly', steady: 'Pricing steadily', cautious: 'Pricing cautiously' } as const;

const mins = (m: number) => (m < 1 ? 'under a minute' : minutes(m));

function stateWords(r: AgentRunner, body: BodyId, decider: Decider): string {
  const s = r.status(body);
  const who = decider.ai ? 'Model' : 'Stand-in';
  switch (s.state) {
    case 'thinking':
      return 'Thinking';
    case 'decided':
      return `Decided ${Math.max(0, Math.round(s.sinceRealSeconds))} s ago`;
    case 'silent':
      return r.mode === 'replay' ? 'Nothing recorded lately, following rules' : `${who} silent, following rules`;
    case 'rejected':
      return 'Last answer refused';
    default:
      return 'Waiting to decide';
  }
}

function Column({ arena, runner, body, decider }: { arena: Arena; runner: AgentRunner; body: BodyId; decider: Decider }) {
  const w = arena.worlds.leased;
  const desk = w.desks[body] as LeasedDesk;
  const now = arena.now;
  const s = runner.status(body);
  const decided = runner.log().filter((e) => e.body === body && e.directive !== null).length;
  const inControl = desk.agentInControl(now);
  const last = desk.lastDirective();
  const view = w.deskViews().find((v) => v.id === body)!;
  const thought = runner.thought(body);

  const choices: string[] = [];
  if (inControl && last) {
    choices.push(PRICING[last.directive.pricing]);
    for (const p of BODIES) if (last.directive.give[p]) choices.push(`Gave ${last.directive.give[p]} to ${BODY_NAME[p]}`);
    for (const p of BODIES) if (last.directive.ask[p]) choices.push(`Asked ${BODY_NAME[p]} for ${last.directive.ask[p]}`);
  } else {
    choices.push('Following its rules');
  }
  if (view.playingSafeBy === 'choice') choices.push('Playing safe by choice');
  if (view.playingSafeBy === 'rule') choices.push('Playing safe: no word from the others for an hour');

  const inbox = [...desk.inbox()].reverse().slice(0, 2);
  const outbox = w
    .noteLog()
    .filter((n) => n.from === body)
    .slice(-2)
    .reverse();

  return (
    <section className="agentCol">
      <div className="agentHead">
        <h3>{BODY_LABEL[body]}</h3>
        <span className={`agentState ${s.state}`}>{stateWords(runner, body, decider)}</span>
      </div>
      <p className="agentMeta">
        {decider.label.replace('agents', 'agent')}. {decided} {decided === 1 ? 'decision' : 'decisions'}, {s.rejected}{' '}
        {s.rejected === 1 ? 'answer' : 'answers'} refused.
      </p>
      <p className="agentThought">
        {thought ? (
          <>
            <span className="noteMeta">At {clock(runner.thoughtContext(body).at)}: </span>“{thought}”
            {decider.ai && <span className="aiTag"> AI</span>}
          </>
        ) : (
          <span className="muted">No thought to show yet.</span>
        )}
      </p>
      <p className="agentChoices">{choices.join('. ')}.</p>
      <div className="agentNotes">
        <div>
          <h4>Received</h4>
          {inbox.length === 0 && <p className="muted">Nothing yet.</p>}
          {inbox.map((n, i) => (
            <p key={`${n.sentAt}-${n.from}-${i}`}>
              <span className="noteMeta">
                From {BODY_NAME[n.from]}, {mins(n.receivedAt - n.sentAt)} old
              </span>
              {n.text && <span>“{n.text}”</span>}
              {n.asks ? <span>Asks for {n.asks} of this desk's allowance.</span> : null}
            </p>
          ))}
        </div>
        <div>
          <h4>Sent</h4>
          {outbox.length === 0 && <p className="muted">Nothing yet.</p>}
          {outbox.map((n) => (
            <p key={n.id}>
              <span className={`noteMeta ${n.status === 'lost' || n.status === 'destroyed' ? 'alert' : ''}`}>
                To {BODY_NAME[n.to]}:{' '}
                {n.status === 'travelling'
                  ? `on its way, lands in ${mins(Math.max(0, n.landsAt - now))}`
                  : n.status === 'delivered'
                    ? 'delivered'
                    : n.status === 'lost'
                      ? 'lost: link down'
                      : 'destroyed on the way'}
              </span>
              {n.text && <span>“{n.text}”</span>}
              {n.asks ? <span>Asked for {n.asks}.</span> : null}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AgentsPanel({
  arena,
  runner,
  decider,
  onSave,
}: {
  arena: Arena;
  runner: AgentRunner | null;
  decider: Decider;
  /** Download the session; only offered when a live model is deciding. */
  onSave: (() => void) | null;
}) {
  if (!runner || runner.mode === 'off') {
    return (
      <div className="agentsPanel">
        <p className="agentsEmpty">
          Our desks are running on their rules. Choose who runs them under "More", in "Our desks run by".
        </p>
      </div>
    );
  }
  return (
    <div className="agentsPanel">
      <p className="agentsGoal">
        Three agents, one goal: serve as many customers as the bank's limit allows. None can see what the others hold.
      </p>
      <div className="agentsHead">
        <p>
          Each of our desks is run by its own {decider.ai ? 'AI agent' : 'scripted stand-in'}, which sees only what its desk
          knows. Notes travel at light speed on the desks' own messages, and can be lost.
        </p>
        {onSave && (
          <button className="quiet" onClick={onSave}>
            Save this session
          </button>
        )}
      </div>
      <div className="agentsGrid">
        {BODIES.map((b) => (
          <Column key={b} arena={arena} runner={runner} body={b} decider={decider} />
        ))}
      </div>
    </div>
  );
}
