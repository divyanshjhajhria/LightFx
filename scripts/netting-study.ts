// Does netting pay when desks are pushed in opposite directions for a long time?
// `npm run study`. Leased strategy only, netting on vs off, same seeds, no storm, no panic.
import { DEFAULT_CONFIG } from '../src/sim/config';
import { BODIES } from '../src/sim/types';
import { World } from '../src/sim/world';

const FLOW = { earth: 0.65, moon: 0.5, mars: 0.35 };
const MINUTES = 600;
const SEPARATIONS = [0, 60, 150];
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

function run(seed: number, separationDeg: number, netting: boolean) {
  const w = new World({ strategy: 'leased', seed, separationDeg, cfg: { ...DEFAULT_CONFIG, netting, sellProb: FLOW } });
  const ticks = Math.round(MINUTES / w.cfg.dt);
  for (let i = 0; i < ticks; i++) w.step();
  return {
    vol: w.metrics.volFilled,
    gross: BODIES.reduce((s, b) => s + Math.abs(w.desks[b].pos), 0),
    breachMin: w.metrics.breachTicks * w.cfg.dt,
    netted: w.metrics.nettedUnits,
  };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

console.log(
  `Sustained opposite flow (sell probability Earth ${FLOW.earth}, Moon ${FLOW.moon}, Mars ${FLOW.mars}), ` +
    `${MINUTES} minutes, seeds ${SEEDS[0]} to ${SEEDS[SEEDS.length - 1]}, leased strategy.`,
);
const rows: Record<string, Record<string, number | string>> = {};
for (const sep of SEPARATIONS) {
  const on = SEEDS.map((s) => run(s, sep, true));
  const off = SEEDS.map((s) => run(s, sep, false));
  const vOn = mean(on.map((r) => r.vol));
  const vOff = mean(off.map((r) => r.vol));
  rows[`${sep}°`] = {
    'vol on': Number(vOn.toFixed(1)),
    'vol off': Number(vOff.toFixed(1)),
    'change %': Number(((100 * (vOn - vOff)) / vOff).toFixed(2)),
    'on wins': `${on.filter((r, i) => r.vol > off[i].vol).length}/${SEEDS.length}`,
    'gross on': Number(mean(on.map((r) => r.gross)).toFixed(1)),
    'gross off': Number(mean(off.map((r) => r.gross)).toFixed(1)),
    'netted on': Number(mean(on.map((r) => r.netted)).toFixed(1)),
    'breach min on': on.reduce((s, r) => s + r.breachMin, 0),
    'breach min off': off.reduce((s, r) => s + r.breachMin, 0),
  };
}
console.table(rows);
