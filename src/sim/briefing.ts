// What one desk knows, and only that: its own state, what it last heard from its peers, and what it recently did.
// Never the bank's true total or a peer's current position. This is what a desk's voice is built from.
import type { DeskEvent, PeerView } from './deskEvents';
import { LeasedDesk } from './desks';
import type { Caution, Pricing } from './directive';
import type { BodyId, Mode, StrategyId } from './types';
import type { World } from './world';

export type { DeskEvent, DeskEventDetail, InboxItem, PeerView } from './deskEvents';

/** A note or ask as the receiving agent sees it. */
export interface BriefingNote {
  from: BodyId;
  text: string;
  asks: number | null;
  /** How old it was when it arrived (the light delay), and how long ago that was. */
  oldOnArrivalMin: number;
  receivedMinAgo: number;
}

export interface DeskBriefing {
  body: BodyId;
  strategy: StrategyId;
  now: number;
  mode: Mode;
  /** Its own position. */
  holds: number;
  /** Null for strategies without an allowance. */
  allowance: number | null;
  allowanceSpare: number | null;
  bid: number | null;
  ask: number | null;
  localPrice: number;
  /** Age of the stalest price news from elsewhere, in minutes. */
  remoteNewsAgeMin: number;
  peers: PeerView[];
  thinksBankHolds: { low: number; high: number } | null;
  /** The bank's limit. Every desk is told it; the naive and central desks trade against it. */
  limit: number;
  /** Leased only: minutes until it starts playing safe if it hears nothing more. */
  minutesUntilPlayingSafe: number | null;
  /** Central remote desks: customers waiting on Earth. */
  waitingOnEarth: number | null;
  /** Newest last, at most 6. */
  recent: DeskEvent[];
  // The fields below are always filled in by deskBriefing(); they are optional only so older hand-made briefings type.
  /** Notes and asks received, newest first (at most 5). Empty for desks no agent runs. */
  inbox?: BriefingNote[];
  /** This desk's own previous decision, or null if it has made none. */
  lastDirective?: {
    pricing: Pricing;
    caution: Caution;
    gave: Partial<Record<BodyId, number>>;
    thought: string;
    minAgo: number;
  } | null;
  /** Each peer's spare allowance as last reported, with how old that report is. Empty for strategies without one. */
  spareByLastWord?: { body: BodyId; spare: number | null; ageMin: number | null }[];
}

export function deskBriefing(world: World, body: BodyId): DeskBriefing {
  const d = world.desks[body];
  const now = world.now;
  const view = world.deskViews().find((v) => v.id === body)!;
  const heard = d.heardAgo(now);
  return {
    body,
    strategy: world.strategy,
    now,
    mode: d.mode(now),
    holds: d.pos,
    allowance: d.budget(),
    allowanceSpare: d.spare(),
    bid: view.bid,
    ask: view.ask,
    localPrice: world.fair(body),
    remoteNewsAgeMin: world.newsAge(body),
    peers: d.peerView(now),
    thinksBankHolds: d.believedTotal(),
    limit: world.cfg.limit,
    minutesUntilPlayingSafe: world.strategy === 'leased' && heard !== null ? Math.max(0, world.cfg.leaseDuration - heard) : null,
    waitingOnEarth: d.waitingCount(now),
    recent: world.events(body).map((e) => ({ ...e })),
    inbox:
      d instanceof LeasedDesk
        ? [...d.inbox()].reverse().map((n) => ({
            from: n.from,
            text: n.text,
            asks: n.asks,
            oldOnArrivalMin: n.receivedAt - n.sentAt,
            receivedMinAgo: now - n.receivedAt,
          }))
        : [],
    lastDirective: (() => {
      const last = d instanceof LeasedDesk ? d.lastDirective() : null;
      if (!last) return null;
      const x = last.directive;
      return { pricing: x.pricing, caution: x.caution, gave: { ...x.give }, thought: x.thought, minAgo: now - last.at };
    })(),
    spareByLastWord: d instanceof LeasedDesk ? d.peerSpare(now) : [],
  };
}
