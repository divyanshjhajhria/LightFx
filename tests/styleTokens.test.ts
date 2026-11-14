import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'src', 'ui', 'styles.css'), 'utf8');
const TOKENS = ['--t-hero', '--t-figure', '--t-title', '--t-name', '--t-body', '--t-small', '--t-micro'];

describe('the type scale', () => {
  it('defines exactly the seven sizes', () => {
    const sizes = Object.fromEntries([...css.matchAll(/(--t-[a-z]+):\s*([\d.]+px);/g)].map((m) => [m[1], m[2]]));
    expect(sizes).toEqual({
      '--t-hero': '36px',
      '--t-figure': '24px',
      '--t-title': '20px',
      '--t-name': '15px',
      '--t-body': '14px',
      '--t-small': '12.5px',
      '--t-micro': '11.5px',
    });
  });

  it('uses only those sizes for every font-size in the stylesheet', () => {
    const bad = [...css.matchAll(/font-size:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => !TOKENS.some((t) => v === `var(${t})`));
    expect(bad).toEqual([]);
  });

  it('keeps every margin, padding and gap on the 4px grid', () => {
    const bad: string[] = [];
    for (const m of css.matchAll(/(?:^|\n)\s*((?:margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)?):\s*([^;]+);/g)) {
      for (const n of m[2].matchAll(/(-?\d+(?:\.\d+)?)px/g)) if (Number(n[1]) % 4 !== 0) bad.push(`${m[1]}: ${m[2]}`);
    }
    expect(bad).toEqual([]);
  });
});
