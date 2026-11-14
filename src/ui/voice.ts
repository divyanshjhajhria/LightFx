// The guided demo's voice: a recorded file from public/vo/ when one exists, otherwise the browser's speech synthesis.
// Every failure is silent: the captions always carry the words.

const MUTE_KEY = 'lightspeed-fx.muted';

let muted = readMuted();
/** Line ids with a recorded file, found when the demo starts. Null until checked. */
let recorded: Set<string> | null = null;
let audio: HTMLAudioElement | null = null;
let chosen: SpeechSynthesisVoice | null = null;
let listening = false;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function synth(): SpeechSynthesis | null {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  } catch {
    return null;
  }
}

/** Prefer a British English voice, then any English voice, then the browser's default. */
function chooseVoice(): void {
  const s = synth();
  if (!s) return;
  try {
    const voices = s.getVoices();
    chosen =
      voices.find((v) => v.lang.replace('_', '-').toLowerCase() === 'en-gb') ??
      voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
      null;
  } catch {
    chosen = null;
  }
}

/**
 * Get ready to speak: pick a voice (voices can load late, so keep listening) and check which lines have a recorded
 * file. A file counts only if the server says it is audio; a dev server answers unknown paths with the app's page.
 */
export async function prepareVoice(ids: string[]): Promise<void> {
  const s = synth();
  if (s && !listening) {
    listening = true;
    chooseVoice();
    try {
      s.addEventListener('voiceschanged', chooseVoice);
    } catch {
      // Older browsers: the first choice stands.
    }
  }
  const found = new Set<string>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`vo/${id}.mp3`, { method: 'HEAD' });
        if (r.ok && (r.headers.get('content-type') ?? '').startsWith('audio')) found.add(id);
      } catch {
        // Not there.
      }
    }),
  );
  recorded = found;
}

/** Say a line, cutting off anything still playing. */
export function speak(id: string, text: string): void {
  stop();
  if (muted) return;
  if (recorded?.has(id)) {
    try {
      audio = new Audio(`vo/${id}.mp3`);
      void audio.play().catch(() => undefined);
      return;
    } catch {
      audio = null;
    }
  }
  const s = synth();
  if (!s) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    if (chosen) u.voice = chosen;
    u.lang = chosen?.lang ?? 'en-GB';
    u.rate = 1;
    u.pitch = 1;
    s.speak(u);
  } catch {
    // No voice: the caption carries the line.
  }
}

/** Is a line still being spoken? */
export function speaking(): boolean {
  if (audio && !audio.paused && !audio.ended) return true;
  try {
    return synth()?.speaking ?? false;
  } catch {
    return false;
  }
}

export function stop(): void {
  if (audio) {
    try {
      audio.pause();
    } catch {
      // Already gone.
    }
    audio = null;
  }
  try {
    synth()?.cancel();
  } catch {
    // Nothing to stop.
  }
}

export function setMuted(m: boolean): void {
  muted = m;
  if (m) stop();
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // Private window: the setting lasts for this visit only.
  }
}

export function isMuted(): boolean {
  return muted;
}
