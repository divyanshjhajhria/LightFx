// The optional language model. It does two jobs: rewording what a desk of another bank says (complete), and, for our
// bank's desks, deciding as an agent (completeJson), whose answer reaches the simulation only as a sanitised Directive.
// With nothing configured, makeClient() returns null: desks speak from templates and our desks run on rules.
//
// Configuration (Vite environment variables, all optional; put them in .env.local, never in a deployed build):
//   VITE_LLM_PROVIDER  "anthropic" or "gemini"; anything else means none
//   VITE_LLM_KEY       the API key
//   VITE_LLM_MODEL     optional model override
//
// Sources checked when this was written:
//   Anthropic: POST https://api.anthropic.com/v1/messages with x-api-key, anthropic-version and content-type
//   (platform.claude.com/docs/en/api/overview). Browser calls need the header anthropic-dangerous-direct-browser-access:
//   true, which is what Anthropic's own TypeScript SDK sends when dangerouslyAllowBrowser is set; the SDK's README
//   says browser use is off by default "to avoid exposing your secret API credentials".
//   Gemini: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent with x-goog-api-key;
//   Google's API key page says "Never expose keys client-side in production".
//
// JSON output, checked against each provider's documentation for this step (November 2026):
//   Anthropic: structured outputs are stable, no beta header: output_config.format = { type: "json_schema", schema }.
//   The schema may not use minimum/maximum/multipleOf or minLength/maxLength, and every object needs
//   additionalProperties: false (platform.claude.com/docs/en/build-with-claude/structured-outputs). The JSON comes back
//   as the text block. Limits are enforced afterwards by sanitise().
//   Gemini: the generateContent reference lists generationConfig.responseMimeType "application/json". Google's
//   structured-output page now documents a schema only for its newer Interactions endpoint, not for generateContent,
//   so only JSON mode is asked for here; sanitise() does the rest.

export interface LlmClient {
  complete(system: string, user: string, signal: AbortSignal): Promise<string>;
  /** The same, asking the provider for a single JSON object matching `schema` where it can enforce one. */
  completeJson?(
    system: string,
    user: string,
    schema: object,
    signal: AbortSignal,
  ): Promise<string>;
}

export interface LlmEnv {
  VITE_LLM_PROVIDER?: string;
  VITE_LLM_KEY?: string;
  VITE_LLM_MODEL?: string;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Every model call gives up after this long, and the template stays. */
export const LLM_TIMEOUT_MS = 4000;
/** An agent's decision is longer than a sentence: it gets a little more time. */
export const AGENT_TIMEOUT_MS = 6000;

/** Small, fast models: a desk's sentence is short and has to arrive within a few seconds. */
const DEFAULT_MODEL = {
  anthropic: "claude-haiku-5-5",
  gemini: "gemini-3.5-flash-lite",
} as const;

/** Run `call` with its own timeout (4 seconds unless given), also aborting if the caller's signal does. */
async function withTimeout(
  signal: AbortSignal,
  call: (s: AbortSignal) => Promise<string>,
  ms = LLM_TIMEOUT_MS,
): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("timeout")), ms);
  const onAbort = () => ctl.abort(signal.reason);
  if (signal.aborted) ctl.abort(signal.reason);
  else signal.addEventListener("abort", onAbort);
  try {
    const text = (await call(ctl.signal)).trim();
    if (!text) throw new Error("empty answer");
    return text;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

function anthropic(key: string, model: string, fetchFn: Fetch): LlmClient {
  const call = (
    system: string,
    user: string,
    signal: AbortSignal,
    schema: object | null,
    ms: number,
  ) =>
    withTimeout(
      signal,
      async (s) => {
        const r = await fetchFn("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: s,
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2026-10-21",
            // Required for a call made straight from a web page; see the note at the top of this file.
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            // Keep the model quick rather than thorough; ask for JSON matching the schema when there is one.
            output_config: schema
              ? { effort: "low", format: { type: "json_schema", schema } }
              : { effort: "low" },
            system,
            messages: [{ role: "user", content: user }],
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as {
          stop_reason?: string;
          content?: { type: string; text?: string }[];
        };
        if (body.stop_reason === "refusal") throw new Error("refused");
        return (body.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
      },
      ms,
    );
  return {
    complete: (system, user, signal) =>
      call(system, user, signal, null, LLM_TIMEOUT_MS),
    completeJson: (system, user, schema, signal) =>
      call(system, user, signal, schema, AGENT_TIMEOUT_MS),
  };
}

function gemini(key: string, model: string, fetchFn: Fetch): LlmClient {
  const call = (
    system: string,
    user: string,
    signal: AbortSignal,
    json: boolean,
    ms: number,
  ) =>
    withTimeout(
      signal,
      async (s) => {
        const r = await fetchFn(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            signal: s,
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": key,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: user }] }],
              generationConfig: json
                ? { maxOutputTokens: 600, responseMimeType: "application/json" }
                : { maxOutputTokens: 300 },
            }),
          },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        return (body.candidates?.[0]?.content?.parts ?? [])
          .map((p) => p.text ?? "")
          .join("");
      },
      ms,
    );
  return {
    complete: (system, user, signal) =>
      call(system, user, signal, false, LLM_TIMEOUT_MS),
    completeJson: (system, user, _schema, signal) =>
      call(system, user, signal, true, AGENT_TIMEOUT_MS),
  };
}

/** The configured model, or null: no provider, no key, or a provider this app does not know. */
export function makeClient(
  env: LlmEnv = import.meta.env as LlmEnv,
  fetchFn: Fetch = (u, i) => fetch(u, i),
): LlmClient | null {
  const provider = env.VITE_LLM_PROVIDER?.trim().toLowerCase();
  const key = env.VITE_LLM_KEY?.trim();
  if (!key || (provider !== "anthropic" && provider !== "gemini")) return null;
  const model = env.VITE_LLM_MODEL?.trim() || DEFAULT_MODEL[provider];
  return provider === "anthropic"
    ? anthropic(key, model, fetchFn)
    : gemini(key, model, fetchFn);
}
