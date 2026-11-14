import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { DelayNetwork } from '../src/sim/network';
import type { Payload } from '../src/sim/types';
import { World } from '../src/sim/world';

const news = (value: number): Payload => ({ kind: 'news', origin: 'earth', at: 0, value });

describe('DelayNetwork', () => {
  it('delivers after the light delay and not before', () => {
    const net = new DelayNetwork(() => true, () => 10);
    net.send('earth', 'mars', news(1), 5);
    expect(net.deliver(14.99)).toHaveLength(0);
    expect(net.deliver(15)).toHaveLength(1);
    expect(net.inFlight).toHaveLength(0);
  });

  it('drops messages sent while the link is closed, without telling the sender anything else', () => {
    let open = false;
    const net = new DelayNetwork(() => open, () => 1);
    expect(net.send('earth', 'mars', news(1), 0)).toBe(false);
    open = true;
    net.send('earth', 'mars', news(2), 0);
    const got = net.deliver(10);
    expect(got.map((e) => (e.payload.kind === 'news' ? e.payload.value : -1))).toEqual([2]);
    expect(net.dropped).toBe(1);
  });

  it('delivers in arrival order', () => {
    const delays = [9, 3, 6];
    let i = 0;
    const net = new DelayNetwork(() => true, () => delays[i++]);
    net.send('earth', 'mars', news(9), 0);
    net.send('earth', 'mars', news(3), 0);
    net.send('earth', 'mars', news(6), 0);
    expect(net.deliver(100).map((e) => e.deliverAt)).toEqual([3, 6, 9]);
  });

  it('purge removes only matching messages, counts them as dropped and records how far they got', () => {
    const net = new DelayNetwork(() => true, () => 10);
    net.send('earth', 'mars', news(1), 0);
    net.send('mars', 'earth', news(2), 2);
    net.send('earth', 'moon', news(3), 0);
    const gone = net.purge((e) => e.to === 'mars' || e.from === 'mars', 4);
    expect(gone).toHaveLength(2);
    expect(net.inFlight.map((e) => e.to)).toEqual(['moon']);
    expect(net.dropped).toBe(2);
    const drops = net.drops.slice(-2);
    expect(drops.every((d) => d.inFlight)).toBe(true);
    expect(drops.map((d) => d.progress)).toEqual([0.4, 0.2]);
  });
});

/** Run a quiet world until a desk-to-desk message from Earth to Mars is in flight, and return its id. */
function inFlightEarthToMars(w: World): number {
  while (!w.net.inFlight.some((e) => e.from === 'earth' && e.to === 'mars' && e.payload.kind === 'gossip')) w.step();
  return w.net.inFlight.find((e) => e.from === 'earth' && e.to === 'mars' && e.payload.kind === 'gossip')!.id;
}

describe('closing a link', () => {
  const quiet = { ...DEFAULT_CONFIG, customerRate: 0 };

  it('destroys a message in flight when a storm starts, unless switched off', () => {
    for (const destroy of [true, false]) {
      const w = new World({ strategy: 'leased', seed: 1, separationDeg: 150, cfg: { ...quiet, closedLinkDestroysInFlight: destroy } });
      const id = inFlightEarthToMars(w);
      w.step();
      w.blackout = true;
      let arrived = false;
      for (let i = 0; i < 200; i++) {
        const before = w.net.inFlight.some((e) => e.id === id);
        w.step();
        if (before && !w.net.inFlight.some((e) => e.id === id) && w.net.delivered > 0) arrived = !w.net.drops.some((d) => d.inFlight);
        if (!w.net.inFlight.some((e) => e.id === id)) break;
      }
      expect(w.net.inFlight.some((e) => e.id === id)).toBe(false);
      expect(w.net.drops.some((d) => d.inFlight && d.from === 'earth' && d.to === 'mars')).toBe(destroy);
      expect(arrived).toBe(!destroy);
    }
  });

  it('a hand cut destroys what is on that link and leaves the other links alone', () => {
    const w = new World({ strategy: 'leased', seed: 1, separationDeg: 150, cfg: quiet });
    inFlightEarthToMars(w);
    const onOthers = () => w.net.inFlight.filter((e) => !(e.from === 'mars' && e.to === 'earth') && !(e.from === 'earth' && e.to === 'mars')).map((e) => e.id);
    const others = onOthers();
    expect(others.length).toBeGreaterThan(0);
    w.setCut('earth', 'mars', true);
    w.step();
    expect(w.net.inFlight.some((e) => (e.from === 'earth' && e.to === 'mars') || (e.from === 'mars' && e.to === 'earth'))).toBe(false);
    // Everything that was on the other links is still travelling, or has arrived; none of it was destroyed.
    expect(w.net.drops.filter((d) => d.inFlight && !((d.from === 'earth' && d.to === 'mars') || (d.from === 'mars' && d.to === 'earth')))).toHaveLength(0);
  });
});
