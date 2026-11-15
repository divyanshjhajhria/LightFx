// Build the survival map: `npm run sweep` (40 seeds per cell), `npm run sweep -- --seeds 20`, or `--quick` (3 seeds).
// Writes public/sweep.json with no timestamp, so the same inputs give the same file byte for byte.
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { MARKETS, MARKET_NAME, grid, sweepCell } from '../src/sim/sweep';
import type { CellResult, SweepFile } from '../src/sim/sweep';
import { summarise } from '../src/ui/sweepSummary';

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

// Why customers left with nothing: storm squares, as in the survival map's headline figures.
const summary = summarise(JSON.parse(readFileSync('public/sweep.json', 'utf8')));
const NAME = { leased: 'Our bank', naive: 'Trusts old news', central: 'Asks Earth' } as const;
const row = (label: string, f: (typeof summary)['overall']) => {
  console.log(`\n${label} (${f.runs.toLocaleString('en-GB')} storms): served, price, no room, playing safe, no answer`);
  for (const b of ['leased', 'naive', 'central'] as const) {
    const x = f.banks[b];
    const m = x.missed!;
    console.log(`  ${NAME[b].padEnd(16)} ${[x.servedPct, m.price, m.room, m.safe, m.noAnswer].map((v) => `${v.toFixed(1)}%`.padStart(7)).join('')}`);
  }
};
row('All markets', summary.overall);
for (const m of ['calm', 'panic', 'imbalance'] as const) row(m === 'imbalance' ? 'One-way customers' : m === 'calm' ? 'Calm market' : 'Panic', summary.byMarket[m]);
