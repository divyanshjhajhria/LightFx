import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { lightDelayMin, separationDeg } from '../sim/orbits';
import { GUIDE_BEATS, GUIDE_SEED, GUIDE_SEPARATION, GUIDE_WARMUP, Guide } from '../sim/guide';
import type { Line } from '../sim/guide';
import { Director, runScenario, startScenario } from '../sim/scenario';
import type { Scenario } from '../sim/scenario';
import { SCENARIOS } from '../sim/scenarios';
import { BODIES, STRATEGIES, perBody } from '../sim/types';
import type { BodyId, PerBody, StrategyId } from '../sim/types';
import { Arena } from '../sim/world';
import { deskBriefing } from '../sim/briefing';
import { deskSays } from './deskVoice';
import { Intel } from './Intel';
import { useSteadyText } from './steadyText';
import { CaptionBar, PresenterHint, ResultsCard, readResults } from './Presenter';
import type { Results } from './Presenter';
import { isMuted, prepareVoice, setMuted, speak, speaking, stop as stopVoice } from './voice';
import { SolarView } from './SolarView';
import { Story } from './StoryPanel';
import type { FollowedTrade } from './StoryPanel';
import { BODY_LABEL, MODE_LABEL, STATE, STRATEGY, clock, signed } from './theme';

/** Simulated minutes per real second, with their button labels. */
const SPEEDS: { value: number; label: string }[] = [
  { value: 0.25, label: '¼×' },
  { value: 0.5, label: '½×' },
  { value: 1, label: '1×' },
  { value: 4, label: '4×' },
  { value: 16, label: '16×' },
  { value: 60, label: '60×' },
];
const PRESETS = [
  { label: 'Close approach', deg: 0 },
  { label: 'Far side', deg: 150 },
  { label: 'Behind the Sun', deg: 180 },
];

/** "Trade with this desk": buy or sell, a size, and one button that says exactly what will happen. */
function Ticket({ body, onTrade }: { body: BodyId; onTrade: (side: 'buy' | 'sell', size: number) => void }) {
  const [side, setSide] = useState<'buy' | 'sell'>('sell');
  const [size, setSize] = useState(5);
  const clampSize = (n: number) => Math.max(1, Math.min(20, Math.round(n) || 1));
  const label = `${side === 'sell' ? 'Sell' : 'Buy'} ${size} ${side === 'sell' ? 'to' : 'from'} the ${BODY_LABEL[body]} desk`;
  return (
    <form
      className="ticket"
      aria-label="Trade with this desk"
      onSubmit={(e) => {
        e.preventDefault();
        onTrade(side, size);
      }}
    >
      <h3>Trade with this desk</h3>
      <div className="seg" role="group" aria-label="Buy or sell">
        <button type="button" aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>
          Buy Mars credits
        </button>
        <button type="button" aria-pressed={side === 'sell'} onClick={() => setSide('sell')}>
          Sell Mars credits
        </button>
      </div>
      <div className="stepper">
        <button type="button" className="quiet" aria-label="One fewer" onClick={() => setSize(clampSize(size - 1))}>
          −
        </button>
        <input
          type="number"
          min={1}
          max={20}
          value={size}
          aria-label="How many Mars credits"
          onChange={(e) => setSize(clampSize(Number(e.target.value)))}
        />
        <button type="button" className="quiet" aria-label="One more" onClick={() => setSize(clampSize(size + 1))}>
          +
        </button>
      </div>
      <button type="submit" className="primary">
        {label}
      </button>
      <p>
        Your order goes to all three banks at once.
        <br />
        {side === 'sell'
          ? 'The desk takes your credits, so the bank holds more.'
          : 'The desk hands you credits, so the bank holds fewer.'}
      </p>
    </form>
  );
}

/** "In its own words": the desk's sentence about itself, steady for at least four seconds at a time. */
function OwnWords({ text }: { text: string }) {
  const steady = useSteadyText(text);
  return (
    <section className="ownWords" aria-label="In its own words">
      <h3>In its own words</h3>
      <p key={steady.version} className="voiceText">
        {steady.text}
      </p>
    </section>
  );
}

function Inspector({
  arena,
  view,
  body,
  voice,
  onClose,
  onToggleLink,
  onTrade,
}: {
  arena: Arena;
  view: StrategyId;
  body: BodyId;
  voice: string;
  onClose: () => void;
  onToggleLink: (a: BodyId, b: BodyId) => void;
  onTrade: (side: 'buy' | 'sell', size: number) => void;
}) {
  const w = arena.worlds[view];
  const d = w.deskViews().find((v) => v.id === body)!;
  const newsAge = w.newsAge(body);
  return (
    <aside className="inspector glass" aria-label={`${BODY_LABEL[body]} desk`}>
      <header>
        <div>
          <h2>{BODY_LABEL[body]} desk</h2>
          <p>{STRATEGY[view].name}</p>
        </div>
        <button className="quiet" onClick={onClose} aria-label="Close desk details">
          Close
        </button>
      </header>
      <Ticket body={body} onTrade={onTrade} />
      <OwnWords text={voice} />
      <dl>
        <div>
          <dt>State</dt>
          <dd style={{ color: STATE[d.mode] }}>{MODE_LABEL[d.mode]}</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>
            {signed(d.pos)}
            {d.budget !== null && <em> of {d.budget} budget</em>}
          </dd>
        </div>
        <div>
          <dt>Bid and ask</dt>
          <dd>{d.bid === null || d.ask === null ? 'Not quoting' : `${d.bid.toFixed(5)} / ${d.ask.toFixed(5)}`}</dd>
        </div>
        <div>
          <dt>Local fair price</dt>
          <dd>{w.fair(body).toFixed(5)}</dd>
        </div>
        <div>
          <dt>Oldest remote news</dt>
          <dd>{newsAge.toFixed(1)} min</dd>
        </div>
        {d.leaseLeft !== null && (
          <div>
            <dt>Lease</dt>
            <dd>{d.leaseLeft > 0 ? `${d.leaseLeft.toFixed(0)} min left` : 'Expired'}</dd>
          </div>
        )}
        <div>
          <dt>Volume filled</dt>
          <dd>{d.volFilled}</dd>
        </div>
        {d.leaseLeft !== null && (
          <div>
            <dt>Netted with peers</dt>
            <dd>{d.netted}</dd>
          </div>
        )}
      </dl>
      <table>
        <caption>Same desk, each strategy</caption>
        <tbody>
          {STRATEGIES.map((s) => {
            const o = arena.worlds[s].deskViews().find((v) => v.id === body)!;
            return (
              <tr key={s} className={s === view ? 'current' : ''}>
                <th scope="row">
                  <i className="dot" style={{ background: STATE[o.mode] }} />
                  {STRATEGY[s].name}
                </th>
                <td>{signed(o.pos)}</td>
                <td>{o.volFilled} filled</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <section className="links" aria-label="Links">
        <h3>Links</h3>
        <div>
          {BODIES.filter((p) => p !== body).map((p) => {
            const cut = arena.worlds.leased.isCut(body, p);
            return (
              <button key={p} className="quiet" onClick={() => onToggleLink(body, p)}>
                {cut ? 'Restore' : 'Cut'} link to {BODY_LABEL[p]}
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

/** Scenario picker: a button that opens a short list. Escape or a click outside closes it. */
function ScenarioMenu({
  current,
  presenting,
  onChoose,
  onDemo,
}: {
  current: Scenario | null;
  presenting: boolean;
  onChoose: (s: Scenario | null) => void;
  onDemo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    // Put focus on the current choice so the list is usable straight from the keyboard.
    box.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const choose = (s: Scenario | null) => {
    setOpen(false);
    onChoose(s);
    trigger.current?.focus();
  };

  return (
    <div className="scenarioMenu" ref={box}>
      <button
        ref={trigger}
        className="scenarioButton"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>Scenario</span>
        <b>{presenting ? 'Guided demo' : current ? current.name : 'Free play'}</b>
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
          <path d="M1.5 3.5L5 7l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <div className="menuPanel glass" role="group" aria-label="Choose a scenario">
          <button
            aria-current={presenting}
            onClick={() => {
              setOpen(false);
              onDemo();
            }}
          >
            <b>Guided demo</b>
            <span>Seven steps, about three minutes. Press G to start, Space to move on.</span>
          </button>
          <button aria-current={!presenting && current === null} onClick={() => choose(null)}>
            <b>Free play</b>
            <span>Drive the storm, panic and Mars yourself.</span>
          </button>
          {SCENARIOS.map((s) => (
            <button key={s.id} aria-current={current?.id === s.id} onClick={() => choose(s)}>
              <b>{s.name}</b>
              <span>{s.summary}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Caption, a scrubbable track with a tick per event and bands where the storm is on, and elapsed time. */
function Timeline({ director, onJump }: { director: Director; onJump: (min: number) => void }) {
  const s = director.scenario;
  const now = Math.min(director.arena.now, s.durationMin);
  const pct = (t: number) => `${(100 * t) / s.durationMin}%`;

  const bands: [number, number][] = [];
  let since: number | null = null;
  for (const e of s.events) {
    if (e.kind !== 'blackout') continue;
    if (e.on && since === null) since = e.at;
    if (!e.on && since !== null) {
      bands.push([since, e.at]);
      since = null;
    }
  }
  if (since !== null) bands.push([since, s.durationMin]);

  const jumpAt = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onJump(f * s.durationMin);
  };
  const key = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const t = now + (e.key === 'ArrowRight' ? 10 : -10);
    onJump(Math.max(0, Math.min(s.durationMin, t)));
  };

  return (
    <div className="timeline">
      <p className="caption" aria-live="polite">
        {director.done ? 'Finished.' : director.caption}
      </p>
      <div
        className="track"
        role="slider"
        tabIndex={0}
        aria-label={`${s.name} timeline`}
        aria-valuemin={0}
        aria-valuemax={s.durationMin}
        aria-valuenow={Math.round(now)}
        aria-valuetext={`${clock(now)} of ${clock(s.durationMin)}`}
        onClick={(e) => jumpAt(e.clientX, e.currentTarget)}
        onKeyDown={key}
      >
        <i className="rail" />
        {bands.map(([a, b]) => (
          <i key={a} className="band" style={{ left: pct(a), width: pct(b - a) }} />
        ))}
        <i className="done" style={{ width: pct(now) }} />
        {s.events
          .filter((e) => e.kind !== 'note')
          .map((e, i) => (
            <i key={i} className="tick" style={{ left: pct(e.at) }} />
          ))}
        <i className="head" style={{ left: pct(now) }} />
      </div>
      <p className="time">
        {clock(now)} <span>of {clock(s.durationMin)}</span>
      </p>
    </div>
  );
}

export function App() {
  const [seed, setSeed] = useState(42);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<StrategyId>('leased');
  const [selected, setSelected] = useState<BodyId | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [followed, setFollowed] = useState<FollowedTrade | null>(null);
  const [tab, setTab] = useState<'trade' | 'banks'>('banks');
  /** The speed to go back to when following ends, if following slowed things down. */
  const savedSpeed = useRef<number | null>(null);
  const followingRef = useRef<number | null>(null);
  followingRef.current = followed?.trade ?? null;
  const bottom = useRef<HTMLDivElement>(null);
  const banksHeight = useRef(0);
  const [, repaint] = useReducer((n: number) => n + 1, 0);
  // Presenter mode: the guided demo.
  const guide = useRef<Guide | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [caption, setCaption] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  /** Bumped on each demo start, so the desk panel's ticket starts again at "sell 5". */
  const [demoRun, setDemoRun] = useState(0);
  const [allVoices, setAllVoices] = useState(false);
  const demoStart = useRef(0);
  const demoBeat = useRef(-1);
  /** Central Mars desk's customers served when the storm started and when it passed. */
  const marsServed = useRef<{ storm?: number; recovery?: number }>({});
  const lastSpace = useRef(0);

  const series = useRef<number[] | undefined>(undefined);
  const arena = useRef<Arena | null>(null);
  if (!arena.current) arena.current = new Arena(seed, { separationDeg: 150 });
  const director = useRef<Director | null>(null);
  const partial = useRef(0); // Simulated minutes owed but not yet stepped, for smooth message motion.
  const live = useRef({
    running,
    speed,
    view,
    presenting,
    onLines: (_l: Line[]) => {},
    onGuideFrame: (_g: Guide) => {},
    startDemo: () => {},
    leaveDemo: () => {},
    hasResults: false,
  });
  live.current = { ...live.current, running, speed, view, presenting };

  useEffect(() => {
    let id = 0;
    let last = performance.now();
    let lastPaint = 0;
    const frame = (t: number) => {
      const real = Math.min(0.1, (t - last) / 1000);
      last = t;
      const a = arena.current!;
      const d = director.current;
      const g = guide.current;
      const realSec = (t - demoStart.current) / 1000;
      if (live.current.running) {
        const dt = a.worlds.leased.cfg.dt;
        partial.current += real * (g ? g.speed : live.current.speed);
        let n = 0;
        while (partial.current >= dt && n < 400) {
          if (d?.done) {
            // The scenario has finished: stop here, and leave the play button to replay it.
            live.current.running = false;
            partial.current = 0;
            setRunning(false);
            break;
          }
          a.step();
          d?.advance();
          if (g) live.current.onLines(g.tick(realSec));
          partial.current -= dt;
          n++;
        }
        if (n === 400) partial.current = 0;
      }
      if (g) {
        live.current.onLines(g.tick(realSec));
        live.current.onGuideFrame(g);
      }
      if (t - lastPaint > 120) {
        lastPaint = t;
        repaint();
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, []);

  /** Switch to "Your trade" at the same height as "The banks", so the canvas above keeps its size. */
  const showTrade = () => {
    if (banksHeight.current === 0 && bottom.current) banksHeight.current = bottom.current.offsetHeight;
    setTab('trade');
  };

  const endFollow = () => {
    if (savedSpeed.current !== null) setSpeed(savedSpeed.current);
    savedSpeed.current = null;
    setFollowed(null);
    setTab('banks');
  };

  /** Replacing the bank loses any visitor trades, so stop following. */
  const swapIn = (run: { arena: Arena; director: Director } | Arena) => {
    if (followingRef.current !== null) endFollow();
    if (run instanceof Arena) {
      arena.current = run;
      director.current = null;
    } else {
      arena.current = run.arena;
      director.current = run.director;
    }
    partial.current = 0;
    repaint();
  };

  // Replay real prices if public/earth.json holds any (see scripts/convert_sgx.py); otherwise use the synthetic feed.
  useEffect(() => {
    fetch('earth.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((mids: unknown) => {
        if (!Array.isArray(mids) || mids.length < 2) return;
        series.current = mids as number[];
        const d = director.current;
        if (d) {
          swapIn(startScenario(d.scenario, undefined, series.current));
          return;
        }
        const old = arena.current!.worlds.leased;
        const fresh = new Arena(seed, {
          separationDeg: separationDeg(old.orbit),
          earthSeries: series.current,
        });
        fresh.setBlackout(old.blackout);
        fresh.setPanic(old.panic);
        swapIn(fresh);
      })
      .catch(() => undefined);
    // Runs once on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Space bar plays and pauses, unless a control has focus.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.target !== document.body || live.current.presenting) return;
      e.preventDefault();
      setRunning((r) => !r);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const getWorld = useCallback(() => arena.current!.worlds[live.current.view], []);
  const getNow = useCallback(() => arena.current!.now + partial.current, []);
  const getFollowing = useCallback(() => followingRef.current, []);
  /** While following a trade, each planet says what its desk believes the bank holds. */
  const getBelieves = useCallback((): PerBody<string | null> | null => {
    if (followingRef.current === null && !live.current.presenting) return null;
    const w = arena.current!.worlds[live.current.view];
    return perBody((b) => {
      const v = w.desks[b].believedTotal();
      if (!v) return null;
      return v.low === v.high
        ? `thinks the bank holds ${signed(v.low)}`
        : `thinks the bank holds ${signed(v.low)} to ${signed(v.high)}`;
    });
  }, []);
  const pause = useCallback(() => {
    const was = live.current.running;
    live.current.running = false;
    setRunning(false);
    return was;
  }, []);
  const resume = useCallback(() => {
    live.current.running = true;
    setRunning(true);
  }, []);
  /** In the demo a stray click on a message must not stall things: hover still describes it, but nothing pins. */
  const canPin = useCallback(() => !live.current.presenting, []);

  const a = arena.current;
  const lead = a.worlds.leased;
  const dir = director.current;
  const scenario = scenarioId ? (SCENARIOS.find((s) => s.id === scenarioId) ?? null) : null;
  // Read the controls' state from the simulation, so a scenario changing them is shown truthfully.
  const blackout = lead.blackout;
  const panic = lead.panic;
  const sep = Math.round(separationDeg(lead.orbit));

  const placeTrade = (at: BodyId, side: 'buy' | 'sell', size: number) => {
    // A finished scenario carries on as free play, so the trade can play out.
    if (dir?.done) {
      director.current = null;
      setScenarioId(null);
    }
    const trade = a.placeTrade(at, side, size);
    setFollowed({ trade, at, side, size });
    showTrade();
    const g = guide.current;
    if (g) {
      // In the demo the guide alone sets the speed, and only the first trade drives the script.
      if (g.trade === null) g.tradePlaced(trade);
      return;
    }
    if (speed > 1 && savedSpeed.current === null) {
      savedSpeed.current = speed;
      setSpeed(1);
    }
    if (!running) {
      live.current.running = true;
      setRunning(true);
    }
  };

  const toggleLink = (x: BodyId, y: BodyId) => {
    a.toggleCut(x, y);
    repaint();
  };

  const chooseScenario = (s: Scenario | null) => {
    if (!s) {
      // Free play: keep the bank exactly as it is, just stop following the script.
      director.current = null;
      setScenarioId(null);
      return;
    }
    setSeed(s.seed);
    setScenarioId(s.id);
    setSelected(null);
    swapIn(startScenario(s, undefined, series.current));
    setRunning(true);
  };

  const restart = () => {
    if (scenario) {
      swapIn(startScenario({ ...scenario, seed }, undefined, series.current));
      return;
    }
    const fresh = new Arena(seed, { separationDeg: sep, earthSeries: series.current });
    fresh.setBlackout(blackout);
    fresh.setPanic(panic);
    swapIn(fresh);
  };

  const jump = (min: number) => {
    if (!scenario) return;
    swapIn(runScenario({ ...scenario, seed }, min, undefined, series.current));
  };

  const play = () => {
    if (dir?.done && scenario) {
      swapIn(startScenario({ ...scenario, seed }, undefined, series.current));
      setRunning(true);
      return;
    }
    setRunning(!running);
  };

  // ---- Presenter mode: the guided demo ----------------------------------------------------

  /** A fresh bank, warmed up for an hour, with the guide at its first beat. */
  const startDemo = () => {
    stopVoice();
    const fresh = new Arena(GUIDE_SEED, { separationDeg: GUIDE_SEPARATION, earthSeries: series.current });
    fresh.run(GUIDE_WARMUP);
    swapIn(fresh);
    setScenarioId(null);
    setSeed(GUIDE_SEED);
    guide.current = new Guide(fresh);
    demoStart.current = performance.now();
    demoBeat.current = -1;
    marsServed.current = {};
    setPresenting(true);
    setResults(null);
    setCaption('');
    setDemoRun((n) => n + 1);
    setSelected('mars');
    setView('leased');
    setTab('banks');
    live.current.running = true;
    setRunning(true);
    void prepareVoice(GUIDE_BEATS.flatMap((b) => [b.id, `${b.id}-settle`]));
  };

  /** Back to free play with the bank exactly as it stands. */
  const leaveDemo = () => {
    stopVoice();
    guide.current = null;
    setPresenting(false);
    setCaption('');
    setResults(null);
  };

  /** Lines the guide wants said: the caption shows the latest; the voice says it. */
  live.current.onLines = (lines: Line[]) => {
    const l = lines[lines.length - 1];
    if (!l) return;
    setCaption(l.caption);
    speak(l.id, l.voice);
  };

  /** Once a frame in the demo: follow the visitor's trade, react to a new beat, and show the results at the end. */
  live.current.onGuideFrame = (g: Guide) => {
    const w = arena.current!.worlds;
    if (g.trade !== null && followingRef.current !== g.trade && followed?.trade !== g.trade && !results) {
      const placed = w.leased.trace(g.trade)[0];
      if (placed?.kind === 'placed' && demoBeat.current <= 1) {
        setFollowed({ trade: g.trade, at: placed.body, side: placed.side, size: placed.size });
        showTrade();
      }
    }
    if (g.index !== demoBeat.current) {
      demoBeat.current = g.index;
      const b = g.beat;
      if (b.view) setView(b.view);
      if (b.id === 'storm') marsServed.current.storm = w.central.desks.mars.served;
      if (b.id === 'panic') setTab('banks');
      if (b.id === 'recovery') {
        marsServed.current.recovery = w.central.desks.mars.served;
        if (followingRef.current !== null) showTrade();
      }
    }
    if (g.finished && !results) {
      live.current.running = false;
      setRunning(false);
      const m = marsServed.current;
      setResults(readResults(arena.current!, g.trade, (m.recovery ?? 0) - (m.storm ?? 0)));
    }
  };

  // Keys. In presenter mode, space moves the demo on (captured before any focused button sees it), M mutes and
  // Escape leaves. Anywhere else, G starts the demo.
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const key = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const g = guide.current;
      if (!g) {
        if (e.key === 'g' || e.key === 'G') live.current.startDemo();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        const now = performance.now();
        if (now - lastSpace.current < 400) return;
        lastSpace.current = now;
        if (live.current.hasResults) {
          live.current.startDemo();
          return;
        }
        if (speaking()) stopVoice();
        g.space();
        live.current.onLines(g.tick((now - demoStart.current) / 1000));
        repaint();
      } else if (e.key === 'm' || e.key === 'M') {
        const m = !isMuted();
        setMuted(m);
        setMutedState(m);
      } else if (e.key === 'Escape') {
        live.current.leaveDemo();
      }
    };
    window.addEventListener('keydown', key, { capture: true });
    return () => window.removeEventListener('keydown', key, { capture: true });
  }, []);
  live.current.startDemo = startDemo;
  live.current.leaveDemo = leaveDemo;
  live.current.hasResults = results !== null;

  // ?demo in the address starts the guided demo straight away.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('demo')) live.current.startDemo();
  }, []);

  const g = presenting ? guide.current : null;
  // Each desk's words about itself, for the bank on the canvas: templated, from what that desk alone knows.
  const voices = perBody((b) => deskSays(deskBriefing(a.worlds[view], b)));
  let bubbleBodies: BodyId[];
  if (g) {
    const id = g.beat.id;
    bubbleBodies = id === 'silence' || id === 'panic' || id === 'alone' ? ['mars'] : id === 'recovery' ? ['earth'] : [];
  } else bubbleBodies = allVoices ? [...BODIES] : selected ? [selected] : [];
  const marsLink = lead.links().find((l) => l.a === 'earth' && l.b === 'mars')!;

  return (
    <div className={dir ? 'app hasTimeline' : 'app'}>
      <header className="top">
        <h1>Lightspeed FX</h1>
        <div className="readouts">
          <div>
            <span>Elapsed</span>
            <b>{clock(a.now)}</b>
          </div>
          <div>
            <span>Earth price</span>
            <b>{lead.fair('earth').toFixed(5)}</b>
          </div>
          <div>
            <span>Mars price</span>
            <b>{lead.fair('mars').toFixed(5)}</b>
          </div>
          <div className={marsLink.open ? '' : 'alert'}>
            <span>Earth to Mars</span>
            <b>
              {marsLink.open
                ? `${lightDelayMin(lead.orbit, 'earth', 'mars').toFixed(1)} min`
                : marsLink.cut
                  ? 'Link cut'
                  : 'No signal'}
            </b>
          </div>
        </div>
        {(followed || presenting) && (
          <div className="readouts holds">
            <div>
              <span>The bank really holds</span>
              <b>{signed(a.worlds[view].totalPosition())}</b>
            </div>
          </div>
        )}
        <ScenarioMenu
          current={scenario}
          presenting={presenting}
          onChoose={(s) => {
            if (presenting) leaveDemo();
            chooseScenario(s);
          }}
          onDemo={startDemo}
        />
        <div className="session">
          <label>
            Seed
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
          </label>
          <button className="quiet" onClick={restart}>
            Restart
          </button>
        </div>
      </header>

      {dir && !presenting && <Timeline director={dir} onJump={jump} />}

      <main className="stage">
        <SolarView
          getWorld={getWorld}
          getNow={getNow}
          selected={selected}
          onSelect={setSelected}
          onToggleLink={toggleLink}
          getFollowing={getFollowing}
          getBelieves={getBelieves}
          onPause={pause}
          onResume={resume}
          canPin={canPin}
          voices={voices}
          bubbleBodies={bubbleBodies}
          allVoices={presenting ? null : { on: allVoices, toggle: () => setAllVoices(!allVoices) }}
        />
        {!presenting && (
          <p className="hint">Click a planet to trade with its desk. Hover a message to read it. Click a link to cut it.</p>
        )}
        {selected && (
          <Inspector
            key={`${selected}-${demoRun}`}
            arena={a}
            view={view}
            body={selected}
            voice={voices[selected]}
            onClose={() => setSelected(null)}
            onToggleLink={toggleLink}
            onTrade={(side, size) => placeTrade(selected, side, size)}
          />
        )}

        {presenting && g && (
          <>
            <CaptionBar text={caption} />
            <PresenterHint guide={g} muted={muted} />
            {results && <ResultsCard r={results} />}
          </>
        )}
        {!presenting && (
          <div className="dock glass" role="toolbar" aria-label="Simulation controls">
            <button
              className="play"
              onClick={play}
              aria-label={running ? 'Pause' : dir?.done ? 'Play again from the start' : 'Play'}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                {running ? <path d="M3 2h3.5v12H3zM9.5 2H13v12H9.5z" /> : <path d="M4 2l10 6-10 6z" />}
              </svg>
            </button>
            <div className="seg" role="group" aria-label="Simulated minutes per second">
              {SPEEDS.map((s) => (
                <button key={s.value} aria-pressed={s.value === speed} onClick={() => setSpeed(s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
            <span className="rule" />
            <div className="seg" role="group" aria-label="Where Mars is">
              {PRESETS.map((p) => (
                <button key={p.deg} aria-pressed={p.deg === sep} onClick={() => a.setSeparation(p.deg)}>
                  {p.label}
                </button>
              ))}
            </div>
            <label className="angle">
              <input
                type="range"
                min={0}
                max={180}
                value={sep}
                aria-label="Angle between Earth and Mars"
                onChange={(e) => {
                  a.setSeparation(Number(e.target.value));
                  repaint();
                }}
              />
              <output>{sep}°</output>
            </label>
            <span className="rule" />
            <button
              className="event"
              aria-pressed={blackout}
              onClick={() => {
                a.setBlackout(!blackout);
                repaint();
              }}
            >
              <i className="dot" />
              Solar storm
            </button>
            <button
              className="event"
              aria-pressed={panic}
              onClick={() => {
                a.setPanic(!panic);
                repaint();
              }}
            >
              <i className="dot" />
              Market panic
            </button>
          </div>
        )}
      </main>

      <div
        className="bottom"
        ref={bottom}
        style={tab === 'trade' && banksHeight.current > 0 ? { height: banksHeight.current } : undefined}
      >
        <div className="tabs" role="tablist" aria-label="Bottom panel">
          {(
            [
              ['trade', 'Your trade'],
              ['banks', 'The banks'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls="bottom-panel"
              onClick={() => {
                if (tab === 'banks' && bottom.current) banksHeight.current = bottom.current.offsetHeight;
                setTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div id="bottom-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="tabPanel">
          {tab === 'banks' ? (
            <Intel
              arena={a}
              view={view}
              selected={selected}
              onView={setView}
              onSelect={(s, b) => {
                setView(s);
                setSelected(b);
              }}
            />
          ) : (
            <Story arena={a} followed={followed} view={view} onView={setView} onDone={endFollow} />
          )}
        </div>
      </div>
    </div>
  );
}
