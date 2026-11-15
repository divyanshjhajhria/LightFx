import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { MARKETS, MARKET_NAME, SEPARATIONS, STORM_MINUTES, stormLabel } from '../sim/sweep';
import type { CellParams, CellResult, Market, SweepFile } from '../sim/sweep';
import { STRATEGIES } from '../sim/types';
import type { StrategyId } from '../sim/types';
import { headline, summarise } from './sweepSummary';
import type { SweepSummary } from './sweepSummary';
import { PART_LABEL, missedParts } from './missedBreakdown';
import { ALERT_RGB, SHORT_NAME, STRATEGY, WARM, dollars } from './theme';

type Measure = 'minutes' | 'served';

/** The bank that did worst in a cell: most minutes over the limit, then fewest customers served. */
export function worstBank(c: CellResult): StrategyId {
  return [...STRATEGIES].sort(
    (a, b) => c.banks[b].minutesOverMean - c.banks[a].minutesOverMean || c.banks[a].servedPctMean - c.banks[b].servedPctMean,
  )[0];
}

const conditions = (c: CellResult) =>
  `${MARKET_NAME[c.market]}, ${c.stormMinutes === 0 ? 'no storm' : `${stormLabel(c.stormMinutes)} storm`}, Mars ${Math.round(c.delayMin)} min away`;

interface Readout {
  cell: CellResult;
  bank: StrategyId;
  /** The cell's left and right edges and top, so the read-out can sit beside it on whichever side has room. */
  left: number;
  right: number;
  y: number;
}

function Heatmap({
  cells,
  bank,
  measure,
  maxMinutes,
  onShow,
  onPlay,
}: {
  cells: CellResult[];
  bank: StrategyId;
  measure: Measure;
  /** Largest minutes-over in this market across all three banks, so the banks share one scale. */
  maxMinutes: number;
  onShow: (r: Readout | null) => void;
  onPlay: (c: CellResult) => void;
}) {
  const at = (sep: number, storm: number) => cells.find((c) => c.separationDeg === sep && c.stormMinutes === storm)!;
  // Farthest at the top, closest at the bottom.
  const rows = [...SEPARATIONS].sort((a, b) => b - a);
  const title = measure === 'minutes' ? 'Minutes over the limit' : 'Customers served';
  return (
    <table className="heatmap">
      <caption>
        {STRATEGY[bank].name}: {title.toLowerCase()}
      </caption>
      <thead>
        <tr>
          <th scope="col" className="corner">
            Mars is
          </th>
          {STORM_MINUTES.map((m) => (
            <th key={m} scope="col">
              {stormLabel(m)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((sep) => (
          <tr key={sep}>
            <th scope="row">{Math.round(at(sep, 0).delayMin)} min</th>
            {STORM_MINUTES.map((m) => {
              const c = at(sep, m);
              const r = c.banks[bank];
              let style: CSSProperties;
              let text: string;
              let dark = false;
              if (measure === 'minutes') {
                const v = r.minutesOverMean;
                // Never round a real breach down to a zero.
                text = v > 0 && v < 0.5 ? '<1' : String(Math.round(v));
                style = v > 0 ? { background: `rgba(${ALERT_RGB},${(0.85 * v) / Math.max(maxMinutes, 1e-9)})` } : {};
              } else {
                const op = 0.05 + 0.55 * (r.servedPctMean / 100);
                text = `${Math.round(r.servedPctMean)}%`;
                // Dark text once the fill is light enough that it reads better than warm white (the two cross at 0.45, ~4.1:1).
                dark = op >= 0.45;
                style = { background: `rgba(${WARM},${op})` };
              }
              const show = (el: HTMLElement) => {
                const b = el.getBoundingClientRect();
                onShow({ cell: c, bank, left: b.left, right: b.right, y: b.top });
              };
              return (
                <td key={m}>
                  <button
                    className={`hcell ${measure === 'minutes' && r.minutesOverMean === 0 ? 'zero' : ''} ${dark ? 'dark' : ''}`}
                    style={style}
                    aria-label={`${conditions(c)}: ${STRATEGY[bank].name}, ${title.toLowerCase()} ${text}. Play storm 1 of ${c.runs}.`}
                    onMouseEnter={(e) => show(e.currentTarget)}
                    onFocus={(e) => show(e.currentTarget)}
                    onMouseLeave={() => onShow(null)}
                    onBlur={() => onShow(null)}
                    onClick={() => onPlay(c)}
                  >
                    {text}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Where the missed customers went", for the market on show: one 100% bar per bank, storms only. */
function MissedBars({ figures }: { figures: SweepSummary['overall'] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const rows = STRATEGIES.map((b) => ({ b, parts: missedParts(b, figures.banks[b]) }));
  if (rows.some((r) => !r.parts)) return null;
  // A percentage is written on a part only when the part is wide enough to hold it.
  const fits = (pct: number) => (width * pct) / 100 >= 44;
  return (
    <section className="missed" aria-label="Where the missed customers went">
      <div className="missedRows" ref={box}>
        {rows.map(({ b, parts }) => (
          <div className="missedRow" key={b}>
            <span className="missedName">{SHORT_NAME[b]}</span>
            <span
              className="missedBar"
              role="img"
              aria-label={`${STRATEGY[b].name}: ${parts!.map((p) => `${p.label} ${p.pct.toFixed(1)}%`).join(', ')}`}
            >
              {parts!.map((p) => (
                <i key={p.key} className={`part ${p.key}`} style={{ flexBasis: `${p.pct}%` }}>
                  {fits(p.pct) ? `${p.pct.toFixed(1)}%` : ''}
                </i>
              ))}
            </span>
          </div>
        ))}
      </div>
      <p className="missedKey">
        <b>Where the missed customers went</b>
        {(['served', 'price', 'room', 'safe', 'noAnswer'] as const).map((k) => (
          <span key={k}>
            <i className={`part ${k}`} />
            {PART_LABEL[k]}
          </span>
        ))}
        <span className="missedNote">Storms only. Price: the customer would not take the quoted price.</span>
      </p>
    </section>
  );
}

/**
 * The survival map: thousands of simulated storms across distance, storm length and market, read as heatmaps of how
 * long each bank was over its limit and how many customers it served. Every figure comes from sweep.json.
 */
export function SurvivalMap({ onBack, onPlay }: { onBack: () => void; onPlay: (p: CellParams, worst: StrategyId) => void }) {
  const [data, setData] = useState<SweepFile | null | 'missing'>(null);
  const [market, setMarket] = useState<Market>('panic');
  const [readout, setReadout] = useState<Readout | null>(null);
  // The read-out's own height, so it is kept on screen however many lines it has.
  const readoutBox = useRef<HTMLDivElement>(null);
  const [readoutH, setReadoutH] = useState(162);
  useLayoutEffect(() => {
    if (readoutBox.current) setReadoutH(readoutBox.current.offsetHeight);
  }, [readout]);

  useEffect(() => {
    fetch('sweep.json')
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : Promise.reject(new Error('missing'))))
      .then((d: SweepFile) => setData(d))
      .catch(() => setData('missing'));
  }, []);

  if (data === null) return <div className="survival" />;
  if (data === 'missing') {
    return (
      <div className="survival">
        <p className="mapEmpty">No map yet. Run npm run sweep to build it.</p>
        <button className="quiet" onClick={onBack}>
          Back to the simulator
        </button>
      </div>
    );
  }

  const summary = summarise(data);
  const head = headline(summary.overall);
  const cells = data.cells.filter((c) => c.market === market);
  const maxMinutes = Math.max(0, ...cells.flatMap((c) => STRATEGIES.map((b) => c.banks[b].minutesOverMean)));
  const r = readout?.cell.banks[readout.bank];

  return (
    <div className="survival">
      <header className="mapHead">
        <div>
          <p className={`mapHeadline ${head.alert ? 'alert' : ''}`}>{head.text}</p>
          <p className="mapSub">
            {summary.overall.ticksMillions.toLocaleString('en-GB')} million simulated steps. {summary.seedsPerCell} storms with
            different customers in each square.
          </p>
        </div>
        <div className="mapHeadRight">
          <div className="seg mapMarkets" role="group" aria-label="Market">
            {MARKETS.map((m) => (
              <button key={m} aria-pressed={m === market} onClick={() => setMarket(m)}>
                {MARKET_NAME[m]}
              </button>
            ))}
          </div>
          <button className="quiet" onClick={onBack}>
            Back to the simulator
          </button>
        </div>
      </header>

      <div className="mapGrid">
        <span aria-hidden="true" />
        <p className="mapColHead">Minutes over the limit</p>
        <p className="mapColHead">Customers served</p>
        {STRATEGIES.map((b) => (
          <section key={b} className="mapRow" aria-label={STRATEGY[b].name}>
            <h3>{STRATEGY[b].name}</h3>
            <div className="mapPair">
              {(['minutes', 'served'] as const).map((measure) => (
                <div key={measure} className="heatFrame">
                  <Heatmap
                    cells={cells}
                    bank={b}
                    measure={measure}
                    maxMinutes={maxMinutes}
                    onShow={setReadout}
                    onPlay={(c) => onPlay({ market: c.market, separationDeg: c.separationDeg, stormMinutes: c.stormMinutes }, worstBank(c))}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
        <p className="mapHint">Storm length across, how far Mars is up the side. Click a square to play that storm.</p>
      </div>

      <MissedBars figures={summary.byMarket[market]} />

      {readout && r && (
        <div
          ref={readoutBox}
          className="mapReadout glass"
          style={{
            left: readout.right + 8 + 290 <= window.innerWidth ? readout.right + 8 : Math.max(8, readout.left - 8 - 290),
            top: Math.max(8, Math.min(readout.y, window.innerHeight - readoutH - 8)),
          }}
        >
          <b>{conditions(readout.cell)}</b>
          <span>{STRATEGY[readout.bank].name}</span>
          <span className={r.breachedRuns > 0 ? 'alert' : ''}>
            Over its limit in {r.breachedRuns} of {readout.cell.runs} storms
          </span>
          <span>Worst peak {r.peakOverLimitMax.toFixed(1)} times the limit</span>
          <span>{Math.round(r.servedPctMean)}% of customers served</span>
          {readout.cell.stormMinutes > 0 && (
            <span>Mars desk served {Math.round(r.marsServedInStormMean)} customers during the storm</span>
          )}
          {r.profitMean !== undefined && r.profitP5 !== undefined && r.profitWorst !== undefined && (
            <>
              <span>Profit per storm {dollars(r.profitMean)} on average</span>
              <span>
                Worst 1 in 20 {dollars(r.profitP5)}, worst of all {dollars(r.profitWorst)}
              </span>
            </>
          )}
          {readout.cell.stormMinutes > 0 && STRATEGIES.every((b) => summary.byMarket[readout.cell.market].banks[b].profit) && (
            <span className="mapReadoutMarket">
              {MARKET_NAME[readout.cell.market]}, all storms. Typical profit per storm:{' '}
              {STRATEGIES.map((b) => SHORT_NAME[b] + ' ' + dollars(summary.byMarket[readout.cell.market].banks[b].profit!.mean)).join(', ')}. In a
              bad storm (worst 1 in 20):{' '}
              {STRATEGIES.map((b) => dollars(summary.byMarket[readout.cell.market].banks[b].profit!.p5)).join(', ')}.
            </span>
          )}
          <span className="mapReadoutPlay">Click to play storm 1 of the {readout.cell.runs}.</span>
        </div>
      )}
    </div>
  );
}
