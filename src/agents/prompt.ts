// What an agent is told, and the shape its answer must take. The briefing goes in the user message as JSON.
import { BODIES } from '../sim/types';
import type { BodyId } from '../sim/types';

export const DESK_NAME: Record<BodyId, string> = { earth: 'Earth', moon: 'Moon', mars: 'Mars' };

/** The system prompt for one desk's agent, in the wording the team agreed. */
export function agentSystemPrompt(body: BodyId, limit: number): string {
  return `You run the ${DESK_NAME[body]} desk of a bank that swaps dollars and Mars credits. The bank
has three desks: Earth, the Moon and Mars. Each is run by its own agent. You
cannot see the others. Messages between desks travel at the speed of light and
can be lost, so everything you know about the other desks is as old as the data
says, and may be gone for hours.

The bank as a whole must never hold more than ${limit} in either direction. A
rule you cannot override enforces that: you can only trade inside your own
allowance. Your job is judgment inside that rule: serve as many customers as
you sensibly can, keep risk reasonable when you are in the dark, and help the
other desks.

Reply with ONE JSON object and nothing else:
{"pricing": "keen" | "steady" | "cautious",
 "caution": "normal" | "play-safe",
 "give": {"<desk>": whole units of your SPARE allowance to hand over now},
 "ask": {"<desk>": whole units of allowance you want from them},
 "noteTo": {"<desk>": "at most 140 characters, plain words"},
 "thought": "one or two sentences, first person, on what you decided and why"}

Guidance. Price keenly when you hold little and your news is fresh; cautiously
when your news is old or customers are all going one way. Ask for allowance
when less than a fifth of yours is spare. Give spare allowance to a desk that
asked, unless you expect to need it. Choose play-safe if you are out of touch
and things look bad. In notes, say what you hold, what you need and what you
plan; the reader may see it twenty minutes late or never. Use only numbers
from the data. Say "allowance", "the bank's limit", "holds", "playing safe".`;
}

/**
 * The answer's JSON schema, for providers that can enforce one. Keys are the two peers' ids as they appear in the
 * briefing. No numeric or length limits here (the Anthropic API refuses them); sanitise() enforces those.
 */
export function directiveSchema(body: BodyId): object {
  const peers = BODIES.filter((b) => b !== body);
  const map = (type: 'integer' | 'string') => ({
    type: 'object',
    properties: Object.fromEntries(peers.map((p) => [p, { type }])),
    required: [...peers],
    additionalProperties: false,
  });
  return {
    type: 'object',
    properties: {
      pricing: { type: 'string', enum: ['keen', 'steady', 'cautious'] },
      caution: { type: 'string', enum: ['normal', 'play-safe'] },
      give: map('integer'),
      ask: map('integer'),
      noteTo: map('string'),
      thought: { type: 'string' },
    },
    required: ['pricing', 'caution', 'give', 'ask', 'noteTo', 'thought'],
    additionalProperties: false,
  };
}
