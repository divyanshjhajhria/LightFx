# Lightspeed FX

One bank, three currency desks (Earth, Moon, Mars), quoting dollars against Mars credits.
Messages between desks travel at light speed and stop in a solar storm, so no desk can wait for head office.
The app runs three ways of managing the bank's risk limit side by side on identical events.

## Run it

```
npm install
npm run dev      # the app, at http://localhost:5173
npm test         # unit tests, property test, demo scenario on four seeds
npm run sim      # headless demo scenario: npm run sim -- <seed> <earth-mars angle>
npm run build    # static site in dist/, deployable anywhere
```

## The three strategies

| Strategy | How it checks the limit | What goes wrong |
|---|---|---|
| Leased budgets (ours) | Each desk owns a slice of the limit and only spends its own slice. Spare budget is granted to busy desks by gossip. A desk that hears nothing for 60 minutes goes reduce-only. | Turns some customers away when its slice is full. |
| Naive gossip | Each desk adds its own position to the last positions it heard from the others. | Stale information: breaches the limit in a storm. |
| Central approval | Earth approves every trade. | Remote customers wait a round trip and leave; nothing trades in a blackout. |

Why ours is safe: budget moves as a cumulative "granted so far" counter that receivers merge with `max()`.
A desk's view of what it has been granted can be behind the truth but never ahead of it, so the budgets
never add up to more than the limit, whatever is delayed, repeated or lost. `tests/invariants.test.ts`
checks this against random failures.

Netting: after a blackout one desk is often long while another is short, so budget is tied up on both
sides of a position the bank does not really have. A short desk offers to take long position off a long
peer ("I will absorb up to N units; this is my offer number E to you"), and holds room for all N until
the reply comes back. The long desk hands over what it can, once per offer number, and replies
("for offer E I handed over G units at price P"). Both sides gossip their latest offer and reply in every
message, so a lost message is repaired by the next one and a repeated one is ignored. A desk never lets
its position plus the room it is holding exceed its budget, so units on their way between desks are
always covered by the receiver's budget, and the limit holds even if a link dies half-way through.
Only the short desk ever asks, so two desks can never swap a position back and forth.
`tests/netting.test.ts` checks this, including links failing in the middle of an exchange.

## Where things are

```
src/sim/types.ts     shared types and message shapes (agree changes as a team)
src/sim/config.ts    every tunable number, with units
src/sim/rng.ts       seeded randomness (never use Math.random in src/sim)
src/sim/orbits.ts    positions, light delay, Sun blocking
src/sim/network.ts   the only way messages travel: delayed or dropped
src/sim/market.ts    Earth price feed: synthetic, or a replay of real prices
src/sim/desks.ts     the three strategies behind one Desk interface
src/sim/world.ts     one bank's main loop; Arena runs all three on one seed
src/ui/App.tsx       top bar, control dock, desk inspector, main loop
src/ui/SolarView.tsx the solar system canvas: camera, messages, drops, planets
src/ui/Intel.tsx     the three-strategy comparison panel
src/ui/theme.ts      colours, labels and number formatting shared by the above
scripts/             headless scenario runner; CSV to JSON converter for real prices
tests/               orbits, network, market feed, safety property, demo scenario
```

## Using the view

- Scroll to zoom, drag to pan, double-click or "Reset view" to return.
- Click a planet, or a desk row in the bottom panel, to open that desk.
- Click a strategy's name to watch its message traffic on the canvas.
- Bright streaks are desks talking; faint specks are market news; a red cross is a message sent into a dead link.
- Space bar plays and pauses.
- Green, amber and red only ever mean a desk's state (normal, degraded, reduce-only or halted) or a breach.

## How the market works

- The price has two parts: news from Earth and news from Mars. Each travels at light speed.
- Every location has its own fair price: local news fresh, remote news as old as the delay.
- Customers arrive at random at each desk and trade if the quote is close enough to the local fair price.
- Positions are valued at the price with all news fresh, which nobody inside the simulation can see.

## Using the SGX FX data

```
python3 scripts/convert_sgx.py their_file.csv --time-col <name> --bid-col <name> --ask-col <name>
```

This writes `public/earth.json` (one mid price per minute). The app replays it in place of the synthetic
feed whenever that file holds two or more prices. Pick a volatile stretch with `--start` and `--minutes`.

## Not built yet

1. **Game mode.** Player as the storm, with a score. The controls exist; the scoring does not.
2. **Scenario presets and a timeline scrubber.**
3. **Arbitrageurs.** Every desk currently quotes around its own local fair price, so there is nothing to pick off.
   They matter once a strategy quotes a stale price (for example, Earth setting Mars's quotes).
4. **Clicking a link to cut it.** `Arena.setCut(a, b, true)` works; the canvas has no click handler yet.
5. **Python analysis.** Volatility-regime detection on the SGX data to drive `panic` automatically; a parameter
   sweep (lease length against blackout frequency) for the survival heatmap.

## Tuning

Change numbers in `src/sim/config.ts`, then `npm run sim` to see the effect and `npm test` to check the
demo scenario still holds. The ones that matter most: `leaseDuration`, `gapK` (how fast spreads widen with
stale information), `alloc` (starting split of the limit) and the three `panic*` values.
