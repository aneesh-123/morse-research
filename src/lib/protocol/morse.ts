/**
 * International Morse code mapping and signal timing.
 *
 * The letter mapping matches `scripts/morse-dictionary.js` in AceCentre/morse-learn
 * (Apache-2.0, Copyright 2018 Google Inc.), which this project credits in NOTICE.
 * Patterns use "." for a dot and "-" for a dash.
 *
 * Pure module: no browser or server dependencies, so it is shared by the audio
 * engine, the scheduler, the estimator and the tests.
 */

export const MORSE_LETTERS: Readonly<Record<string, string>> = Object.freeze({
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
});

export function patternFor(char: string): string {
  const p = MORSE_LETTERS[char.toUpperCase()];
  if (!p) throw new Error(`No Morse pattern for character "${char}"`);
  return p;
}

/** Human-readable pattern using middle dot and minus sign, e.g. "·−". */
export function displayPattern(pattern: string): string {
  return pattern.replace(/\./g, '·').replace(/-/g, '−');
}

export interface AudioParams {
  /** Character speed in words per minute (PARIS standard). */
  wpm: number;
  /** Tone frequency in Hz. */
  frequencyHz: number;
  /** Peak gain, 0..1, applied by the Web Audio gain envelope. */
  gain: number;
  /** Linear attack/release ramp in ms, to avoid clicks. Included inside each element's duration. */
  rampMs: number;
  /** Silence between the play request and the first element, in ms. */
  leadInMs: number;
}

/** Length of one Morse unit (a dot) in ms for a given WPM: 1200 / wpm (PARIS standard). */
export function unitMs(wpm: number): number {
  if (!(wpm > 0)) throw new Error('wpm must be positive');
  return 1200 / wpm;
}

export interface ToneSegment {
  /** Offset from signal start (after lead-in) in ms. */
  startMs: number;
  durationMs: number;
  kind: 'dot' | 'dash';
}

/**
 * Timing of one character: dot = 1 unit, dash = 3 units, gap between elements = 1 unit.
 * Returned offsets are relative to the start of the first element (lead-in excluded).
 */
export function signalSegments(pattern: string, wpm: number): { segments: ToneSegment[]; durationMs: number } {
  if (!/^[.-]+$/.test(pattern)) throw new Error(`Invalid pattern "${pattern}"`);
  const u = unitMs(wpm);
  const segments: ToneSegment[] = [];
  let t = 0;
  [...pattern].forEach((sym, i) => {
    if (i > 0) t += u; // intra-character gap
    const d = sym === '.' ? u : 3 * u;
    segments.push({ startMs: t, durationMs: d, kind: sym === '.' ? 'dot' : 'dash' });
    t += d;
  });
  return { segments, durationMs: t };
}

/** Total signal duration in ms (first element onset to last element offset). */
export function signalDurationMs(pattern: string, wpm: number): number {
  return signalSegments(pattern, wpm).durationMs;
}
