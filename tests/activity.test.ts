import { describe, expect, it } from 'vitest';
import { startScenario } from '../src/sim/scenario';
import { SCENARIOS } from '../src/sim/scenarios';
import { Arena } from '../src/sim/world';
import { activity, isSharingLine } from '../src/ui/activity';
import type { ActivityLine } from '../src/ui/activity';

/** Play 'solar-storm' on seed 42, collecting every line the feed ever shows for our bank. */
function solarStorm(trade?: { at: number }) {
  const s = SCENARIOS.find((x) => x.id === 'solar-storm')!;
  const { arena, director } = startScenario(s);
  const seen = new Map<string, ActivityLine>();
  while (arena.now < s.durationMin) {
    arena.step();
    director.advance();
    if (trade && Math.abs(arena.now - trade.at) < 1e-9) arena.placeTrade('mars', 'sell', 5);
    for (const l of activity(arena, 'leased')) seen.set(`${l.t} ${l.text}`, l);
  }
  return { arena, lines: [...seen.values()].sort((x, y) => x.t - y.t) };
}

describe('the activity feed', () => {
  it("tells 'solar-storm' on seed 42 in order, each at the right minute", () => {
    const { arena, lines } = solarStorm();
    const find = (text: string) => lines.find((l) => l.text === text);
    const storm = find('Solar storm. Every link between the planets is down.')!;
    const safe = find('Mars starts playing safe.')!;
    const over = find('The bank that trusts old news goes over its limit.')!;
    const passes = find('The storm passes. Links are back.')!;
    expect(storm).toEqual({ t: 120, text: 'Solar storm. Every link between the planets is down.', tone: 'alert' });
    expect(passes).toEqual({ t: 300, text: 'The storm passes. Links are back.', tone: 'plain' });
    expect(over.tone).toBe('alert');
    // Mars plays safe when its newest word from anyone is an hour old: at the minute the simulation itself recorded.
    const modeChange = arena.worlds.leased.feedLog('mars').find((e) => e.kind === 'mode' && e.to === 'reduce-only')!;
    expect(safe.t).toBe(modeChange.t);
    // An hour after the last word Mars received was sent (about 20 minutes before it arrived), so under an hour in.
    expect(safe.t).toBeGreaterThan(140);
    expect(safe.t).toBeLessThanOrEqual(180);
    // The old-news bank goes over at the first minute its history is past the limit.
    const naive = arena.worlds.naive;
    expect(over.t).toBe(naive.history.find((h) => Math.abs(h.total) > naive.cfg.limit)!.t);
    const order = [storm, safe, over, passes].map((l) => lines.indexOf(l));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(storm.t < safe.t && safe.t <= over.t && over.t < passes.t).toBe(true);
    // Our bank never goes over, so the feed never says it does.
    expect(lines.some((l) => l.text === 'Our bank goes over its limit.')).toBe(false);
  });

  it('shows a visitor trade, worded from the trade itself', () => {
    const { lines } = solarStorm({ at: 30 });
    expect(lines.find((l) => l.t === 30 && l.text.startsWith('You'))).toEqual({
      t: 30,
      text: 'You offered to sell 5 to Mars.',
      tone: 'plain',
    });
    const a = new Arena(3);
    a.run(10);
    a.placeTrade('moon', 'buy', 7);
    expect(activity(a, 'leased').at(-1)!.text).toBe('You asked to buy 7 from the Moon.');
  });

  it('says when the storm and the panic end, and nothing on an untouched run', () => {
    const a = new Arena(9);
    a.run(30);
    // Step 12: desks share allowance from the first minute on their own; those lines alone are not "something happened".
    const others = () => activity(a, 'leased').filter((l) => !isSharingLine(l.text));
    expect(others()).toEqual([]);
    a.setPanic(true);
    a.run(10);
    a.setPanic(false);
    a.run(1);
    expect(others().map((l) => l.text)).toEqual(['Market panic. Customers everywhere are selling.', 'The panic ends.']);
  });
});
