// Step 14: run our desks on a real model, headless, and measure it. Reads VITE_LLM_* from .env.local without ever
// printing the key. `--one` makes a single call; otherwise runs the guided demo and two presets in real time.
import { readFileSync, existsSync } from 'node:fs';
import { makeClient, configuredModel } from '../src/agents/llm';
import type { LlmEnv } from '../src/agents/llm';
import { agentSystemPrompt, directiveSchema } from '../src/agents/prompt';
import { extractJson } from '../src/agents/runner';
import { sanitise } from '../src/sim/directive';
import { deskBriefing } from '../src/sim/briefing';
import { Arena } from '../src/sim/world';
import { GUIDE_SEED, GUIDE_SEPARATION, GUIDE_WARMUP } from '../src/sim/guide';

export function readEnv(): LlmEnv {
  if (!existsSync('.env.local')) throw new Error('no .env.local');
  const env: Record<string, string> = {};
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*(VITE_LLM_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

export interface CallStat { status: number; ms: number; inTok: number; outTok: number; error?: string }
export const calls: CallStat[] = [];

/** fetch, measured: status, latency and token usage of every model call. Never records headers. */
export const measuredFetch = async (url: string, init: RequestInit): Promise<Response> => {
  const t0 = performance.now();
  try {
    const r = await fetch(url, init);
    const ms = performance.now() - t0;
    const body = await r.clone().json().catch(() => ({}));
    const u = (body as { usage?: { input_tokens?: number; output_tokens?: number } }).usage ?? {};
    const err = (body as { error?: { type?: string; message?: string } }).error;
    calls.push({ status: r.status, ms, inTok: u.input_tokens ?? 0, outTok: u.output_tokens ?? 0, error: err ? `${err.type}: ${err.message}` : undefined });
    return r;
  } catch (e) {
    calls.push({ status: 0, ms: performance.now() - t0, inTok: 0, outTok: 0, error: String((e as Error).message) });
    throw e;
  }
};

if (process.argv.includes('--one')) {
  const env = readEnv();
  const client = makeClient(env, measuredFetch);
  if (!client?.completeJson) throw new Error('no client configured');
  console.log('model:', configuredModel(env));
  const a = new Arena(GUIDE_SEED, { separationDeg: GUIDE_SEPARATION });
  a.run(GUIDE_WARMUP);
  const b = deskBriefing(a.worlds.leased, 'mars');
  let raw = '';
  try {
    raw = await client.completeJson(agentSystemPrompt('mars', b.limit), JSON.stringify(b), directiveSchema('mars'), new AbortController().signal);
  } catch (e) {
    console.log('call failed:', (e as Error).message);
  }
  const c = calls[0];
  console.log('HTTP status:', c?.status, 'latency ms:', c ? Math.round(c.ms) : '-', 'tokens in/out:', c?.inTok, c?.outTok, c?.error ?? '');
  let dir = null;
  try { dir = sanitise(extractJson(raw), 'mars'); } catch (e) { console.log('parse error:', (e as Error).message); }
  console.log('parsed into a Directive:', dir !== null);
  console.log('reply:', raw);
}

// ---- Full runs ------------------------------------------------------------------------------------------------------
import { writeFileSync, mkdirSync } from 'node:fs';
import { AgentRunner, LIVE_CALL_BUDGET } from '../src/agents/runner';
import type { SessionEntry, SessionFile } from '../src/agents/runner';
import { Guide } from '../src/sim/guide';
import { SCENARIOS } from '../src/sim/scenarios';
import { startScenario } from '../src/sim/scenario';
import { BODIES } from '../src/sim/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now() / 1000;
const earthSeries = (() => {
  try {
    const m = JSON.parse(readFileSync('public/earth.json', 'utf8'));
    return Array.isArray(m) && m.length >= 2 ? (m as number[]) : undefined;
  } catch {
    return undefined;
  }
})();

interface RunOut { name: string; entries: SessionEntry[]; calls: CallStat[]; fallbacks: number; breachTicks: number; maxAbs: number; limit: number; arena: Arena }

async function runGuide(client: ReturnType<typeof makeClient>, waitSeconds = 8): Promise<RunOut> {
  const a = new Arena(GUIDE_SEED, { separationDeg: GUIDE_SEPARATION, earthSeries });
  a.run(GUIDE_WARMUP);
  const g = new Guide(a);
  const first = calls.length;
  const r = new AgentRunner(a, { mode: 'live', client, clock: now });
  const t0 = now();
  let beatAt = t0;
  let beat = -1;
  let owed = 0;
  let last = now();
  while (!g.finished && now() - t0 < 600) {
    await sleep(50);
    const t = now();
    owed += (t - last) * g.speed;
    last = t;
    const dt = a.worlds.leased.cfg.dt;
    while (owed >= dt) {
      a.step();
      g.tick(t - t0);
      owed -= dt;
    }
    r.tick();
    g.tick(t - t0);
    if (g.index !== beat) {
      beat = g.index;
      beatAt = t;
      console.log(`  ${Math.round(t - t0)}s beat: ${g.beat.label}`);
    }
    // A presenter presses space once the voice has had time to finish.
    if (g.canAdvance && (g.beat.advance === 'space' || g.index === 0) && t - beatAt >= waitSeconds) g.space();
  }
  // Let calls still out land or time out.
  for (let i = 0; i < 200 && BODIES.some((b) => r.status(b).state === 'thinking'); i++) {
    await sleep(50);
    r.tick();
  }
  r.stop();
  const m = a.worlds.leased.metrics;
  return { name: 'Guided demo', entries: [...r.log()], calls: calls.slice(first), fallbacks: r.fallbacks, breachTicks: m.breachTicks, maxAbs: m.maxAbsTotal, limit: a.worlds.leased.cfg.limit, arena: a };
}

async function runPreset(client: ReturnType<typeof makeClient>, id: string, speed: number): Promise<RunOut> {
  const s = SCENARIOS.find((x) => x.id === id)!;
  const { arena: a, director } = startScenario(s, undefined, earthSeries);
  const first = calls.length;
  const r = new AgentRunner(a, { mode: 'live', client, clock: now });
  let owed = 0;
  let last = now();
  while (!director.done) {
    await sleep(50);
    const t = now();
    owed += (t - last) * speed;
    last = t;
    const dt = a.worlds.leased.cfg.dt;
    while (owed >= dt && !director.done) {
      a.step();
      director.advance();
      owed -= dt;
    }
    r.tick();
  }
  for (let i = 0; i < 200 && BODIES.some((b) => r.status(b).state === 'thinking'); i++) {
    await sleep(50);
    r.tick();
  }
  r.stop();
  const m = a.worlds.leased.metrics;
  return { name: s.name, entries: [...r.log()], calls: calls.slice(first), fallbacks: r.fallbacks, breachTicks: m.breachTicks, maxAbs: m.maxAbsTotal, limit: a.worlds.leased.cfg.limit, arena: a };
}

if (process.argv.includes('--runs')) {
  const env = readEnv();
  const client = makeClient(env, measuredFetch);
  if (!client) throw new Error('no client configured');
  const model = configuredModel(env)!;
  console.log('model:', model, 'budget per page session:', LIVE_CALL_BUDGET);
  const out: RunOut[] = [];
  console.log('Guided demo, live');
  out.push(await runGuide(client));
  for (const id of ['solar-storm', 'rush-on-mars']) {
    console.log(id, 'live, speed 8');
    out.push(await runPreset(client, id, 8));
  }
  mkdirSync('docs/live', { recursive: true });
  writeFileSync('docs/live/runs.json', JSON.stringify(out.map(({ arena: _a, ...o }) => o), null, 1));
  const g = out[0];
  const file: SessionFile = { version: 1, recordedWith: 'live', model, seed: GUIDE_SEED, separationDeg: GUIDE_SEPARATION, scenarioId: null, controls: [], entries: g.entries };
  mkdirSync('public/agents', { recursive: true });
  writeFileSync('public/agents/session.json', JSON.stringify(file, null, 1));
  console.log('written docs/live/runs.json and public/agents/session.json');
}
