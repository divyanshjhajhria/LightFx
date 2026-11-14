// "More": everything secondary, out of the way of the four read-outs. A glass panel under its button, reachable by
// keyboard; Escape or a click elsewhere closes it.
import { useEffect, useRef, useState } from 'react';

export interface AgentOption {
  /** The mode's id, passed back on choosing. */
  id: string;
  label: string;
  /** Why it cannot be chosen, or null. */
  why: string | null;
  description: string;
}

interface Props {
  earthPrice: number;
  marsPrice: number;
  seed: number;
  onSeed: (n: number) => void;
  onRestart: () => void;
  showNews: boolean;
  onShowNews: (on: boolean) => void;
  /** Null in the guided demo, where the demo chooses which desks speak. */
  allVoices: { on: boolean; toggle: () => void } | null;
  onResetView: () => void;
  /** Who runs our desks; null if this build has no agents. */
  agents: { current: string; options: AgentOption[]; locked: boolean; onChoose: (id: string) => void } | null;
  onOpenMap: () => void;
}

export function MorePanel(p: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key, { capture: true });
    box.current?.querySelector<HTMLElement>('.morePanel button, .morePanel input')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key, { capture: true });
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="more" ref={box}>
      <button ref={button} className="moreButton" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        More
      </button>
      {open && (
        <div className="morePanel glass" role="dialog" aria-label="More">
          <section>
            <h3>Prices</h3>
            <dl className="moreFigures">
              <div>
                <dt>Earth price</dt>
                <dd>{p.earthPrice.toFixed(5)}</dd>
              </div>
              <div>
                <dt>Mars price</dt>
                <dd>{p.marsPrice.toFixed(5)}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h3>This run</h3>
            <div className="moreRow">
              <label>
                Seed
                <input type="number" value={p.seed} onChange={(e) => p.onSeed(Number(e.target.value) || 0)} />
              </label>
              {confirming ? (
                <span className="confirm">
                  <span>Restart and lose this run?</span>
                  <button
                    className="quiet strong"
                    onClick={() => {
                      p.onRestart();
                      setConfirming(false);
                      close();
                    }}
                  >
                    Restart
                  </button>
                  <button className="quiet" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="quiet" onClick={() => setConfirming(true)}>
                  Restart
                </button>
              )}
            </div>
          </section>

          <section>
            <h3>On the canvas</h3>
            <div className="moreToggles">
              <button className="quiet" aria-pressed={p.showNews} onClick={() => p.onShowNews(!p.showNews)}>
                {p.showNews ? 'Hide market news' : 'Show market news'}
              </button>
              {p.allVoices && (
                <button className="quiet" aria-pressed={p.allVoices.on} onClick={p.allVoices.toggle}>
                  {p.allVoices.on ? 'Hide desk voices' : 'Show all desk voices'}
                </button>
              )}
              <button
                className="quiet"
                onClick={() => {
                  p.onResetView();
                  close();
                }}
              >
                Reset view
              </button>
            </div>
          </section>

          {p.agents && (
            <section>
              <h3>Our desks run by</h3>
              <div className="moreChoices" role="radiogroup" aria-label="Our desks run by">
                {p.agents.options.map((o) => (
                  <button
                    key={o.id}
                    role="radio"
                    aria-checked={o.id === p.agents!.current}
                    disabled={o.why !== null || p.agents!.locked}
                    onClick={() => p.agents!.onChoose(o.id)}
                  >
                    <b>{o.label}</b>
                    <span>{o.why ? `Not available: ${o.why}.` : o.description}</span>
                  </button>
                ))}
                {p.agents.locked && <p className="moreNote">The guided demo chooses this. Leave it with Escape to change.</p>}
              </div>
            </section>
          )}

          <section>
            <button
              className="quiet"
              onClick={() => {
                close();
                p.onOpenMap();
              }}
            >
              Open the survival map
            </button>
          </section>

          <section>
            <h3>Keys</h3>
            <dl className="moreKeys">
              <div>
                <dt>
                  <kbd>Space</kbd>
                </dt>
                <dd>Play or pause; in the guided demo, move on</dd>
              </div>
              <div>
                <dt>
                  <kbd>G</kbd>
                </dt>
                <dd>Start the guided demo</dd>
              </div>
              <div>
                <dt>
                  <kbd>M</kbd>
                </dt>
                <dd>Mute or unmute the demo's voice</dd>
              </div>
              <div>
                <dt>
                  <kbd>Escape</kbd>
                </dt>
                <dd>Leave the demo, or close a panel</dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
