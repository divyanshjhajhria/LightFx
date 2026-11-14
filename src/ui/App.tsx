import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { lightDelayMin, separationDeg } from '../sim/orbits';
import { Director, runScenario, startScenario } from '../sim/scenario';
import type { Scenario } from '../sim/scenario';
import { SCENARIOS } from '../sim/scenarios';
import { BODIES, STRATEGIES } from '../sim/types';
import type { BodyId, StrategyId } from '../sim/types';
import { Arena } from '../sim/world';
import { Intel } from './Intel';
import { SolarView } from './SolarView';
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

function Inspector({
  arena,
  view,
  body,
  onClose,
  onToggleLink,
}: {
  arena: Arena;
  view: StrategyId;
  body: BodyId;
  onClose: () => void;
  onToggleLink: (a: BodyId, b: BodyId) => void;
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
function ScenarioMenu({ current, onChoose }: { current: Scenario | null; onChoose: (s: Scenario | null) => void }) {
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
        <b>{current ? current.name : 'Free play'}</b>
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
          <path d="M1.5 3.5L5 7l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <div className="menuPanel glass" role="group" aria-label="Choose a scenario">
          <button aria-current={current === null} onClick={() => choose(null)}>
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
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  const series = useRef<number[] | undefined>(undefined);
  const arena = useRef<Arena | null>(null);
  if (!arena.current) arena.current = new Arena(seed, { separationDeg: 150 });
  const director = useRef<Director | null>(null);
  const partial = useRef(0); // Simulated minutes owed but not yet stepped, for smooth message motion.
  const live = useRef({ running, speed, view });
  live.current = { running, speed, view };

  useEffect(() => {
    let id = 0;
    let last = performance.now();
    let lastPaint = 0;
    const frame = (t: number) => {
      const real = Math.min(0.1, (t - last) / 1000);
      last = t;
      const a = arena.current!;
      const d = director.current;
      if (live.current.running) {
        const dt = a.worlds.leased.cfg.dt;
        partial.current += real * live.current.speed;
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
          partial.current -= dt;
          n++;
        }
        if (n === 400) partial.current = 0;
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

  const swapIn = (run: { arena: Arena; director: Director } | Arena) => {
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
      if (e.code !== 'Space' || e.target !== document.body) return;
      e.preventDefault();
      setRunning((r) => !r);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const getWorld = useCallback(() => arena.current!.worlds[live.current.view], []);
  const getNow = useCallback(() => arena.current!.now + partial.current, []);
  const getFollowing = useCallback(() => null, []);
  const getBelieves = useCallback(() => null, []);
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

  const a = arena.current;
  const lead = a.worlds.leased;
  const dir = director.current;
  const scenario = scenarioId ? (SCENARIOS.find((s) => s.id === scenarioId) ?? null) : null;
  // Read the controls' state from the simulation, so a scenario changing them is shown truthfully.
  const blackout = lead.blackout;
  const panic = lead.panic;
  const sep = Math.round(separationDeg(lead.orbit));

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
        <ScenarioMenu current={scenario} onChoose={chooseScenario} />
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

      {dir && <Timeline director={dir} onJump={jump} />}

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
        />
        <p className="hint">Scroll to zoom, drag to pan. Click a planet to open its desk, or a link to cut it.</p>
        {selected && (
          <Inspector arena={a} view={view} body={selected} onClose={() => setSelected(null)} onToggleLink={toggleLink} />
        )}

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
      </main>

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
    </div>
  );
}
