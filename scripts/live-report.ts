// Step 14: read docs/live/runs.json (written by scripts/live-agents.ts --runs) and summarise what the live models did.
import { readFileSync, existsSync } from 'node:fs';
import { NOTE_MAX, THOUGHT_MAX } from '../src/sim/directive';

export interface LiveRun {
  name: string;
  entries: { body: string; raw: string; directive: null | { source: string; give: Record<string, number>; ask: Record<string, number>; noteTo: Record<string, string>; thought: string }; checks: { thought: string; notesDropped: string[]; given: Record<string, number>; error?: string } }[];
  calls: { status: number; ms: number; inTok: number; outTok: number; error?: string }[];
  fallbacks: number;
  breachTicks: number;
  maxAbs: number;
  limit: number;
}

/** US dollars per million tokens, Claude Haiku 5.5, prompts under 100K tokens. */
export const PRICE = { in: 0.1, out: 0.5 };

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
};

export interface Foolish { run: string; body: string; kind: string; asked: string; done: string }

export function summariseRun(r: LiveRun) {
  const ok = r.calls.filter((c) => c.status === 200);
  const lat = ok.map((c) => c.ms);
  const model = r.entries.filter((e) => e.directive?.source === 'model');
  const parseFail = r.entries.filter((e) => e.raw !== '' && e.directive === null && !e.raw.includes('"source":"stand-in"'));
  const timeouts = r.entries.filter((e) => e.checks.error === 'timeout' || /abort|timeout/i.test(e.checks.error ?? '')).length;
  const httpErrors = r.calls.filter((c) => c.status !== 200 && c.status !== 0).length;
  const reasons: Record<string, number> = {};
  const foolish: Foolish[] = [];
  const add = (kind: string, e: LiveRun['entries'][number], asked: string, done: string) => {
    reasons[kind] = (reasons[kind] ?? 0) + 1;
    foolish.push({ run: r.name, body: e.body, kind, asked, done });
  };
  const notes: { from: string; to: string; text: string }[] = [];
  for (const e of model) {
    const d = e.directive!;
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(e.raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      /* fenced or odd; parsed by the runner anyway */
    }
    const rg = (raw.give ?? {}) as Record<string, unknown>;
    const ra = (raw.ask ?? {}) as Record<string, unknown>;
    for (const [p, v] of Object.entries(rg)) {
      const n = Number(v);
      if (n > 0 && (d.give[p] ?? 0) !== n) add('give changed by sanitise()', e, `give ${p} ${String(v)}`, `give ${p} ${d.give[p] ?? 0}`);
      const given = e.checks.given[p] ?? 0;
      if ((d.give[p] ?? 0) > given) add('give cut by the guard (not spare)', e, `give ${p} ${d.give[p]}`, `gave ${given}`);
    }
    for (const [p, v] of Object.entries(ra)) {
      const n = Number(v);
      if (n > 0 && (d.ask[p] ?? 0) !== n) add('ask changed by sanitise()', e, `ask ${p} ${String(v)}`, `ask ${p} ${d.ask[p] ?? 0}`);
    }
    const rn = (raw.noteTo ?? {}) as Record<string, unknown>;
    for (const [p, v] of Object.entries(rn)) {
      if (typeof v === 'string' && v.trim() && v.trim().length > NOTE_MAX) add('note cut to 140 characters', e, v, (d.noteTo[p] ?? '(dropped)'));
    }
    for (const p of e.checks.notesDropped) add('note dropped by the checker', e, String(rn[p] ?? ''), '(not sent)');
    if (typeof raw.thought === 'string' && raw.thought.length > THOUGHT_MAX) add('thought cut to length', e, raw.thought, d.thought);
    if (e.checks.thought === 'blanked') add('thought blanked by the checker', e, String(raw.thought ?? ''), '(not shown)');
    for (const [p, text] of Object.entries(d.noteTo)) notes.push({ from: e.body, to: p, text });
  }
  for (const e of parseFail) add('reply refused (did not parse)', e, e.raw.slice(0, 200), 'stand-in decided instead');
  const inTok = r.calls.reduce((s, c) => s + c.inTok, 0);
  const outTok = r.calls.reduce((s, c) => s + c.outTok, 0);
  return {
    name: r.name,
    calls: r.calls.length,
    answered: ok.length,
    median: pct(lat, 0.5),
    p95: pct(lat, 0.95),
    over4: lat.filter((x) => x > 4000).length,
    over6: lat.filter((x) => x > 6000).length,
    timeouts,
    httpErrors,
    httpErrorText: [...new Set(r.calls.filter((c) => c.error).map((c) => `${c.status} ${c.error}`))],
    parseFail: parseFail.length,
    modelDecisions: model.length,
    fallbacks: r.fallbacks,
    reasons,
    foolish,
    notes,
    inTok,
    outTok,
    cost: (inTok * PRICE.in + outTok * PRICE.out) / 1e6,
    lat,
    breachTicks: r.breachTicks,
    peak: r.maxAbs / r.limit,
  };
}

export function loadLiveRuns(path = 'docs/live/runs.json'): LiveRun[] | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as LiveRun[]) : null;
}

if (process.argv[1]?.endsWith('live-report.ts')) {
  const runs = loadLiveRuns();
  if (!runs) throw new Error('no docs/live/runs.json');
  const all = runs.map(summariseRun);
  const lat = all.flatMap((s) => s.lat);
  for (const s of all) {
    const { lat: _l, foolish: _f, notes: _n, ...rest } = s;
    console.log(JSON.stringify(rest));
  }
  console.log('TOTAL calls', all.reduce((a, s) => a + s.calls, 0), 'answered', all.reduce((a, s) => a + s.answered, 0), 'median', Math.round(pct(lat, 0.5)), 'p95', Math.round(pct(lat, 0.95)),
    'over4', lat.filter((x) => x > 4000).length, 'over6', lat.filter((x) => x > 6000).length,
    'cost', all.reduce((a, s) => a + s.cost, 0).toFixed(4), 'tokens', all.reduce((a, s) => a + s.inTok, 0), all.reduce((a, s) => a + s.outTok, 0));
  console.log('FOOLISH');
  for (const f of all.flatMap((s) => s.foolish)) console.log(JSON.stringify(f));
  console.log('NOTES');
  for (const n of all.flatMap((s) => s.notes).slice(0, 40)) console.log(JSON.stringify(n));
}
