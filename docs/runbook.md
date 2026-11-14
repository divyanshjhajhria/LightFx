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

## During

| Key | What it does |
|---|---|
| Space | Move the demo on. On the results card, start again. |
| G | Start the guided demo. |
| M | Mute or unmute the voice. The captions always show. |
| R | Restart at once, no question asked: the demo from its first step, or whatever is running. |
| Escape | Leave the demo for free play, with the bank exactly as it stands. |

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
