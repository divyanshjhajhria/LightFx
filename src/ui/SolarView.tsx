import { useCallback, useEffect, useRef } from 'react';
import { position } from '../sim/orbits';
import type { Vec } from '../sim/orbits';
import type { BodyId } from '../sim/types';
import type { World } from '../sim/world';
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

function draw({ g, W, H, cam, w, now, tReal, selected, fx, stars, still, hoverLink }: Frame): void {
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
    if (l.a === 'earth' && l.b === 'mars') {
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
  const lead = new Map<string, { x: number; y: number; nx: number; ny: number; left: number }>();
  for (const env of w.net.inFlight) {
    const a = pos[env.from];
    const b = pos[env.to];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 40) continue; // The Earth-Moon hop takes about a second.
    const span = env.deliverAt - env.sentAt;
    const f = span > 0 ? clamp((now - env.sentAt) / span, 0, 1) : 1;
    const nx = -dy / len;
    const ny = dx / len;
    const x = a[0] + dx * f + nx * 3;
    const y = a[1] + dy * f + ny * 3;
    if (env.payload.kind === 'news') {
      g.fillStyle = `rgba(${WARM},0.3)`;
      g.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      continue;
    }
    const handover = env.payload.kind === 'gossip' ? env.payload.handover : undefined;
    if (handover) {
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
      const side = ny > 0 ? -1 : 1;
      g.fillText(`${handover} handed to ${BODY_NAME[env.to]}`, x + nx * 18 * side, y + ny * 18 * side + 4);
      continue;
    }
    if (env.from === 'moon' || env.to === 'moon') {
      // The Moon's traffic runs almost on top of Earth's, so it stays in the background.
      g.fillStyle = `rgba(${WARM},0.55)`;
      g.beginPath();
      g.arc(x, y, 1.3, 0, 2 * Math.PI);
      g.fill();
      continue;
    }
    const tf = Math.max(0, f - 52 / len);
    const x0 = a[0] + dx * tf + nx * 3;
    const y0 = a[1] + dy * tf + ny * 3;
    const trail = g.createLinearGradient(x0, y0, x, y);
    trail.addColorStop(0, `rgba(${WARM},0)`);
    trail.addColorStop(1, `rgba(${WARM},0.8)`);
    g.strokeStyle = trail;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x, y);
    g.stroke();
    g.fillStyle = `rgba(${WARM},0.16)`;
    g.beginPath();
    g.arc(x, y, 5, 0, 2 * Math.PI);
    g.fill();
    g.fillStyle = '#fffcf5';
    g.beginPath();
    g.arc(x, y, 2, 0, 2 * Math.PI);
    g.fill();
    const key = `${env.from}>${env.to}`;
    const left = env.deliverAt - now;
    const best = lead.get(key);
    if ((key === 'earth>mars' || key === 'mars>earth') && (!best || left < best.left)) {
      lead.set(key, { x, y, nx, ny, left });
    }
  }
  // Countdown on the next message to land in each direction.
  g.font = `500 10.5px ${FONT}`;
  g.textAlign = 'center';
  g.fillStyle = `rgba(${WARM},0.6)`;
  for (const p of lead.values()) {
    g.fillText(`${Math.max(0, p.left).toFixed(1)} min`, p.x + p.nx * 15, p.y + p.ny * 15 + 3);
  }

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
    const reach = Math.min(0.12, 70 / len) * (1 - (1 - p) ** 2) + 18 / len;
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

    // Name, a state dot, and a second line only when something needs saying.
    const desk = w.desks[b];
    const mode = desk.mode(w.now);
    const heard = desk.heardAgo(w.now);
    const leaseLeft = heard === null ? null : w.cfg.leaseDuration - heard;
    let note = '';
    let noteColour = STATE[mode];
    if (mode !== 'normal') note = MODE_LABEL[mode];
    else if (leaseLeft !== null && leaseLeft < w.cfg.leaseDuration / 2) {
      note = `Lease ends in ${Math.max(0, leaseLeft).toFixed(0)} min`;
      noteColour = STATE.degraded;
    }
    const above = b === 'moon';
    const nameY = above ? y - r - (note ? 23 : 9) : y + r + 19;
    g.font = `500 12.5px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = `rgba(${WARM},${selected === b ? 1 : 0.84})`;
    g.fillText(BODY_LABEL[b], x + 5, nameY);
    const tw = g.measureText(BODY_LABEL[b]).width;
    g.fillStyle = STATE[mode];
    g.beginPath();
    g.arc(x + 5 - tw / 2 - 8, nameY - 4, 2.6, 0, 2 * Math.PI);
    g.fill();
    if (note) {
      g.font = `500 11px ${FONT}`;
      g.fillStyle = noteColour;
      g.fillText(note, x, nameY + 15);
    }
  }
}

interface Props {
  getWorld: () => World;
  getNow: () => number;
  selected: BodyId | null;
  onSelect: (b: BodyId | null) => void;
  onToggleLink: (a: BodyId, b: BodyId) => void;
}

/** Interactive solar system for one world: scroll to zoom, drag to pan, click a planet or a link. Redraws every frame. */
export function SolarView({ getWorld, getNow, selected, onSelect, onToggleLink }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ cx: 0, cy: 0, zoom: 200, tcx: 0, tcy: 0, tzoom: 200, fit: 200, touched: false });
  const live = useRef({ selected, onSelect, onToggleLink });
  live.current = { selected, onSelect, onToggleLink };

  const resetView = useCallback(() => {
    const c = cam.current;
    c.tcx = 0;
    c.tcy = 0;
    c.tzoom = c.fit;
    c.touched = false;
  }, []);

  useEffect(() => {
    const el = canvas.current!;
    const box = wrap.current!;
    const g = el.getContext('2d')!;
    const c = cam.current;
    const stars = makeStars(260);
    const fx: DropFx[] = [];
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0;
    let H = 0;
    let seenWorld: World | null = null;
    let seenDrop = 0;
    let first = true;
    let hoverLink: string | null = null;

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
        const link = hit(mx, my) ? null : hitLink(mx, my);
        hoverLink = link ? `${link[0]}-${link[1]}` : null;
        el.style.cursor = hit(mx, my) || link ? 'pointer' : 'grab';
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
    };
    const up = (e: PointerEvent) => {
      if (drag && drag.moved < 4) {
        const [mx, my] = local(e);
        const body = hit(mx, my);
        const link = body ? null : hitLink(mx, my);
        // A click on a link cuts or restores it and leaves the selected planet alone.
        if (link) live.current.onToggleLink(link[0], link[1]);
        else live.current.onSelect(body);
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
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('dblclick', resetView);

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
        if (d.kind !== 'news' && fx.length < 40) fx.push({ from: d.from, to: d.to, start: t });
      }

      if (W > 0 && H > 0) {
        draw({ g, W, H, cam: c, w, now: getNow(), tReal: t, selected: live.current.selected, fx, stars, still, hoverLink });
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
    };
  }, [getWorld, getNow, resetView]);

  return (
    <div className="solar" ref={wrap}>
      <canvas ref={canvas} role="img" aria-label="Earth, the Moon and Mars around the Sun, with messages travelling between their desks" />
      <button className="quiet resetView" onClick={resetView}>
        Reset view
      </button>
    </div>
  );
}
