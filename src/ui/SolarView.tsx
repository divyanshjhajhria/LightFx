import { useCallback, useEffect, useRef, useState } from 'react';
import { position } from '../sim/orbits';
import type { Vec } from '../sim/orbits';
import type { BodyId, Envelope, PerBody } from '../sim/types';
import type { World } from '../sim/world';
import { describeEnvelope } from './describe';
import { ALERT_RGB, BODY_LABEL, BODY_NAME, FONT, MODE_LABEL, STATE, WARM } from './theme';

/** The view looks down on the orbital plane at an angle: vertical distances are squashed by this factor. */
const TILT = 0.42;
/** The Sun sits slightly above centre so the bottom of Mars's orbit clears the control dock. */
const LIFT = 12;
/** The real Moon would sit inside Earth's disc at this scale, so it is drawn further out. */
const MOON_DISPLAY_AU = 0.085;
const DRAW_ORDER: BodyId[] = ['earth', 'moon', 'mars'];

const SPHERE: Record<BodyId, { r: number; light: string; mid: string; dark: string }> = {
  earth: { r: 11, light: '#cfe6ff', mid: '#3f7fd6', dark: '#081a3a' },
  moon: { r: 4.2, light: '#f4f3ee', mid: '#a9a9a4', dark: '#33343a' },
  mars: { r: 9, light: '#ffd0ae', mid: '#c4603a', dark: '#36130a' },
};

interface Camera {
  cx: number;
  cy: number;
  zoom: number;
  tcx: number;
  tcy: number;
  tzoom: number;
  fit: number;
  touched: boolean;
}

interface DropFx {
  from: BodyId;
  to: BodyId;
  start: number;
  /** For a message destroyed in flight: how far along the link it was, 0 to 1. */
  progress?: number;
}

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  depth: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mod = (v: number, m: number) => ((v % m) + m) % m;

function makeStars(n: number): Star[] {
  let s = 20261114;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return Array.from({ length: n }, () => ({
    x: rnd(),
    y: rnd(),
    size: rnd() < 0.85 ? 1 : 1.6,
    alpha: 0.12 + rnd() * 0.5,
    depth: 0.3 + rnd(),
  }));
}

function bodyWorld(w: World, b: BodyId): Vec {
  if (b !== 'moon') return position(w.orbit, b);
  const e = position(w.orbit, 'earth');
  const a = w.orbit.moon + Math.PI * 0.7;
  return { x: e.x + MOON_DISPLAY_AU * Math.cos(a), y: e.y + MOON_DISPLAY_AU * Math.sin(a) };
}

function bodyRadius(b: BodyId, zoom: number): number {
  return SPHERE[b].r * clamp(Math.sqrt(zoom / 250), 0.75, 2.4);
}

interface Frame {
  g: CanvasRenderingContext2D;
  W: number;
  H: number;
  cam: Camera;
  w: World;
  now: number;
  tReal: number;
  selected: BodyId | null;
  fx: DropFx[];
  stars: Star[];
  still: boolean;
  /** Link under the pointer, as "a-b" with a and b in the order World.links() gives them. */
  hoverLink: string | null;
  showNews: boolean;
  /** Trade being followed: its messages are emphasised and everything else fades. */
  following: number | null;
  /** An extra line under each planet's name, or null for none. */
  believes: PerBody<string | null> | null;
  /** Filled in by draw(): where each message was drawn this frame, for hit-testing. */
  shown: Shown[];
}

/** A message as drawn in the latest frame. */
interface Shown {
  env: Envelope;
  x: number;
  y: number;
}

interface LabelLine {
  text: string;
  font: string;
  colour: string;
}

/** A small cross, the mark for a message that died on a dead link. */
function cross(g: CanvasRenderingContext2D, x: number, y: number, alpha: number): void {
  g.strokeStyle = `rgba(${ALERT_RGB},${alpha})`;
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(x - 3, y - 3);
  g.lineTo(x + 3, y + 3);
  g.moveTo(x + 3, y - 3);
  g.lineTo(x - 3, y + 3);
  g.stroke();
}

function draw(f: Frame): void {
  const { g, W, H, cam, w, now, tReal, selected, fx, stars, still, hoverLink, showNews, following, believes, shown } = f;
  const P = (v: Vec): [number, number] => [
    W / 2 + (v.x - cam.cx) * cam.zoom,
    H / 2 - LIFT - (v.y - cam.cy) * cam.zoom * TILT,
  ];
  g.clearRect(0, 0, W, H);

  // Stars drift slightly against the camera so panning has depth.
  for (const s of stars) {
    const x = mod(s.x * W - cam.cx * cam.zoom * 0.05 * s.depth, W);
    const y = mod(s.y * H + cam.cy * cam.zoom * TILT * 0.05 * s.depth, H);
    g.fillStyle = `rgba(${WARM},${s.alpha})`;
    g.fillRect(x, y, s.size, s.size);
  }

  const [sx, sy] = P({ x: 0, y: 0 });
  const pos = {} as Record<BodyId, [number, number]>;
  for (const b of DRAW_ORDER) pos[b] = P(bodyWorld(w, b));

  // Orbits.
  g.lineWidth = 1;
  g.strokeStyle = `rgba(${WARM},0.1)`;
  for (const r of [1, 1.5237]) {
    g.beginPath();
    g.ellipse(sx, sy, r * cam.zoom, r * cam.zoom * TILT, 0, 0, 2 * Math.PI);
    g.stroke();
  }
  g.strokeStyle = `rgba(${WARM},0.07)`;
  g.beginPath();
  g.ellipse(pos.earth[0], pos.earth[1], MOON_DISPLAY_AU * cam.zoom, MOON_DISPLAY_AU * cam.zoom * TILT, 0, 0, 2 * Math.PI);
  g.stroke();

  // Links carrying a labelled hand-over right now: their other labels step aside so the hand-over can be read.
  const handing = new Set<string>();
  for (const env of w.net.inFlight) {
    if (env.payload.kind === 'gossip' && env.payload.handover) handing.add([env.from, env.to].sort().join('-'));
  }
  const quiet = (a: BodyId, b: BodyId) => handing.has([a, b].sort().join('-'));

  // Links. Drawn before the Sun so a blocked line visibly runs into it.
  for (const l of w.links()) {
    const [x1, y1] = pos[l.a];
    const [x2, y2] = pos[l.b];
    const hover = hoverLink === `${l.a}-${l.b}`;
    const k = hover ? 2 : 1;
    g.setLineDash(l.open ? [] : [3, 7]);
    g.strokeStyle = l.open ? `rgba(${WARM},${0.16 * k})` : `rgba(${ALERT_RGB},${Math.min(1, 0.6 * k)})`;
    g.lineWidth = hover ? 1.5 : 1;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    g.setLineDash([]);
    if (l.cut) cross(g, (x1 + x2) / 2, (y1 + y2) / 2, 0.95);
    if (l.a === 'earth' && l.b === 'mars' && !quiet(l.a, l.b)) {
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      let nx = -(y2 - y1) / len;
      let ny = (x2 - x1) / len;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      g.font = `500 12px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = l.open ? `rgba(${WARM},0.62)` : `rgba(${ALERT_RGB},0.95)`;
      const text = l.open ? `${l.delayMin.toFixed(1)} light-minutes` : l.cut ? 'Link cut' : 'No signal';
      g.fillText(text, (x1 + x2) / 2 + nx * 20, (y1 + y2) / 2 + ny * 20 + 4);
    }
  }

  // Sun, with a wider and restless corona during a storm.
  const core = clamp(0.06 * cam.zoom, 12, 64);
  const pulse = w.blackout && !still ? 1 + 0.07 * Math.sin(tReal / 240) : 1;
  const corona = core * (w.blackout ? 7.5 : 5) * pulse;
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, corona);
  halo.addColorStop(0, 'rgba(255,238,205,0.95)');
  halo.addColorStop(0.14, 'rgba(255,198,120,0.5)');
  halo.addColorStop(0.4, w.blackout ? 'rgba(255,112,64,0.2)' : 'rgba(255,150,70,0.11)');
  halo.addColorStop(1, 'rgba(255,150,70,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(sx, sy, corona, 0, 2 * Math.PI);
  g.fill();
  const disc = g.createRadialGradient(sx - core * 0.25, sy - core * 0.25, 0, sx, sy, core);
  disc.addColorStop(0, '#fffaf0');
  disc.addColorStop(0.65, '#ffd48f');
  disc.addColorStop(1, '#f2a348');
  g.fillStyle = disc;
  g.beginPath();
  g.arc(sx, sy, core, 0, 2 * Math.PI);
  g.fill();
  if (w.blackout) {
    for (let i = 0; i < 3; i++) {
      const ph = still ? (i + 1) / 4 : (tReal / 2800 + i / 3) % 1;
      // A broad, soft band reads as a shockwave; a thin line would read as another orbit.
      const rr = core + ph * 1.9 * cam.zoom;
      g.strokeStyle = `rgba(${ALERT_RGB},${(1 - ph) * 0.09})`;
      g.lineWidth = 6 + ph * 22;
      g.beginPath();
      g.ellipse(sx, sy, rr, rr * TILT, 0, 0, 2 * Math.PI);
      g.stroke();
    }
  }

  // Messages in flight. Each direction keeps to its own side of the line.
  shown.length = 0;
  /** Where the followed trade's labels went, so two messages flying together get one label, not two on top. */
  const labelled: [number, number][] = [];
  const lead = new Map<string, { x: number; y: number; nx: number; ny: number; left: number }>();
  for (const env of w.net.inFlight) {
    const a = pos[env.from];
    const b = pos[env.to];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 40) continue; // The Earth-Moon hop takes about a second.
    const span = env.deliverAt - env.sentAt;
    const t = span > 0 ? clamp((now - env.sentAt) / span, 0, 1) : 1;
    const nx = -dy / len;
    const ny = dx / len;
    const x = a[0] + dx * t + nx * 3;
    const y = a[1] + dy * t + ny * 3;
    const tagged = following !== null && env.trade === following;
    g.globalAlpha = following !== null && !tagged ? 0.25 : 1;
    const p = env.payload;
    if (p.kind === 'news') {
      if (!showNews) continue;
      g.fillStyle = `rgba(${WARM},0.3)`;
      g.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      shown.push({ env, x, y });
      continue;
    }
    shown.push({ env, x, y });
    // Labels sit on the side of the line away from the Sun-ward bottom of the screen.
    const side = ny > 0 ? -1 : 1;
    const handover = p.kind === 'gossip' ? p.handover : undefined;
    if (handover && !tagged) {
      // A hand-over of position between desks: larger, and labelled for as long as it is in flight.
      g.fillStyle = `rgba(${WARM},0.18)`;
      g.beginPath();
      g.arc(x, y, 9, 0, 2 * Math.PI);
      g.fill();
      g.fillStyle = '#fffcf5';
      g.beginPath();
      g.arc(x, y, 5, 0, 2 * Math.PI);
      g.fill();
      g.font = `500 11.5px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = `rgba(${WARM},0.92)`;
      // Leave the words off right next to a planet, where they would sit on its name; the large dot still shows.
      if (Math.hypot(x - a[0], y - a[1]) < 36 || Math.hypot(x - b[0], y - b[1]) < 36) continue;
      // On whichever side of the line is further from the Moon, whose name sits close to the Earth to Mars line.
      const [mx, my] = pos.moon;
      const away = Math.hypot(x + nx * 18 - mx, y + ny * 18 - my) >= Math.hypot(x - nx * 18 - mx, y - ny * 18 - my) ? 1 : -1;
      g.fillText(`${handover} handed to ${BODY_NAME[env.to]}`, x + nx * 22 * away, y + ny * 22 * away + 4);
      continue;
    }
    if (!tagged && (env.from === 'moon' || env.to === 'moon')) {
      // The Moon's traffic runs almost on top of Earth's, so it stays in the background.
      g.fillStyle = `rgba(${WARM},0.55)`;
      g.beginPath();
      g.arc(x, y, 1.3, 0, 2 * Math.PI);
      g.fill();
      continue;
    }
    const head = tagged ? 5 : 3.5;
    const tf = Math.max(0, t - (tagged ? 110 : 70) / len);
    const x0 = a[0] + dx * tf + nx * 3;
    const y0 = a[1] + dy * tf + ny * 3;
    const trail = g.createLinearGradient(x0, y0, x, y);
    trail.addColorStop(0, `rgba(${WARM},0)`);
    trail.addColorStop(1, `rgba(${WARM},0.8)`);
    g.strokeStyle = trail;
    g.lineWidth = tagged ? 2.2 : 1.6;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x, y);
    g.stroke();
    g.fillStyle = `rgba(${WARM},0.16)`;
    g.beginPath();
    g.arc(x, y, head + 3, 0, 2 * Math.PI);
    g.fill();
    g.fillStyle = '#fffcf5';
    g.beginPath();
    g.arc(x, y, head, 0, 2 * Math.PI);
    g.fill();
    const left = env.deliverAt - now;
    if (tagged) {
      if (labelled.some(([lx, ly]) => Math.hypot(lx - x, ly - y) < 18)) continue;
      labelled.push([x, y]);
      g.font = `500 11.5px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = `rgba(${WARM},0.95)`;
      g.fillText(`lands in ${Math.max(0, left).toFixed(1)} min`, x + nx * 20 * side, y + ny * 20 * side + 4);
      continue;
    }
    const key = `${env.from}>${env.to}`;
    const best = lead.get(key);
    if ((key === 'earth>mars' || key === 'mars>earth') && !quiet(env.from, env.to) && (!best || left < best.left)) {
      lead.set(key, { x, y, nx: nx * side, ny: ny * side, left });
    }
  }
  // Countdown on the next message to land in each direction.
  g.globalAlpha = following !== null ? 0.25 : 1;
  g.font = `500 10.5px ${FONT}`;
  g.textAlign = 'center';
  g.fillStyle = `rgba(${WARM},0.6)`;
  for (const p of lead.values()) {
    g.fillText(`${Math.max(0, p.left).toFixed(1)} min`, p.x + p.nx * 15, p.y + p.ny * 15 + 3);
  }
  g.globalAlpha = 1;

  // Messages sent into a dead link: they leave the desk and die.
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i];
    const p = (tReal - e.start) / 900;
    if (p >= 1) {
      fx.splice(i, 1);
      continue;
    }
    const a = pos[e.from];
    const b = pos[e.to];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    // Refused at the sender: it leaves the desk and dies. Destroyed in flight: it dies where it was.
    const reach = e.progress ?? Math.min(0.12, 70 / len) * (1 - (1 - p) ** 2) + 18 / len;
    const x = a[0] + dx * reach - (dy / len) * 3;
    const y = a[1] + dy * reach + (dx / len) * 3;
    cross(g, x, y, (1 - p) * 0.9);
    g.strokeStyle = `rgba(${ALERT_RGB},${(1 - p) * 0.35})`;
    g.beginPath();
    g.arc(x, y, 4 + 9 * p, 0, 2 * Math.PI);
    g.stroke();
  }

  // Planets, lit from the Sun, far ones first.
  const order = [...DRAW_ORDER].sort((p, q) => pos[p][1] - pos[q][1]);
  for (const b of order) {
    const [x, y] = pos[b];
    const r = bodyRadius(b, cam.zoom);
    const s = SPHERE[b];
    const ll = Math.hypot(sx - x, sy - y) || 1;
    const lx = (sx - x) / ll;
    const ly = (sy - y) / ll;
    if (b === 'earth') {
      const air = g.createRadialGradient(x, y, r * 0.8, x, y, r * 2.4);
      air.addColorStop(0, 'rgba(110,170,255,0.26)');
      air.addColorStop(1, 'rgba(110,170,255,0)');
      g.fillStyle = air;
      g.beginPath();
      g.arc(x, y, r * 2.4, 0, 2 * Math.PI);
      g.fill();
    }
    const shade = g.createRadialGradient(x + lx * r * 0.5, y + ly * r * 0.5, r * 0.05, x, y, r * 1.1);
    shade.addColorStop(0, s.light);
    shade.addColorStop(0.45, s.mid);
    shade.addColorStop(1, s.dark);
    g.fillStyle = shade;
    g.beginPath();
    g.arc(x, y, r, 0, 2 * Math.PI);
    g.fill();
    if (selected === b) {
      g.strokeStyle = `rgba(${WARM},0.9)`;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, r + 6, 0, 2 * Math.PI);
      g.stroke();
    }
  }

  // Labels: a name with a state dot, then a line only when something needs saying, then what the desk believes.
  const labels = DRAW_ORDER.map((b) => {
    const desk = w.desks[b];
    const mode = desk.mode(w.now);
    const heard = desk.heardAgo(w.now);
    const leaseLeft = heard === null ? null : w.cfg.leaseDuration - heard;
    const lines: LabelLine[] = [
      { text: BODY_LABEL[b], font: `500 12.5px ${FONT}`, colour: `rgba(${WARM},${selected === b ? 1 : 0.84})` },
    ];
    if (mode !== 'normal') lines.push({ text: MODE_LABEL[mode], font: `500 11px ${FONT}`, colour: STATE[mode] });
    else if (leaseLeft !== null && leaseLeft < w.cfg.leaseDuration / 2) {
      lines.push({ text: `Plays safe in ${Math.max(0, leaseLeft).toFixed(0)} min`, font: `500 11px ${FONT}`, colour: STATE.degraded });
    }
    const belief = believes?.[b];
    if (belief) lines.push({ text: belief, font: `400 11px ${FONT}`, colour: `rgba(${WARM},0.62)` });
    let width = 0;
    for (const l of lines) {
      g.font = l.font;
      width = Math.max(width, g.measureText(l.text).width + (l === lines[0] ? 16 : 0));
    }
    const [x, y] = pos[b];
    return { b, x, y, r: bodyRadius(b, cam.zoom), mode, lines, width, above: b === 'moon' };
  });
  type Lab = (typeof labels)[number];
  const LINE = 15;
  const box = (l: Lab) => {
    const h = LINE * l.lines.length;
    const top = l.above ? l.y - l.r - 5 - h : l.y + l.r + 5;
    return { x0: l.x + 5 - l.width / 2, x1: l.x + 5 + l.width / 2, y0: top, y1: top + h };
  };
  const hits = (p: Lab, q: Lab) => {
    const A = box(p);
    const B = box(q);
    return A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1;
  };
  const fromSun = (l: Lab) => Math.hypot(l.x - sx, (l.y - sy) / TILT);
  // If two labels collide, move the one further from the Sun to the other side of its planet.
  const flipped = new Set<BodyId>();
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        if (!hits(labels[i], labels[j])) continue;
        const far = fromSun(labels[i]) > fromSun(labels[j]) ? labels[i] : labels[j];
        const other = far === labels[i] ? labels[j] : labels[i];
        const move = flipped.has(far.b) ? other : far;
        if (flipped.has(move.b)) continue;
        move.above = !move.above;
        flipped.add(move.b);
      }
    }
  }
  g.textAlign = 'center';
  for (const l of labels) {
    const top = box(l).y0;
    l.lines.forEach((line, i) => {
      const base = top + LINE * i + 12;
      g.font = line.font;
      g.fillStyle = line.colour;
      g.fillText(line.text, l.x + 5, base);
      if (i === 0) {
        const tw = g.measureText(line.text).width;
        g.fillStyle = STATE[l.mode];
        g.beginPath();
        g.arc(l.x + 5 - tw / 2 - 8, base - 4, 2.6, 0, 2 * Math.PI);
        g.fill();
      }
    });
  }
}

interface Props {
  getWorld: () => World;
  getNow: () => number;
  /** The visitor trade being followed, or null. */
  getFollowing: () => number | null;
  /** One extra line under each planet's name (what that desk believes the bank holds), or null. */
  getBelieves: () => PerBody<string | null> | null;
  selected: BodyId | null;
  onSelect: (b: BodyId | null) => void;
  onToggleLink: (a: BodyId, b: BodyId) => void;
  /** Pause the simulation and say whether it was running. */
  onPause: () => boolean;
  onResume: () => void;
  /** Whether clicking a message may pin it (and pause). */
  canPin: () => boolean;
}

/**
 * Interactive solar system for one world: scroll to zoom, drag to pan, click a planet, a message or a link.
 * Hovering a message describes it; clicking one pauses and pins the description. Redraws every frame.
 */
export function SolarView({
  getWorld,
  getNow,
  getFollowing,
  getBelieves,
  selected,
  onSelect,
  onToggleLink,
  onPause,
  onResume,
  canPin,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ cx: 0, cy: 0, zoom: 200, tcx: 0, tcy: 0, tzoom: 200, fit: 200, touched: false });
  const [showNews, setShowNews] = useState(false);
  const live = useRef({ selected, onSelect, onToggleLink, onPause, onResume, showNews, canPin });
  live.current = { selected, onSelect, onToggleLink, onPause, onResume, showNews, canPin };
  /** The pinned message (by envelope id), and whether the simulation was running when it was pinned. */
  const pin = useRef<{ id: number; wasRunning: boolean } | null>(null);

  const resetView = useCallback(() => {
    const c = cam.current;
    c.tcx = 0;
    c.tcy = 0;
    c.tzoom = c.fit;
    c.touched = false;
  }, []);

  const unpin = useCallback(() => {
    const p = pin.current;
    if (!p) return;
    pin.current = null;
    if (p.wasRunning) live.current.onResume();
  }, []);

  useEffect(() => {
    const el = canvas.current!;
    const box = wrap.current!;
    const tipEl = tip.current!;
    const g = el.getContext('2d')!;
    const c = cam.current;
    const stars = makeStars(260);
    const fx: DropFx[] = [];
    const shown: Shown[] = [];
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0;
    let H = 0;
    let seenWorld: World | null = null;
    let seenDrop = 0;
    let first = true;
    let hoverLink: string | null = null;
    let hoverMsg: number | null = null;
    let tipKey = '';

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      W = box.clientWidth;
      H = box.clientHeight;
      el.width = Math.round(W * dpr);
      el.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fit = Math.max(40, Math.min((W * 0.9) / 3.2, (H * 0.86) / (3.2 * TILT)));
      if (!c.touched) c.tzoom = c.fit;
      if (first && W > 0) {
        c.zoom = c.fit;
        first = false;
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    resize();

    const local = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const screen = (w: World, b: BodyId): [number, number] => {
      const v = bodyWorld(w, b);
      return [W / 2 + (v.x - c.cx) * c.zoom, H / 2 - LIFT - (v.y - c.cy) * c.zoom * TILT];
    };
    const hit = (mx: number, my: number): BodyId | null => {
      const w = getWorld();
      let best: BodyId | null = null;
      let bestD = Infinity;
      for (const b of DRAW_ORDER) {
        const [x, y] = screen(w, b);
        const d = Math.hypot(mx - x, my - y);
        if (d < bodyRadius(b, c.zoom) + 12 && d < bestD) {
          best = b;
          bestD = d;
        }
      }
      return best;
    };
    /** The message whose head is nearest the pointer, within 10px, as drawn in the latest frame. */
    const hitMsg = (mx: number, my: number): number | null => {
      let best: number | null = null;
      let bestD = 10;
      for (const s of shown) {
        const d = Math.hypot(mx - s.x, my - s.y);
        if (d <= bestD) {
          best = s.env.id;
          bestD = d;
        }
      }
      return best;
    };
    /**
     * The link under the pointer: the nearest within 8px, ignoring the ends where the planets sit.
     * Earth to Mars and Moon to Mars nearly coincide, so Earth to Mars wins a near tie.
     */
    const hitLink = (mx: number, my: number): [BodyId, BodyId] | null => {
      const w = getWorld();
      const near: { a: BodyId; b: BodyId; d: number }[] = [];
      for (const l of w.links()) {
        const [x1, y1] = screen(w, l.a);
        const [x2, y2] = screen(w, l.b);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len === 0) continue;
        const along = ((mx - x1) * dx + (my - y1) * dy) / len;
        if (along < bodyRadius(l.a, c.zoom) + 12 || along > len - bodyRadius(l.b, c.zoom) - 12) continue;
        const d = Math.abs((mx - x1) * dy - (my - y1) * dx) / len;
        if (d <= 8) near.push({ a: l.a, b: l.b, d });
      }
      if (!near.length) return null;
      near.sort((p, q) => p.d - q.d);
      const em = near.find((n) => n.a === 'earth' && n.b === 'mars');
      const mm = near.find((n) => n.a === 'moon' && n.b === 'mars');
      if (em && mm && Math.abs(em.d - mm.d) <= 2) return [em.a, em.b];
      return [near[0].a, near[0].b];
    };

    let drag: { x: number; y: number; moved: number } | null = null;
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
    };
    const move = (e: PointerEvent) => {
      const [mx, my] = local(e);
      if (!drag) {
        const body = hit(mx, my);
        hoverMsg = body ? null : hitMsg(mx, my);
        const link = body || hoverMsg !== null ? null : hitLink(mx, my);
        hoverLink = link ? `${link[0]}-${link[1]}` : null;
        el.style.cursor = body || hoverMsg !== null || link ? 'pointer' : 'grab';
        return;
      }
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved < 4) return;
      el.style.cursor = 'grabbing';
      c.tcx -= dx / c.zoom;
      c.tcy += dy / (c.zoom * TILT);
      c.cx = c.tcx;
      c.cy = c.tcy;
      c.touched = true;
    };
    const leave = () => {
      hoverLink = null;
      hoverMsg = null;
    };
    // Click priority: planet, then message, then link, then empty space.
    const up = (e: PointerEvent) => {
      if (drag && drag.moved < 4) {
        const [mx, my] = local(e);
        const body = hit(mx, my);
        const msg = body ? null : hitMsg(mx, my);
        const link = body || msg !== null ? null : hitLink(mx, my);
        if (body) live.current.onSelect(body);
        else if (msg !== null) {
          // Pin it: pause, and remember whether we were running so that unpinning can restart. (Not in the demo.)
          if (live.current.canPin()) {
            const wasRunning = pin.current ? pin.current.wasRunning : live.current.onPause();
            pin.current = { id: msg, wasRunning };
          }
        } else if (link) live.current.onToggleLink(link[0], link[1]);
        else {
          unpin();
          live.current.onSelect(null);
        }
      }
      drag = null;
      el.style.cursor = 'grab';
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const [mx, my] = local(e);
      const wx = c.tcx + (mx - W / 2) / c.tzoom;
      const wy = c.tcy - (my - H / 2 + LIFT) / (c.tzoom * TILT);
      c.tzoom = clamp(c.tzoom * Math.exp(-e.deltaY * 0.0015), c.fit * 0.6, c.fit * 14);
      c.tcx = wx - (mx - W / 2) / c.tzoom;
      c.tcy = wy + (my - H / 2 + LIFT) / (c.tzoom * TILT);
      c.touched = true;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pin.current) unpin();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('dblclick', resetView);
    window.addEventListener('keydown', key);

    /** Show the pinned or hovered message's description beside it, or hide the tooltip. */
    const updateTip = (w: World, now: number) => {
      const id = pin.current?.id ?? hoverMsg;
      const s = id === null ? undefined : shown.find((m) => m.env.id === id);
      if (!s) {
        // The message has landed or the bank was replaced: let go of it.
        if (pin.current && !w.net.inFlight.some((e) => e.id === pin.current!.id)) pin.current = null;
        if (!tipEl.hidden) tipEl.hidden = true;
        tipKey = '';
        return;
      }
      const d = describeEnvelope(s.env, now, w.strategy);
      const pinned = pin.current?.id === s.env.id;
      const k = `${pinned}|${d.title}|${d.lines.join('|')}`;
      if (k !== tipKey) {
        tipKey = k;
        tipEl.querySelector('b')!.textContent = d.title;
        const list = tipEl.querySelector('ul')!;
        list.replaceChildren(
          ...d.lines.map((t) => {
            const li = document.createElement('li');
            li.textContent = t;
            return li;
          }),
        );
        tipEl.querySelector('button')!.hidden = !pinned;
      }
      tipEl.hidden = false;
      const tw = tipEl.offsetWidth;
      const th = tipEl.offsetHeight;
      const left = s.x + 16 + tw > W - 8 ? s.x - 16 - tw : s.x + 16;
      tipEl.style.left = `${clamp(left, 8, Math.max(8, W - tw - 8))}px`;
      tipEl.style.top = `${clamp(s.y - th / 2, 8, Math.max(8, H - th - 8))}px`;
    };

    let id = 0;
    let last = performance.now();
    const frame = (t: number) => {
      const k = still ? 1 : 1 - Math.exp(-(t - last) / 110);
      last = t;
      c.zoom += (c.tzoom - c.zoom) * k;
      c.cx += (c.tcx - c.cx) * k;
      c.cy += (c.tcy - c.cy) * k;

      const w = getWorld();
      const drops = w.net.drops;
      if (w !== seenWorld) {
        seenWorld = w;
        seenDrop = drops.length ? drops[drops.length - 1].id : 0;
        fx.length = 0;
      }
      for (const d of drops) {
        if (d.id <= seenDrop) continue;
        seenDrop = d.id;
        if (d.kind !== 'news' && fx.length < 40) fx.push({ from: d.from, to: d.to, start: t, progress: d.progress });
      }

      if (W > 0 && H > 0) {
        const now = getNow();
        draw({
          g,
          W,
          H,
          cam: c,
          w,
          now,
          tReal: t,
          selected: live.current.selected,
          fx,
          stars,
          still,
          hoverLink,
          showNews: live.current.showNews,
          following: getFollowing(),
          believes: getBelieves(),
          shown,
        });
        updateTip(w, now);
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(id);
      observer.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('dblclick', resetView);
      window.removeEventListener('keydown', key);
    };
  }, [getWorld, getNow, getFollowing, getBelieves, resetView, unpin]);

  return (
    <div className="solar" ref={wrap}>
      <canvas ref={canvas} role="img" aria-label="Earth, the Moon and Mars around the Sun, with messages travelling between their desks" />
      <div className="msgTip glass" ref={tip} hidden role="status">
        <b />
        <ul />
        <button className="quiet" onClick={unpin}>
          Resume
        </button>
      </div>
      <div className="viewControls">
        <button className="quiet" onClick={resetView}>
          Reset view
        </button>
        <button className="quiet" aria-pressed={showNews} onClick={() => setShowNews(!showNews)}>
          {showNews ? 'Hide market news' : 'Show market news'}
        </button>
      </div>
    </div>
  );
}
