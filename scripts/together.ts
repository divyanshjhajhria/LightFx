// npm run together: our bank together against alone, same storms and seeds, into public/together.json.
import { writeFileSync } from 'node:fs';
import { measureTogether } from '../src/sim/together';

const t0 = Date.now();
const r = measureTogether();
const over = r.squares.reduce((s, q) => s + q.together.runsOver + q.alone.runsOver, 0);
if (over > 0) {
  console.error(`STOP: ${over} runs went over the limit. Nothing written.`);
  process.exit(1);
}
writeFileSync('public/together.json', `${JSON.stringify(r)}\n`);
const o = r.overall;
console.log(
  `${r.squares.length} squares x ${r.seeds.length} seeds in ${((Date.now() - t0) / 1000).toFixed(1)} s. ` +
    `Served: together ${o.together.servedPct.toFixed(2)}%, alone ${o.alone.servedPct.toFixed(2)}%, ` +
    `gain ${o.gainPoints.toFixed(2)} points (${o.gainRelativePct.toFixed(2)}%), together served more in ${o.togetherServedMore}/${o.runs}.`,
);
