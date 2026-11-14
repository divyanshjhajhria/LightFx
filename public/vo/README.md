# Recorded voice for the guided demo

Drop an MP3 in this folder and the guided demo plays it instead of the browser's synthetic voice, with no code
change. Name each file after the line it replaces: `ready.mp3`, `trade.mp3`, `storm.mp3`, `silence.mp3`,
`panic.mp3`, `alone.mp3` and `recovery.mp3` are the lines spoken when each beat starts, and `silence-settle.mp3`,
`panic-settle.mp3` and `recovery-settle.mp3` are the second lines of those beats (spoken only when the thing they
describe has actually happened). The words for each are `say` and `settle.say` in `src/sim/guide.ts`; the voice
may say a little more than the caption, as `silence.mp3` does ("An hour goes by." under the caption "Time passes.").
Any line without a file falls back to the synthetic voice; the files are checked once, when the demo starts.
