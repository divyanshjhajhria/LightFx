import { describe, expect, it } from 'vitest';
import { runScenario, startScenario } from '../src/sim/scenario';
import { SCENARIOS } from '../src/sim/scenarios';
import { STRATEGIES } from '../src/sim/types';
import { Arena } from '../src/sim/world';

const storm = SCENARIOS.find((s) => s.id === 'solar-storm')!;

describe('storm and panic spans', () => {
  it('open and close at the minutes the solar-storm script flips them, in every bank', () => {
    const run = startScenario(storm);
    while (run.arena.now < 200) {
      run.arena.step();
      run.director.advance();
    }
    for (const s of STRATEGIES) {
      expect(run.arena.worlds[s].spans).toEqual([
        { kind: 'storm', from: 120, to: null },
        { kind: 'panic', from: 120, to: null },
      ]);
    }
    while (run.arena.now < storm.durationMin) {
      run.arena.step();
      run.director.advance();
    }
    expect(run.arena.worlds.leased.spans).toEqual([
      { kind: 'storm', from: 120, to: 300 },
      { kind: 'panic', from: 120, to: 300 },
    ]);
  });

  it('come out the same after a jump on the timeline', () => {
    const jumped = runScenario(storm, 330).arena.worlds.naive.spans;
    const played = startScenario(storm);
    while (played.arena.now < 330) {
      played.arena.step();
      played.director.advance();
    }
    expect(jumped).toEqual(played.arena.worlds.naive.spans);
  });

  it('keep the history at the true total, the figure the breach count uses', () => {
    const { arena } = runScenario(storm, 200);
    const w = arena.worlds.naive;
    expect(w.history.at(-1)!.total).toBe(w.totalPosition());
  });
});

describe('trade marks', () => {
  it('give where and when the last ten visitor trades were placed', () => {
    const a = new Arena(3, { separationDeg: 60 });
    for (let i = 0; i < 12; i++) {
      a.run(5);
      a.placeTrade(i % 2 ? 'earth' : 'mars', 'sell', 1);
    }
    const marks = a.tradeMarks();
    expect(marks).toHaveLength(10);
    expect(marks[0]).toEqual({ t: 15, body: 'mars' });
    expect(marks.at(-1)).toEqual({ t: 60, body: 'earth' });
  });
});
