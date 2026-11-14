import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { lightDelayMin } from '../sim/orbits';
import { STRATEGIES } from '../sim/types';
import type { BodyId, StrategyId } from '../sim/types';
import { Arena } from '../sim/world';
import { Intel } from './Intel';
import { SolarView } from './SolarView';
import { BODY_LABEL, MODE_LABEL, STATE, STRATEGY, signed } from './theme';

const SPEEDS = [1, 4, 16, 60];
const PRESETS = [
  { label: 'Close approach', deg: 0 },
  { label: 'Far side', deg: 150 },
  { label: 'Behind the Sun', deg: 180 },
];

const clock = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`;

function Inspector({ arena, view, body, onClose }: { arena: Arena; view: StrategyId; body: BodyId; onClose: () => void }) {
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
    </aside>
  );
}

export function App() {
  const [seed, setSeed] = useState(42);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(4);
  const [sep, setSep] = useState(150);
  const [blackout, setBlackout] = useState(false);
  const [panic, setPanic] = useState(false);
  const [view, setView] = useState<StrategyId>('leased');
  const [selected, setSelected] = useState<BodyId | null>(null);
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  const series = useRef<number[] | undefined>(undefined);
  const arena = useRef<Arena | null>(null);
  if (!arena.current) arena.current = new Arena(seed, { separationDeg: sep });
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
      if (live.current.running) {
        const dt = a.worlds.leased.cfg.dt;
        partial.current += real * live.current.speed;
        let n = 0;
        while (partial.current >= dt && n < 400) {
          a.step();
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

  // Replay real prices if public/earth.json holds any (see scripts/convert_sgx.py); otherwise use the synthetic feed.
  useEffect(() => {
    fetch('earth.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((mids: unknown) => {
        if (!Array.isArray(mids) || mids.length < 2) return;
        series.current = mids as number[];
        const old = arena.current!.worlds.leased;
        arena.current = new Arena(seed, { separationDeg: sep, earthSeries: series.current });
        arena.current.setBlackout(old.blackout);
        arena.current.setPanic(old.panic);
        partial.current = 0;
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

  const a = arena.current;
  const lead = a.worlds.leased;
  const changeSep = (deg: number) => {
    setSep(deg);
    a.setSeparation(deg);
  };
  const toggleBlackout = () => {
    setBlackout(!blackout);
    a.setBlackout(!blackout);
  };
  const togglePanic = () => {
    setPanic(!panic);
    a.setPanic(!panic);
  };
  const restart = () => {
    arena.current = new Arena(seed, { separationDeg: sep, earthSeries: series.current });
    arena.current.setBlackout(blackout);
    arena.current.setPanic(panic);
    partial.current = 0;
    repaint();
  };
  const marsLink = lead.links().find((l) => l.a === 'earth' && l.b === 'mars')!;

  return (
    <div className="app">
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
            <b>{marsLink.open ? `${lightDelayMin(lead.orbit, 'earth', 'mars').toFixed(1)} min` : 'No signal'}</b>
          </div>
        </div>
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

      <main className="stage">
        <SolarView getWorld={getWorld} getNow={getNow} selected={selected} onSelect={setSelected} />
        <p className="hint">Scroll to zoom, drag to pan, click a planet to open its desk.</p>
        {selected && <Inspector arena={a} view={view} body={selected} onClose={() => setSelected(null)} />}

        <div className="dock glass" role="toolbar" aria-label="Simulation controls">
          <button className="play" onClick={() => setRunning(!running)} aria-label={running ? 'Pause' : 'Play'}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              {running ? <path d="M3 2h3.5v12H3zM9.5 2H13v12H9.5z" /> : <path d="M4 2l10 6-10 6z" />}
            </svg>
          </button>
          <div className="seg" role="group" aria-label="Simulated minutes per second">
            {SPEEDS.map((s) => (
              <button key={s} aria-pressed={s === speed} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
          <span className="rule" />
          <div className="seg" role="group" aria-label="Where Mars is">
            {PRESETS.map((p) => (
              <button key={p.deg} aria-pressed={p.deg === sep} onClick={() => changeSep(p.deg)}>
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
              onChange={(e) => changeSep(Number(e.target.value))}
            />
            <output>{sep}°</output>
          </label>
          <span className="rule" />
          <button className="event" aria-pressed={blackout} onClick={toggleBlackout}>
            <i className="dot" />
            Solar storm
          </button>
          <button className="event" aria-pressed={panic} onClick={togglePanic}>
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
