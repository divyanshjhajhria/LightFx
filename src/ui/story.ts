// One plain sentence per step of a visitor trade's story, for someone who has never traded.
import type { TraceEvent } from '../sim/trace';
import type { BodyId, StrategyId } from '../sim/types';
import { BODY_NAME } from './theme';

/** "Earth", "the Moon", "Mars". */
const name = (b: BodyId) => BODY_NAME[b];
/** The same, at the start of a sentence: "The Moon". */
const Name = (b: BodyId) => name(b).charAt(0).toUpperCase() + name(b).slice(1);

/** Whole minutes, or "moments" under one minute. */
export function minutes(m: number): string {
  if (m < 1) return 'moments';
  const n = Math.round(m);
  return n === 1 ? '1 minute' : `${n} minutes`;
}

/**
 * The sentence for one step of the story, as told by the bank running `strategy`. `asker` is the desk the visitor
 * traded with; it names the desk that never hears when Earth declines.
 */
export function tell(e: TraceEvent, strategy: StrategyId, _now: number, asker?: BodyId): string {
  const B = Name(e.body);
  switch (e.kind) {
    case 'placed':
      return `You asked ${name(e.body)} to ${e.side} ${e.size}.`;

    case 'filled':
      if (strategy === 'central') {
        if (e.waited > 0) return `The answer arrived after ${minutes(e.waited)}. Trade done.`;
        if (e.units < e.of) return `Earth took ${e.units} of your ${e.of}. The bank had no room for more.`;
        return 'Earth is head office, so it said yes straight away.';
      }
      if (strategy === 'naive') {
        return e.units < e.of
          ? `${B} took ${e.units} of your ${e.of}. By its own count the bank had no room for more.`
          : `${B} said yes straight away. As far as it knows, the bank has room.`;
      }
      return e.units < e.of
        ? `${B} took ${e.units} of your ${e.of}. That was all its allowance had room for.`
        : `${B} said yes on its own, straight away. It used ${e.units} of its allowance and has ${e.allowanceLeft ?? 0} left.`;

    case 'refused':
      if (strategy === 'central') return 'Earth said no. The bank is at its limit.';
      if (strategy === 'naive') return `${B} said no. By its own count the bank is at its limit.`;
      return e.reason === 'playing-safe'
        ? `${B} said no. It has heard nothing from the others for an hour, so it is only taking trades that lower its risk.`
        : `${B} said no. Its own allowance is used up, so the bank stays inside its limit.`;

    case 'told':
      return `${B} told ${name(e.to)}. The message lands in ${minutes(e.landsAt - e.t)}.`;

    case 'not-delivered':
      if (strategy === 'central') {
        return e.to === 'earth'
          ? `The request never reached Earth. The link is down, and ${name(e.body)} has no way of knowing.`
          : `Earth's answer never reached ${name(e.to)}. The link is down.`;
      }
      if (strategy === 'naive') {
        return `${B} tried to tell ${name(e.to)}, but the link is down. ${Name(e.to)} is now working from an out-of-date total.`;
      }
      return `${B} tried to tell ${name(e.to)}, but the link is down. It will keep trying.`;

    case 'heard':
      return strategy === 'naive' ? `${B} now knows. Until this moment its total was out of date.` : `${B} now knows.`;

    case 'asked-earth':
      return `${B} cannot decide alone. It has asked Earth, ${minutes(e.landsAt - e.t)} away.`;

    case 'earth-approved':
      return `Earth said yes. The answer is on its way back: ${minutes(e.landsAt - e.t)}.`;

    case 'earth-declined':
      return `Earth said no. The bank is at its limit. ${asker ? Name(asker) : 'The desk that asked'} will never hear.`;

    case 'too-late':
      return `The answer arrived after ${minutes(e.waited)}, but you had already left.`;

    case 'gave-up':
      return `You gave up after ${minutes(e.waited)}.`;
  }
}
