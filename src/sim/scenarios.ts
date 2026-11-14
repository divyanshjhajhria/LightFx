// The named scenarios in the menu. Notes are written to be read aloud.
import type { Scenario } from './scenario';

/**
 * Trade winds (seed 11): the first whole minute at which |Earth's position| + |Mars's position| has fallen to half or
 * less of its value when the links return at 150 (80, Earth +39 and Mars -41, down to 39, Earth +19 and Mars -20).
 * Measured with this seed; tests/scenario.test.ts checks it still holds.
 */
export const GAP_HALVED = 186;

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
    durationMin: 240,
    events: [
      { at: 0, kind: 'flow', body: 'earth', sellProb: 0.65 },
      { at: 0, kind: 'flow', body: 'mars', sellProb: 0.35 },
      { at: 0, kind: 'note', text: "Earth's customers mostly sell Mars credits. Mars's mostly buy." },
      { at: 120, kind: 'blackout', on: true },
      { at: 120, kind: 'flow', body: 'earth', sellProb: 0.8 },
      { at: 120, kind: 'flow', body: 'mars', sellProb: 0.2 },
      { at: 120, kind: 'note', text: 'Links go down. Each desk carries on alone, inside its own allowance.' },
      { at: 150, kind: 'blackout', on: false },
      // Even customers from here on, so nothing keeps re-opening the gap while the desks cancel it.
      { at: 150, kind: 'flow', body: 'earth', sellProb: 0.5 },
      { at: 150, kind: 'flow', body: 'mars', sellProb: 0.5 },
      { at: 150, kind: 'note', text: 'Links return. Watch Earth hand its surplus to Mars.' },
      { at: GAP_HALVED, kind: 'note', text: 'Earth and Mars have cancelled most of their opposite positions.' },
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
    id: 'one-link-down',
    name: 'One link down',
    summary: 'Earth and Mars lose their direct line for two hours; Mars keeps trading through it.',
    seed: 3,
    separationDeg: 0,
    durationMin: 210,
    events: [
      { at: 0, kind: 'note', text: 'Close approach. Everything is talking.' },
      { at: 30, kind: 'cut', a: 'earth', b: 'mars', on: true },
      { at: 30, kind: 'note', text: 'Earth and Mars lose their direct line. Mars can still reach the Moon.' },
      { at: 95, kind: 'note', text: 'An hour without Earth. Mars is marked degraded, and keeps trading.' },
      { at: 150, kind: 'cut', a: 'earth', b: 'mars', on: false },
      { at: 150, kind: 'note', text: 'The line is back.' },
    ],
  },
];
