// Plain-words descriptions of messages in flight, for the hover tooltip on the canvas.
import type { Envelope, StrategyId } from '../sim/types';
import { BODY_LABEL, BODY_NAME, clock, signed } from './theme';

export interface Description {
  title: string;
  lines: string[];
}

/** Minutes to one decimal place, as on the canvas. */
const mins = (m: number) => `${Math.max(0, m).toFixed(1)} min`;

/**
 * Describe a message for someone who has never traded. `strategy` says which bank sent it; when it is omitted, a desk
 * update carrying netting state is taken to be ours (leased) and any other desk update to be naive.
 */
export function describeEnvelope(env: Envelope, now: number, strategy?: StrategyId): Description {
  const p = env.payload;
  const from = BODY_LABEL[env.from];
  const to = BODY_LABEL[env.to];
  const toName = BODY_NAME[env.to];
  let title: string;
  const lines: string[] = [];

  switch (p.kind) {
    case 'news':
      title = `Price news from ${BODY_NAME[p.origin]}`;
      lines.push(`The latest move in ${BODY_NAME[p.origin]}'s market`);
      break;
    case 'gossip': {
      title = `${from} to ${to}: desk update`;
      lines.push(`${from} holds ${signed(p.pos)}`);
      const leased = strategy ? strategy === 'leased' : p.netting !== undefined;
      if (leased) {
        lines.push(`Spare allowance: ${Math.max(0, Math.floor(p.free))}`);
        if (p.openOffer) lines.push(`Offers to take up to ${p.openOffer} off ${toName}'s hands`);
        if (p.handover) lines.push(`Hands ${p.handover} to ${toName}`);
      }
      if (p.note) lines.push(`Note for ${toName}: "${p.note}"`);
      if (p.asks) lines.push(`Asks ${toName} for ${p.asks} of its allowance`);
      break;
    }
    case 'rfq':
      title = `${from} to ${to}: asking permission`;
      lines.push(`A customer wants to ${p.delta > 0 ? 'sell' : 'buy'} ${Math.abs(p.delta)}. May I?`);
      break;
    case 'approve':
      title = `${from} to ${to}: permission granted`;
      lines.push('Go ahead with the trade');
      break;
    case 'confirm':
      title = `${from} to ${to}: report back`;
      lines.push(p.filled ? 'Trade done' : 'The customer had already left');
      break;
  }

  lines.push(`Sent ${clock(env.sentAt)}, lands ${clock(env.deliverAt)}, in ${mins(env.deliverAt - now)}`);
  return { title, lines };
}
