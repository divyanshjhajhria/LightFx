import { describe, expect, it } from 'vitest';
import { findRecorded } from '../src/ui/voice';

const answer = (ok: boolean, type: string | null) => ({ ok, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? type : null) } });

describe('finding recorded voice files', () => {
  it('counts an audio answer, and not an HTML page, a missing file or a network error', async () => {
    const asked: string[] = [];
    const found = await findRecorded(['ready', 'storm', 'panic', 'alone'], async (url, init) => {
      asked.push(`${init.method} ${url}`);
      if (url.endsWith('ready.mp3')) return answer(true, 'audio/mpeg');
      if (url.endsWith('storm.mp3')) return answer(true, 'text/html; charset=utf-8');
      if (url.endsWith('panic.mp3')) return answer(false, 'audio/mpeg');
      throw new TypeError('network error');
    });
    expect([...found]).toEqual(['ready']);
    expect(asked).toContain('HEAD vo/ready.mp3');
  });
});
