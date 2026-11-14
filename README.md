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
src/ui/App.tsx       top bar, scenario menu, timeline, control dock, desk inspector, main loop
src/ui/SolarView.tsx the solar system canvas: camera, messages, drops, planets
src/ui/Intel.tsx     the three-strategy comparison panel ("The banks")
src/ui/StoryPanel.tsx "Your trade": the visitor trade's story, one column per bank
src/ui/story.ts      the plain-English sentence for each step of a story
src/ui/describe.ts   the plain-English description of a message, for the hover tooltip
src/ui/Presenter.tsx the guided demo's caption bar, presenter hint and results card
src/ui/voice.ts      the guided demo's voice: recorded files, else the browser's speech
src/ui/theme.ts      colours, labels and number formatting shared by the above
scripts/             headless scenario runner; netting study; CSV to JSON converter for real prices
tests/               orbits, network, market feed, safety property, demo scenario, netting, scenarios
```

## Using the view

- Scroll to zoom, drag to pan, double-click or "Reset view" to return.
- Click a planet, or a desk row in the bottom panel, to open that desk. Its panel starts with a trade ticket:
  buy or sell, a size from 1 to 20, and one button. Placing a trade follows it: the speed drops to 1x (and goes
  back when you press "Done"), other messages fade, the trade's own messages are drawn larger with a countdown,
  each planet shows what its desk believes the bank holds, and the top bar shows what the bank really holds.
- The bottom panel has two tabs. "Your trade" tells the followed trade's story at each bank, with a live row
  for anything still on its way; the central column has "Give up waiting". "The banks" is the comparison.
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
3. **Python analysis.** Volatility-regime detection on the SGX data to drive `panic` automatically; a parameter
   sweep (lease length against blackout frequency) for the survival heatmap.

## Tuning

Change numbers in `src/sim/config.ts`, then `npm run sim -- solar-storm` to see the effect and `npm test` to check the
demo scenario still holds. The ones that matter most: `leaseDuration`, `gapK` (how fast spreads widen with
stale information), `alloc` (starting split of the limit) and the three `panic*` values.
