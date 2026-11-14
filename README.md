# Lightspeed FX

One bank, three currency desks (Earth, Moon, Mars), quoting dollars against Mars credits.
Messages between desks travel at light speed and stop in a solar storm, so no desk can wait for head office.
The app runs three ways of managing the bank's risk limit side by side on identical events.

## Running the demo

Start it with `npm run dev` and open http://localhost:5173/?demo, or press **G** in the app, or choose
"Guided demo" at the top of the Scenario menu. The bank is warmed up for an hour, the Mars desk is open with its
trade ticket set to sell 5, and the controls are hidden. A caption bar and a voice explain each step.

| Key | What it does |
|---|---|
| Space | Moves the demo on (stops the current line first). On the first step it sells 5 at Mars for the visitor. On the results card it starts again. |
| M | Mute or unmute the voice. The captions always show. |
| Esc | Leave the demo: free play, with the bank exactly as it stands and every control back. |

The bottom-right hint says what the next press does ("Space then: Market panic"), greyed while the demo is
fast-forwarding to its next moment, with a dot per step.

| # | Step | What happens | Moves on |
|---|---|---|---|
| 1 | Place a trade | The visitor sells 5 to the Mars desk with the ticket's button (or the presenter presses space). | When the trade is placed |
| 2 | Your trade | Mars says yes on its own and starts telling Earth. | By itself, when the message is half-way |
| 3 | Solar storm | Every link goes; the visitor's message is destroyed in mid-space. | Space |
| 4 | An hour of silence | Fast-forward until our Mars desk starts playing safe. | Space |
| 5 | Market panic | Fast-forward until the bank that trusts old news goes through its limit; the canvas shows that bank, so each desk's "thinks the bank holds" can be compared with what it really holds. | Space |
| 6 | Total isolation | Earth and the Moon lose each other too. | Space |
| 7 | The storm passes | Links return; once Earth has heard about the trade, a results card closes the demo. | Space |

A line that states an outcome ("has gone through its limit") is spoken only once the simulation has really got
there; if it never does, the demo slows down and says nothing. Lines about the visitor's trade are worded from the
trade actually placed, so a different trade (buy 10 at Earth, say) is described correctly.

**Recorded voice.** Put MP3s in `public/vo/` named after the line they replace (`ready.mp3`, `panic-settle.mp3` and
so on; see `public/vo/README.md`). Lines without a file use the browser's speech voice, British English if it has
one. **If the voice fails** or the room is noisy, press M and read the captions aloud.

## Try it: follow a trade

1. Open the app (`npm run dev`) and click Mars.
2. Under "Trade with this desk", choose "Sell Mars credits", leave the size at 5, and press "Sell 5 to the Mars desk".
   Your order goes to all three banks at once.
3. Watch "Your trade" at the bottom: one column per bank, in plain words. Ours says yes on the spot; the naive
   bank says yes too; the central bank has to ask Earth and you wait about 40 minutes for the answer.
4. Hover any bright dot on the canvas to read the message it carries. Click one to pause and pin it.
5. Press "Solar storm" and place the same trade again. Ours still says yes and keeps trying to tell the others;
   the central bank's request is lost; the naive bank's Earth desk works from a total that is now wrong.

## Run it

```
npm install
npm run dev      # the app, at http://localhost:5173
npm test         # unit tests, property tests, scenarios
npm run sim      # headless scenario: npm run sim -- <scenarioId> [seed]; no argument lists them
npm run study    # netting on vs off under sustained opposite customer flow, 30 seeds
npm run sweep    # the survival map's data: 144 squares x 40 seeds into public/sweep.json (about 2 min)
npm run build    # static site in dist/, deployable anywhere
python3 analysis/heatmaps.py   # slide figures from public/sweep.json into docs/figures/
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
Offers below `nettingMin` units are not worth a round trip, except one that would flatten the desk completely.
`tests/netting.test.ts` checks this, including links failing in the middle of an exchange.

## Scenarios

A scenario is a script: a seed, a starting position for Mars, a length, and a list of timed events
(storm on or off, panic on or off, Mars's position, a link cut or restored, the customer mix at a desk,
and notes for the presenter to read aloud). A `Director` applies each event at the first tick its time
has come, so a scenario plays the same way every time, headless or in the browser. Pick one from the
"Scenario" menu in the top bar; "Free play" hands the controls back to you.

| Scenario | What it shows |
|---|---|
| Solar storm | A storm and a panic together: the naive bank breaches, ours goes reduce-only and holds, central barely trades. |
| Trade winds | Earth's customers mostly sell and Mars's mostly buy, so the two desks drift apart. A 30-minute blackout (short enough that no desk starts playing safe), then Earth visibly hands its surplus to Mars: hand-overs are drawn as large labelled messages. |
| Behind the Sun | No storm: Mars passes behind the Sun and geometry alone cuts the Earth to Mars link. |
| One link down | Earth and Mars lose their direct line for two hours. After an hour Mars is marked degraded, but it keeps trading because it can still reach the Moon. |

To add one, append a `Scenario` to `src/sim/scenarios.ts` (events sorted by time, a unique hyphenated id)
and run `npm test`: the scenario tests check every preset is well formed and never breaches the limit.
Then `npm run sim -- <id>` prints the three banks each time a note fires and at the end.

## Visitor trades, their stories and what desks believe

- `Arena.placeTrade(at, side, size)` places one visitor trade at all three banks and returns its id.
  `World.placeTrade` builds a customer who takes whatever price is quoted (with `cfg.visitorPatience` minutes of
  patience) and sends it down exactly the same path as every other customer. It draws no random numbers, so the
  background customers and prices stay identical. `Arena.cancelTrade(id)` means the visitor walked away; only a
  central desk still waiting on Earth does anything with it.
- `World.trace(id)` is the trade's story at that bank, oldest first, for the 10 most recent trades
  (`src/sim/trace.ts`): placed, filled or refused (and why), asked Earth, Earth approved or declined, too late,
  gave up, told a peer, could not tell a peer (recorded once per peer), and heard. World records most of it from its
  god view; central desks report their own steps through an optional `DeskCtx.report`, which never feeds back into
  a decision. Messages that carry a trade's news are tagged with its id so the canvas can pick them out.
- `Desk.believedTotal()` is what a desk thinks the whole bank holds: the naive desk's own position plus the last
  positions it heard (the figure it trades against); the same sum for our desks, which keep it but never rely on
  it; head office's lower and upper bounds for the central bank. The planets show it while you follow a trade.

## The desks as agents

Each desk speaks for itself, in the first person: what it knows, what it does not know, and what it is doing about
it. Open a desk to read "In its own words" and ask it questions; a speech bubble sits beside the selected planet
("Show all desk voices" puts one at every planet).

**What a desk knows.** `deskBriefing(world, body)` in `src/sim/briefing.ts` gathers only what that desk itself
could know: what it holds, its allowance and how much is spare, its quote and the local price, how old its news from
elsewhere is, what each peer last told it and how long ago, what it thinks the bank holds, the bank's limit, how long
until it would start playing safe, customers waiting on Earth, and its last six events (changes of state, refusals,
hand-overs, allowance given or received, visitor trades). It never contains the bank's true total or another desk's
current position. That is deliberate: a desk cannot be allowed to explain itself with knowledge it could not have,
and a test checks that a change on Earth during a blackout leaves Mars's briefing identical.

**The templated voice.** `deskSays(briefing)` in `src/ui/deskVoice.ts` turns a briefing into one or two sentences,
the first matching rule winning (playing safe, a hand-over, lost touch with one peer, an hour coming, turning
customers away, close to its allowance, old prices, all quiet; and the naive and central desks' own rules). It needs
nothing else and is always available.

**Switching a language model on (optional).** Copy `.env.example` to `.env.local` and set `VITE_LLM_PROVIDER`
(`anthropic` or `gemini`), `VITE_LLM_KEY` and, if you like, `VITE_LLM_MODEL` (defaults: `claude-haiku-5-5`,
`gemini-3.5-flash-lite`), then `npm run dev`. The desks on show are reworded by the model when their situation
changes, at most once every 20 seconds each; answers are marked "AI", and free-text questions are answered. The
template shows first and stays if the model is slow (4-second limit), fails or is not configured. The guided demo
uses templates only unless opened with `?demo&ai`.

**Keep the key local.** Vite writes `VITE_` variables into the page, so a build made with a key gives the key to
anyone who opens it; `npm run build` prints a warning when one is set. Build for deployment WITHOUT the key, and use
the key only when running locally. `.env.local` is ignored by git.

**The checker.** `acceptable(text, briefing)` in `src/ui/voiceCheck.ts` throws away any model answer that is longer
than 280 characters or three sentences, uses a banned word (gossip, lease, epoch, RFQ, bp, invest, should buy, should
sell, guarantee), is not in the first person, or contains a number the briefing does not (allowing ordinary rounding).
The template is used instead.

**The protocol decides and the language model explains, so a wrong or missing model can never break the bank.**
Nothing under `src/sim` imports from `src/ui`, a test checks it, and no model output reaches a desk's decisions.

## The survival map

Choose "Survival map" at the bottom of the Scenario menu, or open `?map`. "Back to the simulator" or Escape
returns.

**What was swept.** Every combination of three markets (calm; panic during the storm; one-way customers, with
Earth's customers mostly selling and Mars's mostly buying), six positions of Mars (4 to 20 light-minutes away)
and eight storm lengths (none, 30 min to 6 h): 144 squares. Each square is run with 40 seeds, so 40 sets of
customers, and every run plays two calm hours, the storm, then two hours to recover, through exactly the code the
app runs (`runScenario`). That is 5,760 runs, 5,040 of them with a storm, and 23.8 million simulation steps.
The no-storm column is the baseline and is left out of the headline figures.

**Rebuilding it.** `npm run sweep` (about 2 minutes; `-- --quick` for a rough run, `-- --seeds N` to change the
count). The output has no timestamp, so the same code gives a byte-identical file. Commit `public/sweep.json`
with the code that made it. Without the file, the map says how to build it.

**Reading it.** Each market shows six heatmaps: a row per bank; on the left, minutes over the limit (average
over the 40 storms; "<1" means a breach averaging under a minute, never rounded to 0); on the right, the share of
customers served. Storm length runs across, Mars's distance up the side, closest at the bottom. Red is scaled to
the worst square in that market across all three banks; an outlined square is exactly zero. Hover or tab to a
square for its figures; click it to play storm 1 of its 40 at 16x, with the worst bank on the canvas. Storm 1
is one sample: in a square where 9 of 40 storms breached, storm 1 may not be one of them, and the read-out says
which storm a click plays.

The headline is computed from the file, never typed in. If our bank had ever been over its limit, the headline
would say so in red, with the number.

| Market | Bank | Over its limit | Worst peak (x limit) | Customers served |
|---|---|---:|---:|---:|
| All (5,040 storms) | Our bank | 0 | 1.0 | 58.5% |
| | The bank that trusts old news | 1,972 (39.1%) | 2.7 | 73.9% |
| | The bank that asks Earth | 0 | 1.0 | 44.7% |
| Calm market (1,680) | Our bank | 0 | 0.9 | 60.0% |
| | The bank that trusts old news | 196 (11.7%) | 1.2 | 77.8% |
| | The bank that asks Earth | 0 | 1.0 | 47.6% |
| Panic (1,680) | Our bank | 0 | 1.0 | 56.2% |
| | The bank that trusts old news | 1,490 (88.7%) | 2.7 | 68.0% |
| | The bank that asks Earth | 0 | 1.0 | 41.5% |
| One-way customers (1,680) | Our bank | 0 | 1.0 | 59.3% |
| | The bank that trusts old news | 286 (17.0%) | 1.2 | 75.8% |
| | The bank that asks Earth | 0 | 1.0 | 45.1% |

The price of safety is service: our bank serves fewer customers than the bank that trusts old news in every
market (58.5% against 73.9% overall), and more than the bank that asks Earth (44.7%), whose Mars office served
nobody at all during any storm; ours served about 20 customers per storm there. `docs/figures/summary.md` has the
same table, generated by `analysis/heatmaps.py`, which computes it independently and matches the app's figures.

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
src/sim/scenario.ts  scenario events, the Director that plays them, startScenario and runScenario
src/sim/scenarios.ts the preset scenarios in the menu
src/sim/trace.ts     the steps of a visitor trade's story
src/sim/guide.ts     the guided demo: its seven steps and the state machine that plays them
src/sim/sweep.ts     the survival map's grid: one square's scenario, running it, summing its seeds
src/sim/briefing.ts  what one desk knows, for its voice (deskEvents.ts: the events it keeps)
src/ui/App.tsx       top bar, scenario menu, timeline, control dock, desk inspector, main loop
src/ui/SolarView.tsx the solar system canvas: camera, messages, drops, planets
src/ui/Intel.tsx     "The banks": the shared chart, then a column per bank (verdict, customers served, desks)
src/ui/BanksChart.tsx the one chart of all three banks against the limit; chartMath.ts holds its pure maths
src/ui/verdict.ts    the one-sentence verdict under each bank
src/ui/StoryPanel.tsx "Your trade": the visitor trade's story, one column per bank
src/ui/story.ts      the plain-English sentence for each step of a story
src/ui/describe.ts   the plain-English description of a message, for the hover tooltip
src/ui/Presenter.tsx the guided demo's caption bar, presenter hint and results card
src/ui/voice.ts      the guided demo's voice: recorded files, else the browser's speech
src/ui/deskVoice.ts  what each desk says about itself, from templates
src/ui/askDesk.ts    the ready questions and their templated answers
src/ui/llm.ts        the optional language model (Anthropic or Gemini), plain fetch
src/ui/modelVoice.ts when to ask the model, and keeping its answers; voiceCheck.ts checks them
src/ui/SurvivalMap.tsx the survival map view; sweepSummary.ts computes its headline figures
src/ui/theme.ts      colours, labels and number formatting shared by the above
scripts/             headless scenario runner; netting study; the sweep; CSV to JSON converter for real prices
analysis/heatmaps.py slide figures and summary from public/sweep.json (matplotlib only)
public/sweep.json    the sweep's output, committed
docs/figures/        the slide figures; docs/screens/ holds screenshots of the app
tests/               orbits, network, market feed, safety property, demo scenario, netting, scenarios
```

## Using the view

- Scroll to zoom, drag to pan, double-click or "Reset view" to return.
- Click a planet, or a desk row in the bottom panel, to open that desk. Its panel starts with a trade ticket:
  buy or sell, a size from 1 to 20, and one button. Placing a trade follows it: the speed drops to 1x (and goes
  back when you press "Done"), other messages fade, the trade's own messages are drawn larger with a countdown,
  each planet shows what its desk believes the bank holds, and the top bar shows what the bank really holds.
- The bottom panel has two tabs, always the same height so the canvas never jumps. "Your trade" tells the
  followed trade's story at each bank, with a live row for anything still on its way; the column for the bank
  that asks Earth has "Give up waiting".
- "The banks" opens with one chart: what each bank really holds over time, all three on the same scale, against
  the bank's limit (the labelled lines; the pale band between them is safe). A strip along the top marks the solar
  storm and the panic, and a diamond marks each of your trades. Wherever a bank goes past its limit the line turns
  red and the gap between it and the limit is filled red: the wider the shape, the longer the breach; the taller,
  the further. Labels at the end of each line give each bank's total now; click one, or a line, to show that bank
  on the canvas. Hover the chart for the figures at any minute (not in the guided demo). In a scenario or the
  guided demo the chart runs left to right and never rescales; in free play it shows the last four hours.
- Under the chart, a column per bank: its name, a one-line verdict ("Over its limit now. 71 min so far.",
  "Inside its limit. Mars is playing safe."), the share of customers it has served, and its three desks with what
  each holds (and, for our bank, out of what allowance) and how many customers it has served.
- Hover a message to read it in plain words; click it to pause with the description pinned, and press "Resume",
  Escape, or click empty space to carry on. "Show market news" draws the price news too.
- On the canvas a click picks, in order: a planet, a message, a link, or empty space (which closes the desk).
- Click a link between two planets to cut it, and again to restore it. A hand-cut link is dashed with a
  cross at its middle. The desk panel has the same switches under "Links", for keyboard and touch.
- The "Scenario" menu loads a preset. While one is loaded, a timeline under the top bar shows the
  presenter's caption, a tick for each event, a band where the storm is on, and the time. Click the
  track to jump there (arrow keys jump 10 minutes). A jump replays the script from the start, so changes
  you made by hand are lost, visitor trades included (following stops). When a scenario ends, the play button
  plays it again from the start; placing a trade after the end carries on in free play.
- The storm, panic and Mars controls always show the simulation's real state, including changes a
  scenario makes.
- Click a strategy's name to watch its message traffic on the canvas.
- Bright dots with trails are desks talking; a large labelled dot is position being handed from one desk to
  another; a red cross is a message sent into a dead link.
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
2. **Arbitrageurs.** Every desk currently quotes around its own local fair price, so there is nothing to pick off.
   They matter once a strategy quotes a stale price (for example, Earth setting Mars's quotes).
3. **Volatility from real data.** Regime detection on the SGX data to drive `panic` automatically.
4. **Sweeping the settings.** The survival map sweeps conditions (market, distance, storm length) with the bank's
   settings fixed. Sweeping the settings themselves (allowance length against how often storms come) is not built.
5. **Real prices in the map.** The sweep runs on the synthetic price feed. With SGX prices in `public/earth.json`,
   the app would replay them, so a storm played from the map would no longer match its square; rerun the sweep
   with that feed first (not wired up).
6. **Choosing the storm to play.** A square always plays storm 1 of its 40; there is no way to pick another.
7. **Several storms in one run.** Each square has one storm; storms back to back, or links cut by hand, are not
   swept.

## Tuning

Change numbers in `src/sim/config.ts`, then `npm run sim -- solar-storm` to see the effect and `npm test` to check the
demo scenario still holds. The ones that matter most: `leaseDuration`, `gapK` (how fast spreads widen with
stale information), `alloc` (starting split of the limit) and the three `panic*` values.
