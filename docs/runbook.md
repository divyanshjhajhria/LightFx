# Run sheet: the person at the laptop

## Before

- [ ] Chrome, up to date, with no other tabs. Window full screen at 1440x900 or larger; 1366x768 also works.
- [ ] Browser zoom at 100% (Cmd+0 or Ctrl+0).
- [ ] Sound on, at a level the back of the room can hear. Test it once on the first step of the demo.
- [ ] Do not disturb on; notifications, chat and email closed.
- [ ] Charger plugged in. Screen sleep off.
- [ ] The demo address open and loaded: the hosted page or `npm run preview`, with `?demo` on the end. It starts the
      guided demo at once.
- [ ] The zipped build, `lightspeed-fx-demo.zip` (from `npm run package`), unzipped on the desktop as a spare.
- [ ] The backup video of the guided demo on the desktop. (Not made yet: someone must record it.)
- [ ] The three screenshots below open in a viewer, as the last resort.

## Which opener

docs/pitch.md has an opener for each sponsor. When you do not know who is judging, or there is more than one, use them
in this order of priority:

1. Neptune North.
2. Marshall Wace ("New Worlds").
3. SGX FX, challenge 1 (protecting traders in a storm).
4. SGX FX, challenge 2 (learning to trade).

## During

| Key | What it does |
|---|---|
| Space | Move the demo on. On the results card, start again. |
| G | Start the guided demo. |
| M | Mute or unmute the voice. The captions always show. |
| R | Restart at once, no question asked: the demo from its first step, or whatever is running. |
| Escape | Leave the demo for free play, with the bank exactly as it stands. |

## Who decides for our desks: live, recorded or stand-in

The chip beside "Our bank" in the Overview always says which is running: **Live models**, **Recorded models** or
**Stand-in**. No chip means the desks run on their built-in rules (the plain `?demo`).

| Address | What decides | Needs |
|---|---|---|
| `?demo&agents=replay` | **Recorded models**: the decisions a real model made in our recorded guided demo, applied again through the same guard. | Nothing: no key, no network. |
| `?demo&agents=live` | **Live models**: a real model decides for each desk now. | `npm run dev` on this laptop with the key in `.env.local`, and working internet. |
| `?demo&agents=stand-in` | **Stand-in**: a small fixed script, not AI. | Nothing. |
| `?demo` | Rules, no chip. | Nothing. |

In live mode a model answer that takes over 8 seconds, fails or will not parse is dropped and the stand-in makes that
one decision; the simulation never waits for the model. After 400 model calls in one page load, every decision comes
from the stand-in and the chip changes to "Stand-in". Reload the page to start a new budget.

What the real model did in our own runs (docs/facts.md, `live.*`): 123 calls, a typical answer in 3.1 seconds, the
bank never past its limit. It also got things wrong, and the checks caught it: one desk tried to give away allowance it
could not spare and the guard gave nothing, 31 notes failed the truth check and were not sent, and 2 replies came back
cut off, so the stand-in decided those.

**If the venue Wi-Fi drops (or is slow) during a live run:** do nothing on stage. Each failed call falls back to the
stand-in within 8 seconds, and the demo carries on. Between runs, switch to `?demo&agents=replay`, which needs no
network and shows what the real model did. Never deploy or hand out a build made with the key in it.

## If something goes wrong

- **The voice fails or the room is too loud.** Press M and read the captions aloud.
- **The page freezes or looks wrong.** Press R. If the page shows "Something went wrong", press R there too.
- **The browser dies.** Use the unzipped spare build. It needs a local server (opening `index.html` directly will not
  work): in a terminal, inside that folder, run `python3 -m http.server 8000`, then open
  `http://localhost:8000/?demo`. No network is needed.
- **No screen at all.** Talk through the three screenshots in `docs/screens/`:
  - `10-after-calm.jpg`: three banks, all inside their limits.
  - `10-after-demo-beat5.jpg`: the panic; the bank that trusts old news has gone past its limit, ours holds.
  - `07-survival-map-panic.jpg`: thousands of storms; the old-news bank breaks in long panics, ours never does.

## After: for a technical judge

1. Press Escape to leave the demo, then open **More**, "Open the survival map".
2. Choose "Panic". Point at the bank that trusts old news, its squares going redder as the storm gets longer, and at
   our bank and the bank that asks Earth, at 0 minutes over the limit everywhere.
3. Hover any square for its figures; click it to **play that storm** (storm 1 of its 40, at 16x, with the bank that
   did worst on the canvas).
4. "The banks" tab has the chart of all three banks against the limit; "The agents" tab shows what each desk's agent
   is deciding, when agents run the desks (More, "Our desks run by").
