// Headless run of a named scenario: `npm run sim -- <scenarioId> [seed]`.
// Prints one row per strategy each time a note fires and once at the end, then what netting buys the leased bank.
// With no argument, lists the scenario ids.
import { DEFAULT_CONFIG } from '../src/sim/config';
import { runScenario, startScenario } from '../src/sim/scenario';
import { SCENARIOS } from '../src/sim/scenarios';
import { STRATEGIES } from '../src/sim/types';
import type { Arena } from '../src/sim/world';

const id = process.argv[2];
const found = SCENARIOS.find((s) => s.id === id);
if (!found) {
  if (id) console.log(`No scenario called "${id}".\n`);
  console.log('Usage: npm run sim -- <scenarioId> [seed]\n\nScenarios:');
  for (const s of SCENARIOS) console.log(`  ${s.id.padEnd(16)} ${s.name}: ${s.summary}`);
  process.exit(id ? 1 : 0);
}
const scenario = process.argv[3] === undefined ? found : { ...found, seed: Number(process.argv[3]) };

function table(arena: Arena, heading: string): void {
  console.log(`\n${heading}  (t = ${arena.now} min)`);
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
}

console.log(`${scenario.name} (${scenario.id}), seed ${scenario.seed}, ${scenario.durationMin} minutes`);
const run = startScenario(scenario);
let caption = run.director.caption;
if (caption) table(run.arena, caption);
while (!run.director.done) {
  run.arena.step();
  run.director.advance();
  if (run.director.caption !== caption) {
    caption = run.director.caption;
    table(run.arena, caption);
  }
}
table(run.arena, 'End');

// Same scenario and seed with netting switched off, to show what netting buys the leased bank.
const on = run.arena.worlds.leased.metrics;
const offM = runScenario(scenario, scenario.durationMin, { ...DEFAULT_CONFIG, netting: false }).arena.worlds.leased.metrics;
console.log('\nLeased strategy, netting on vs off (same scenario, same seed)');
console.table({
  'netting on': { volFilled: on.volFilled, served: on.served, netted: on.nettedUnits, breachMin: on.breachTicks * DEFAULT_CONFIG.dt },
  'netting off': { volFilled: offM.volFilled, served: offM.served, netted: offM.nettedUnits, breachMin: offM.breachTicks * DEFAULT_CONFIG.dt },
});
