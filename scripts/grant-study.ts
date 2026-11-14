// npm run grants: can desks lend room faster to a swamped desk without serving fewer customers elsewhere?
// Eight lending settings, chosen on seeds 1 to 10, judged on seeds 11 to 30, by the rules written below. Writes
// docs/rush.md (every figure in it is computed here) and prints the decision. Stops if anyone goes over the limit.
import { writeFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/sim/config';
import type { SimConfig } from '../src/sim/config';
import { RUSH } from '../src/sim/scenario';
import { RUSH_MARKETS, TOGETHER_MARKETS, TOGETHER_SEPARATIONS, TOGETHER_STORMS, measurePairs, rushMeans } from '../src/sim/together';
import type { SeedPair, Square, TogetherMarket } from '../src/sim/together';

const CHOOSING = Array.from({ length: 10 }, (_, i) => i + 1);
const HELD_OUT = Array.from({ length: 20 }, (_, i) => i + 11);
const MARKETS: TogetherMarket[] = [...TOGETHER_MARKETS, ...RUSH_MARKETS];
const GRID: Square[] = MARKETS.flatMap((market) =>
  TOGETHER_SEPARATIONS.flatMap((separationDeg) => TOGETHER_STORMS.map((stormMinutes) => ({ market, separationDeg, stormMinutes }))),
);

interface Setting {
  grantShare: number;
  grantThreshold: number;
  grantWaitFactor: number;
}
const TODAY: Setting = { grantShare: DEFAULT_CONFIG.grantShare, grantThreshold: DEFAULT_CONFIG.grantThreshold, grantWaitFactor: DEFAULT_CONFIG.grantWaitFactor };
const CANDIDATES: Setting[] = [0.25, 0.5].flatMap((grantShare) =>
  [10, 4].flatMap((grantThreshold) => [2.5, 1.2].map((grantWaitFactor) => ({ grantShare, grantThreshold, grantWaitFactor }))),
);
const same = (a: Setting, b: Setting) =>
  a.grantShare === b.grantShare && a.grantThreshold === b.grantThreshold && a.grantWaitFactor === b.grantWaitFactor;
const label = (s: Setting) => `share ${s.grantShare}, threshold ${s.grantThreshold}, wait ${s.grantWaitFactor}${same(s, TODAY) ? ' (today)' : ''}`;

interface Score {
  setting: Setting;
  /** Customers served overall, percent, our bank together, per market and over all markets. */
  served: Record<string, number>;
  servedAll: number;
  /** Points more customers served at the rushed desk during the rush, together minus alone, no-storm rush squares. */
  G: number;
  over: number;
}

function score(setting: Setting, seeds: number[]): Score {
  const cfg: SimConfig = { ...DEFAULT_CONFIG, ...setting };
  const perSquare = GRID.map((sq) => ({ sq, pairs: measurePairs(sq, seeds, cfg) }));
  const pairsWhere = (f: (sq: Square) => boolean): SeedPair[] => perSquare.filter((x) => f(x.sq)).flatMap((x) => x.pairs);
  const served: Record<string, number> = {};
  for (const m of MARKETS) served[m] = rushMeans(pairsWhere((sq) => sq.market === m)).servedTogether;
  const all = rushMeans(pairsWhere(() => true));
  const g = rushMeans(pairsWhere((sq) => (RUSH_MARKETS as readonly string[]).includes(sq.market) && sq.stormMinutes === 0));
  return {
    setting,
    served,
    servedAll: all.servedTogether,
    G: g.rushTogether - g.rushAlone,
    over: all.over,
  };
}

const stopIfOver = (s: Score) => {
  if (s.over > 0) {
    console.error(`STOP: ${s.over} runs went over the limit with ${label(s.setting)}. Nothing written.`);
    process.exit(1);
  }
};

const scores = CANDIDATES.map((c) => score(c, CHOOSING));
scores.forEach(stopIfOver);
const today = scores.find((s) => same(s.setting, TODAY))!;
const worstFall = (s: Score, base: Score) => Math.min(...MARKETS.map((m) => s.served[m] - base.served[m]));
const eligible = scores.filter((s) => worstFall(s, today) >= -0.5);
const chosen = [...eligible].sort((a, b) => b.G - a.G)[0];

const heldToday = score(TODAY, HELD_OUT);
stopIfOver(heldToday);
const heldChosen = same(chosen.setting, TODAY) ? heldToday : score(chosen.setting, HELD_OUT);
stopIfOver(heldChosen);
const gGain = heldChosen.G - heldToday.G;
const heldFall = worstFall(heldChosen, heldToday);
const adopt = !same(chosen.setting, TODAY) && gGain >= 3 && heldFall >= -0.5;

const f2 = (x: number) => x.toFixed(2);
const sign = (x: number) => (x > 0 ? `+${f2(x)}` : f2(x));
const marketName: Record<string, string> = {
  calm: 'Calm',
  panic: 'Panic',
  imbalance: 'One-way',
  'rush-mars': 'Rush at Mars',
  'rush-earth': 'Rush at Earth',
};

// ---- The rush table under today's settings, on the held-out seeds -------------------------------------------------
const rushRows: string[] = [];
for (const m of RUSH_MARKETS) {
  for (const sep of TOGETHER_SEPARATIONS) {
    for (const storm of TOGETHER_STORMS) {
      const s = rushMeans(measurePairs({ market: m, separationDeg: sep, stormMinutes: storm }, HELD_OUT, DEFAULT_CONFIG));
      rushRows.push(
        `| ${marketName[m]} | ${sep === 0 ? 'close' : 'far side'} | ${storm === 0 ? 'none' : `${storm / 60} h`} | ` +
          `${f2(s.rushTogether)}% | ${f2(s.rushAlone)}% | ${sign(s.rushTogether - s.rushAlone)} | ` +
          `${f2(s.servedTogether)}% | ${f2(s.servedAlone)}% | ${sign(s.servedTogether - s.servedAlone)} | ${s.rushWins} of ${s.runs} |`,
      );
    }
  }
}

const md = `# A rush at one desk

Generated by \`npm run grants\` (scripts/grant-study.ts). Every figure here is computed by that script; do not edit by
hand.

## What a rush is

From minute ${RUSH.from} to minute ${RUSH.to}, one desk gets ${RUSH.times} times its usual customers, and ${Math.round(
  RUSH.sellProb * 100,
)}% of them sell Mars credits; the other two desks carry on as usual. It is layered on a calm market, on the same grid as
the rest of the together-against-alone study: Mars close (separation 0) or on the far side (150); no storm, or a storm of
2 or 6 hours that also starts at minute ${RUSH.from}, so with a storm the rush happens while the links are down.

"Together" is our bank as it runs: desks share spare allowance and cancel opposite positions. "Alone" is the same bank
with neither: each desk keeps its starting allowance. Both are safe by construction; no run went over the limit.

## Together against alone, today's settings, seeds 11 to 30

Customers served at the rushed desk during the rush, and overall, in percent.

| Rush | Mars | Storm | Rushed desk, together | Alone | Gain (points) | Overall, together | Alone | Gain (points) | Together better at the rushed desk |
|---|---|---|---|---|---|---|---|---|---|
${rushRows.join('\n')}

G is the gain at the rushed desk averaged over the no-storm squares of both rush markets: ${f2(today.G)} points on
seeds 1 to 10 and ${f2(heldToday.G)} points on seeds 11 to 30, with today's settings.

## Lending faster: eight settings, seeds 1 to 10

Today a desk hands a peer a quarter of the difference in spare allowance (share), only when that difference is over 10
(threshold), and then waits at least 2.5 times the age of its news (wait). Each candidate below was run on every square
of the grid (five markets) on seeds 1 to 10. Served is our bank's customers served overall, together, in percent; the
change is against today's settings; a candidate is eligible if no market falls by more than 0.5 points.

| Setting | G (points) | Served, all markets | ${MARKETS.map((m) => marketName[m]).join(' | ')} | Worst market change | Eligible |
|---|---|---|${MARKETS.map(() => '---').join('|')}|---|---|
${scores
  .map(
    (s) =>
      `| ${label(s.setting)} | ${f2(s.G)} | ${f2(s.servedAll)}% | ${MARKETS.map((m) => `${f2(s.served[m])}%`).join(' | ')} | ` +
      `${sign(worstFall(s, today))} | ${eligible.includes(s) ? 'yes' : 'no'} |`,
  )
  .join('\n')}

Chosen on seeds 1 to 10: the eligible setting with the highest G, **${label(chosen.setting)}**.

## The held-out check, seeds 11 to 30

| Setting | G (points) | Served, all markets | ${MARKETS.map((m) => marketName[m]).join(' | ')} |
|---|---|---|${MARKETS.map(() => '---').join('|')}|
${[heldToday, ...(same(chosen.setting, TODAY) ? [] : [heldChosen])]
  .map((s) => `| ${label(s.setting)} | ${f2(s.G)} | ${f2(s.servedAll)}% | ${MARKETS.map((m) => `${f2(s.served[m])}%`).join(' | ')} |`)
  .join('\n')}

To be adopted, the chosen setting had to improve G by at least 3 points on seeds 11 to 30, with no market falling by
more than 0.5 points. ${
  same(chosen.setting, TODAY)
    ? "Today's settings were already the best eligible choice, so there was nothing to adopt."
    : `It changed G by ${sign(gGain)} points, and its worst market changed by ${sign(heldFall)} points.`
}

## The decision

${
  adopt
    ? `**Adopted: ${label(chosen.setting)}.** On seeds the choice never saw, desks lending faster served ${sign(gGain)} points more customers at a swamped desk, and no market served more than 0.5 points fewer.`
    : `**Nothing adopted; today's settings stay.** ${
        same(chosen.setting, TODAY)
          ? 'No other setting both kept every market within 0.5 points and helped a swamped desk more.'
          : gGain < 3
            ? `The best candidate improved the swamped desk's gain by only ${sign(gGain)} points on the held-out seeds, short of the 3 points required.`
            : `The best candidate cost one market ${sign(heldFall)} points on the held-out seeds, more than the 0.5 allowed.`
      }`
}

In every run of this study, our bank stayed inside its limit.
`;

writeFileSync('docs/rush.md', md);
// The figures npm run facts quotes, so they are read rather than copied.
const r4 = (x: number) => Number(x.toFixed(4));
writeFileSync(
  'docs/grant-study.json',
  `${JSON.stringify({
    adopted: adopt,
    chosen: chosen.setting,
    choosing: { today: { G: r4(today.G), served: r4(today.servedAll) }, chosen: { G: r4(chosen.G), served: r4(chosen.servedAll) } },
    heldOut: { today: { G: r4(heldToday.G), served: r4(heldToday.servedAll) }, chosen: { G: r4(heldChosen.G), served: r4(heldChosen.servedAll) } },
    gGain: r4(gGain),
    worstMarketChange: r4(heldFall),
  })}\n`,
);
console.log(md.slice(md.indexOf('## Lending faster')));
console.log(`\nDECISION: ${adopt ? 'ADOPT' : 'NOTHING ADOPTED'} (${label(chosen.setting)}; held-out G ${f2(heldToday.G)} -> ${f2(heldChosen.G)}, worst market ${sign(heldFall)})`);
console.log(`ADOPT_JSON ${JSON.stringify({ adopt, setting: chosen.setting })}`);
