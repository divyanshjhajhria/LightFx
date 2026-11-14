// Headless run of the demo scenario: `npm run sim -- [seed] [separationDeg]`.
// Prints one row per strategy so you can tune config.ts without opening the browser.
import { Arena } from '../src/sim/world';
import { STRATEGIES } from '../src/sim/types';

const seed = Number(process.argv[2] ?? 42);
const separationDeg = Number(process.argv[3] ?? 150);

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
            pnl: Number(w.pnl().toFixed(3)),
            dropped: m.dropped,
          },
        ];
      }),
    ),
  );
};

arena.run(120);
report('Calm trading');
arena.setBlackout(true);
arena.setPanic(true);
arena.run(180);
report('Solar storm and panic');
arena.setBlackout(false);
arena.setPanic(false);
arena.run(120);
report('After the storm');
