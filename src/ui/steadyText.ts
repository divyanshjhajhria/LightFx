import { useEffect, useRef, useState } from 'react';

/**
 * Text that changes no more often than every `minMs` milliseconds, and only when the words actually differ. Returns the
 * text to show and a counter that goes up on each change, to key a fade.
 */
export function useSteadyText(text: string, minMs = 4000): { text: string; version: number } {
  const [shown, setShown] = useState({ text, version: 0 });
  const lastChange = useRef(0);
  const latest = useRef(text);
  latest.current = text;

  useEffect(() => {
    if (text === shown.text) return;
    const wait = Math.max(0, lastChange.current + minMs - performance.now());
    const id = setTimeout(() => {
      lastChange.current = performance.now();
      setShown((s) => (latest.current === s.text ? s : { text: latest.current, version: s.version + 1 }));
    }, wait);
    return () => clearTimeout(id);
  }, [text, shown.text, minMs]);

  return shown;
}
