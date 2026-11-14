// What one desk knows, and only that: its own state, what it last heard from its peers, and what it recently did.
// Never the bank's true total or a peer's current position. This is what a desk's voice is built from.
import type { DeskEvent, PeerView } from './deskEvents';
import type { BodyId, Mode, StrategyId } from './types';
import type { World } from './world';

export type { DeskEvent, DeskEventDetail, PeerView } from './deskEvents';

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
  };
}
