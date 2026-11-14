// npm run together: our bank together against alone, same storms and seeds, into public/together.json.
import { writeFileSync } from 'node:fs';
import { RUSH_MARKETS, TOGETHER_SEPARATIONS, TOGETHER_STORMS, measureTogether, pairsFor, rushG, rushMeans } from '../src/sim/together';

const t0 = Date.now();
const r = measureTogether();
const rush = r.rush!.squares;
const over =
  r.squares.reduce((s, q) => s + q.together.runsOver + q.alone.runsOver, 0) +
  rush.reduce((s, q) => s + q.perSeed.filter((p) => p.together.over || p.alone.over).length, 0);
if (over > 0) {
  console.error(`STOP: ${over} runs went over the limit. Nothing written.`);
  process.exit(1);
}
writeFileSync('public/together.json', `${JSON.stringify(r)}\n`);
const o = r.overall;
console.log(
  `${r.squares.length + rush.length} squares x ${r.seeds.length} seeds in ${((Date.now() - t0) / 1000).toFixed(1)} s. ` +
    `Even demand: together ${o.together.servedPct.toFixed(2)}%, alone ${o.alone.servedPct.toFixed(2)}%, ` +
    `gain ${o.gainPoints.toFixed(2)} points (${o.gainRelativePct.toFixed(2)}%), together served more in ${o.togetherServedMore}/${o.runs}.`,
);

const HELD_OUT = Array.from({ length: 20 }, (_, i) => i + 11);
const CHOOSING = Array.from({ length: 10 }, (_, i) => i + 1);
const f2 = (x: number) => x.toFixed(2);
console.log('\nA rush at one desk, seeds 11 to 30 (customers served, percent; at the rushed desk during the rush, and overall):');
console.log('market      Mars   storm | rushed desk: together  alone   gain | overall: together  alone   gain | shared cancelled | rush wins');
for (const m of RUSH_MARKETS) {
  for (const sep of TOGETHER_SEPARATIONS) {
    for (const storm of TOGETHER_STORMS) {
      const q = rush.find((x) => x.market === m && x.separationDeg === sep && x.stormMinutes === storm)!;
      const s = rushMeans(pairsFor([q], HELD_OUT));
      console.log(
        `${m.padEnd(11)} ${q.delayMin.toFixed(1).padStart(4)} ${String(storm).padStart(6)} | ` +
          `${f2(s.rushTogether).padStart(20)} ${f2(s.rushAlone).padStart(6)} ${f2(s.rushTogether - s.rushAlone).padStart(6)} | ` +
          `${f2(s.servedTogether).padStart(16)} ${f2(s.servedAlone).padStart(6)} ${f2(s.servedTogether - s.servedAlone).padStart(6)} | ` +
          `${s.shared.toFixed(1).padStart(6)} ${s.cancelled.toFixed(1).padStart(9)} | ${s.rushWins}/${s.runs}`,
      );
    }
  }
}
console.log(`\nG (rushed desk, no-storm squares of both rush markets): seeds 1 to 10 ${f2(rushG(rush, CHOOSING))} points; seeds 11 to 30 ${f2(rushG(rush, HELD_OUT))} points.`);
