import { describe, expect, it, vi } from 'vitest';
import type { DeskBriefing } from '../src/sim/briefing';
import { LLM_TIMEOUT_MS, makeClient } from '../src/ui/llm';
import type { LlmClient } from '../src/ui/llm';
import { MODEL_EVERY_MS, ModelVoice } from '../src/ui/modelVoice';

const brief: DeskBriefing = {
  body: 'mars', strategy: 'leased', now: 200, mode: 'normal', holds: 12, allowance: 35, allowanceSpare: 23, bid: 0.999,
  ask: 1.001, localPrice: 1, remoteNewsAgeMin: 20.3,
  peers: [{ body: 'earth', heardMinAgo: 22, lastKnownHolds: 5 }, { body: 'moon', heardMinAgo: 21, lastKnownHolds: -3 }],
  thinksBankHolds: { low: 14, high: 14 }, limit: 100, minutesUntilPlayingSafe: 39, waitingOnEarth: null, recent: [],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const anthropicEnv = { VITE_LLM_PROVIDER: 'anthropic', VITE_LLM_KEY: 'test-key' };
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the language model client', () => {
  it('is null when nothing is configured, and the desk keeps its template', () => {
    expect(makeClient({})).toBeNull();
    expect(makeClient({ VITE_LLM_PROVIDER: 'anthropic' })).toBeNull();
    expect(makeClient({ VITE_LLM_PROVIDER: 'something-else', VITE_LLM_KEY: 'k' })).toBeNull();
    const v = new ModelVoice(null);
    v.want('mars', brief, 'All quiet.');
    expect(v.line('mars', 'All quiet.')).toEqual({ text: 'All quiet.', ai: false });
  });

  it('calls Anthropic with the browser header and reads the text blocks', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const c = makeClient(anthropicEnv, async (url, init) => {
      seen.push({ url, init });
      return json({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'I hold 12.' }] });
    })!;
    expect(await c.complete('sys', 'user', new AbortController().signal)).toBe('I hold 12.');
    const h = seen[0].init.headers as Record<string, string>;
    expect(seen[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(h['x-api-key']).toBe('test-key');
    expect(JSON.parse(seen[0].init.body as string).model).toBe('claude-haiku-5-5');
  });

  it('calls Gemini with its key header and reads the candidate parts', async () => {
    let url = '';
    const c = makeClient({ VITE_LLM_PROVIDER: 'gemini', VITE_LLM_KEY: 'g' }, async (u) => {
      url = u;
      return json({ candidates: [{ content: { parts: [{ text: 'I hold 12.' }] } }] });
    })!;
    expect(await c.complete('s', 'u', new AbortController().signal)).toBe('I hold 12.');
    expect(url).toContain('/v1beta/models/gemini-3.5-flash-lite:generateContent');
  });

  it('rejects on a timeout, an HTTP error and an empty answer', async () => {
    vi.useFakeTimers();
    const hang = makeClient(anthropicEnv, (_u, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))))!;
    const p = hang.complete('s', 'u', new AbortController().signal);
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(LLM_TIMEOUT_MS + 1);
    expect(await caught).toBeInstanceOf(Error);
    vi.useRealTimers();

    const http = makeClient(anthropicEnv, async () => json({ error: 'nope' }, 500))!;
    await expect(http.complete('s', 'u', new AbortController().signal)).rejects.toThrow('HTTP 500');
    const empty = makeClient(anthropicEnv, async () => json({ content: [{ type: 'text', text: '  ' }] }))!;
    await expect(empty.complete('s', 'u', new AbortController().signal)).rejects.toThrow('empty');
  });
});

describe('the model voice', () => {
  const answering = (text: string | (() => Promise<string>)): LlmClient & { n: number } => {
    const c = { n: 0, complete: async () => (c.n++, typeof text === 'string' ? text : text()) };
    return c;
  };

  it('shows a good answer, tagged as model-written', async () => {
    const v = new ModelVoice(answering('All quiet here. I hold 12 and have 23 to spare.'));
    v.want('mars', brief, 'All quiet. I hold +12 and have 23 of my allowance spare.');
    await settle();
    expect(v.line('mars', 'All quiet. I hold +12 and have 23 of my allowance spare.')).toEqual({ text: 'All quiet here. I hold 12 and have 23 to spare.', ai: true });
  });

  it('keeps the template when the call fails or the answer is rejected', async () => {
    const failing = new ModelVoice(answering(() => Promise.reject(new Error('timeout'))));
    failing.want('mars', brief, 'T');
    await settle();
    expect(failing.line('mars', 'T')).toEqual({ text: 'T', ai: false });

    const inventing = new ModelVoice(answering('I hold 12 and expect 999 more.'));
    inventing.want('mars', brief, 'T');
    await settle();
    expect(inventing.line('mars', 'T')).toEqual({ text: 'T', ai: false });
    expect(inventing.rejected).toBe(1);
  });

  it('calls at most once in 20 seconds however often the situation changes', async () => {
    let now = 0;
    const c = answering('I hold 12.');
    const v = new ModelVoice(c, () => now);
    for (let i = 0; i < 10; i++) {
      v.want('mars', { ...brief, holds: 12 + i }, `template ${i}`);
      now += 500;
    }
    await settle();
    expect(c.n).toBe(1);
    now = MODEL_EVERY_MS + 1;
    v.want('mars', { ...brief, holds: 40 }, 'template later');
    expect(c.n).toBe(2);
  });
});
