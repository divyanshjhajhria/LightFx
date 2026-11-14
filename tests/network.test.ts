import { describe, expect, it } from 'vitest';
import { DelayNetwork } from '../src/sim/network';
import type { Payload } from '../src/sim/types';

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
});
