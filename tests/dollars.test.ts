import { describe, expect, it } from 'vitest';
import { dollars } from '../src/ui/theme';

describe('dollars', () => {
  it('writes money to the cent with a true minus sign, and no minus on a figure that rounds to zero', () => {
    expect(dollars(0.3621)).toBe('$0.36');
    expect(dollars(-4.3456)).toBe('−$4.35');
    expect(dollars(-0.004)).toBe('$0.00');
    expect(dollars(0)).toBe('$0.00');
  });
});
