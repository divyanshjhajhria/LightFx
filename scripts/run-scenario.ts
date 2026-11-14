// Headless run of the demo scenario: `npm run sim -- [seed] [separationDeg]`.
// Prints one row per strategy so you can tune config.ts without opening the browser.
import { DEFAULT_CONFIG } from '../src/sim/config';
import { Arena } from '../src/sim/world';
import { STRATEGIES } from '../src/sim/types';

const seed = Number(process.argv[2] ?? 42);
const separationDeg = Number(process.argv[3] ?? 150);

/** The demo: calm trading, then a solar storm with a market panic, then the storm ends. */
function runPhases(arena: Arena, after?: (label: string) => void): void {
  arena.run(120);
  after?.('Calm trading');
  arena.setBlackout(true);
  arena.setPanic(true);
  arena.run(180);
  after?.('Solar storm and panic');
  arena.setBlackout(false);
  arena.setPanic(false);
  arena.run(120);
  after?.('After the storm');
}

const arena = new Arena(seed, { separationDeg });
const report = (label: string) => {
  console.log(`\n${label}  (t = ${arena.now} min)`);
  console.table(
    Object.fromEntries(
      STRATEGIES.map((s) => {
        const w = arena.worlds[s];
        const m = w.metrics;
        return [
          s,
          {
            total: w.totalPosition(),
            maxAbs: m.maxAbsTotal,
            breachMin: m.breachTicks * w.cfg.dt,
            'fill%': Math.round((100 * m.volFilled) / Math.max(1, m.volRequested)),
            served: m.served,
            arrived: m.arrived,
            netted: m.nettedUnits,
            pnl: Number(w.pnl().toFixed(3)),
            dropped: m.dropped,
          },
        ];
      }),
    ),
  );
};

runPhases(arena, report);

// Same seed and phases with netting switched off, to show what netting buys the leased bank.
const off = new Arena(seed, { separationDeg, cfg: { ...DEFAULT_CONFIG, netting: false } });
runPhases(off);
const on = arena.worlds.leased.metrics;
const offM = off.worlds.leased.metrics;
console.log('\nLeased strategy, netting on vs off (same seed, same phases)');
console.table({
  'netting on': { volFilled: on.volFilled, served: on.served, netted: on.nettedUnits, breachMin: on.breachTicks * DEFAULT_CONFIG.dt },
  'netting off': { volFilled: offM.volFilled, served: offM.served, netted: offM.nettedUnits, breachMin: offM.breachTicks * DEFAULT_CONFIG.dt },
});
