// Build the survival map: `npm run sweep` (40 seeds per cell), `npm run sweep -- --seeds 20`, or `--quick` (3 seeds).
// Writes public/sweep.json with no timestamp, so the same inputs give the same file byte for byte.
import { writeFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { MARKETS, MARKET_NAME, grid, sweepCell } from '../src/sim/sweep';
import type { CellResult, SweepFile } from '../src/sim/sweep';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const seedsPerCell = args.includes('--quick') ? 3 : Number(flag('--seeds') ?? 40);
const seeds = Array.from({ length: seedsPerCell }, (_, i) => i + 1);

const started = Date.now();
const cells: CellResult[] = [];
for (const market of MARKETS) {
  const t = Date.now();
  const mine = grid().filter((c) => c.market === market);
  for (const c of mine) cells.push(sweepCell(c, seeds));
  console.log(`${MARKET_NAME[market]}: ${mine.length} cells x ${seedsPerCell} seeds in ${((Date.now() - t) / 1000).toFixed(1)} s`);
}

const file: SweepFile = {
  limit: DEFAULT_CONFIG.limit,
  seedsPerCell,
  totalRuns: cells.reduce((s, c) => s + c.runs, 0),
  totalTicks: cells.reduce((s, c) => s + c.ticks, 0),
  cells,
};
writeFileSync('public/sweep.json', `${JSON.stringify(file)}\n`);
console.log(
  `${file.totalRuns} runs, ${(file.totalTicks / 1e6).toFixed(1)} million simulated steps, ` +
    `${((Date.now() - started) / 1000).toFixed(1)} s. Wrote public/sweep.json.`,
);
