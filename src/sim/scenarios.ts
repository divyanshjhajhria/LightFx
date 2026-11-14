// The named scenarios in the menu. Notes are written to be read aloud.
import type { Scenario, ScenarioEvent } from './scenario';

const flapping: ScenarioEvent[] = [{ at: 0, kind: 'note', text: 'Close approach, but the Earth to Mars link keeps dropping.' }];
for (let t = 20; t <= 170; t += 30) {
  flapping.push({ at: t, kind: 'cut', a: 'earth', b: 'mars', on: true });
  flapping.push({ at: t + 15, kind: 'cut', a: 'earth', b: 'mars', on: false });
}
flapping.push({ at: 200, kind: 'note', text: 'The link settles.' });

export const SCENARIOS: Scenario[] = [
  {
    id: 'solar-storm',
    name: 'Solar storm',
    summary: 'A storm cuts every link during a panic: one bank breaches, ours holds.',
    seed: 42,
    separationDeg: 150,
    durationMin: 420,
    events: [
      { at: 0, kind: 'note', text: 'Calm trading with Mars on the far side, 20 minutes away.' },
      { at: 120, kind: 'blackout', on: true },
      { at: 120, kind: 'panic', on: true },
      { at: 120, kind: 'note', text: 'A solar storm cuts every interplanetary link as the market panics.' },
      { at: 180, kind: 'note', text: 'Mars has heard nothing for an hour, so its lease expires.' },
      { at: 300, kind: 'blackout', on: false },
      { at: 300, kind: 'panic', on: false },
      { at: 300, kind: 'note', text: 'The storm passes and the desks reconnect.' },
    ],
  },
  {
    id: 'reconnect',
    name: 'Trade winds',
    summary: 'Earth and Mars drift in opposite directions, then cancel out when links return.',
    seed: 11,
    separationDeg: 60,
    durationMin: 480,
    events: [
      { at: 0, kind: 'flow', body: 'earth', sellProb: 0.65 },
      { at: 0, kind: 'flow', body: 'mars', sellProb: 0.35 },
      { at: 0, kind: 'note', text: "Earth's customers mostly sell Mars credits. Mars's mostly buy." },
      { at: 120, kind: 'blackout', on: true },
      { at: 120, kind: 'note', text: 'Links go down. Each desk carries on with its own budget.' },
      { at: 300, kind: 'blackout', on: false },
      { at: 300, kind: 'note', text: 'Links return. The desks cancel their opposite positions.' },
    ],
  },
  {
    id: 'behind-the-sun',
    name: 'Behind the Sun',
    summary: 'No storm at all: the Sun itself blocks the line between Earth and Mars.',
    seed: 7,
    separationDeg: 150,
    durationMin: 360,
    events: [
      { at: 0, kind: 'note', text: 'Mars is drifting towards the far side of the Sun.' },
      { at: 60, kind: 'separation', deg: 180 },
      { at: 60, kind: 'note', text: 'The Sun now blocks the line of sight. No storm, just geometry.' },
      { at: 240, kind: 'separation', deg: 150 },
      { at: 240, kind: 'note', text: 'Mars clears the Sun and contact resumes.' },
    ],
  },
  {
    id: 'flapping-link',
    name: 'Flapping link',
    summary: 'The Earth to Mars link keeps dropping, but Mars stays in touch with the Moon.',
    seed: 3,
    separationDeg: 0,
    durationMin: 240,
    events: flapping,
  },
];
