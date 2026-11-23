'use client';
import { signalSegments, type AudioParams } from '../protocol/morse';

/**
 * Deterministic Morse playback with the Web Audio API.
 *
 * One oscillator per playback; a gain envelope switches the tone on for each element with a short
 * linear ramp (included in the element duration) to avoid clicks. Element timing comes from the
 * protocol's AudioParams, so every participant hears identical signals.
 *
 * All returned times are page-monotonic milliseconds (performance.now()).
 */

export interface PlaybackRecord {
  requestedMs: number;
  /** Estimated time the first element reaches the output, from getOutputTimestamp when available. */
  startEstMs: number;
  endExpectedMs: number;
  /** Time the oscillator's `ended` event fired (main-thread observation). Null if interrupted. */
  endObservedMs: number | null;
  durationMs: number;
  outputLatencyMs: number | null;
  interrupted: boolean;
  /** True when the oscillator's `ended` event never arrived and the watchdog finished the playback. */
  endEventMissing: boolean;
}

/** Grace period after the expected end before the watchdog gives up waiting for `ended`. */
const END_WATCHDOG_GRACE_MS = 2000;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export class MorseAudio {
  private ctx: AudioContext | null = null;
  private current: { osc: OscillatorNode; resolve: (r: PlaybackRecord) => void; rec: PlaybackRecord } | null = null;

  get supported(): boolean {
    return typeof window !== 'undefined' && Boolean(window.AudioContext || (window as WebkitWindow).webkitAudioContext);
  }

  get state(): AudioContextState | 'none' {
    return this.ctx ? this.ctx.state : 'none';
  }

  /** Must be called from a user gesture (tap/click). */
  async unlock(): Promise<void> {
    if (!this.supported) throw new Error('This browser does not support Web Audio.');
    // Safari 16.4+: play through the ringer/silent switch like media playback.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try {
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* not supported */
    }
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      this.ctx = new (Ctor as typeof AudioContext)({ latencyHint: 'interactive' });
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    // A silent buffer finishes the unlock on older iOS versions.
    const buf = this.ctx.createBuffer(1, 1, 22050);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start(0);
  }

  info() {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    return {
      sampleRate: c?.sampleRate ?? null,
      baseLatencyMs: c?.baseLatency !== undefined ? c.baseLatency * 1000 : null,
      outputLatencyMs: c?.outputLatency !== undefined ? c.outputLatency * 1000 : null,
      hasGetOutputTimestamp: typeof c?.getOutputTimestamp === 'function',
    };
  }

  isPlaying(): boolean {
    return this.current !== null;
  }

  async play(pattern: string, p: AudioParams): Promise<PlaybackRecord> {
    if (!this.ctx) throw new Error('Audio is not enabled yet.');
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this.ctx.state !== 'running') throw new Error('Audio is paused by the browser. Tap to continue.');
    this.stop();
    const ctx = this.ctx;
    const { segments, durationMs } = signalSegments(pattern, p.wpm);
    const requestedMs = performance.now();
    const t0 = ctx.currentTime + p.leadInMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = p.frequencyHz;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    const ramp = Math.min(p.rampMs, 10) / 1000;
    for (const s of segments) {
      const a = t0 + s.startMs / 1000;
      const b = a + s.durationMs / 1000;
      gain.gain.setValueAtTime(0, a);
      gain.gain.linearRampToValueAtTime(p.gain, a + ramp);
      gain.gain.setValueAtTime(p.gain, b - ramp);
      gain.gain.linearRampToValueAtTime(0, b);
    }
    osc.connect(gain).connect(ctx.destination);
    const tEnd = t0 + durationMs / 1000;
    osc.start(t0);
    osc.stop(tEnd);

    let startEstMs = requestedMs + (t0 - ctx.currentTime) * 1000;
    const c2 = ctx as AudioContext & { outputLatency?: number };
    try {
      if (typeof ctx.getOutputTimestamp === 'function') {
        const ts = ctx.getOutputTimestamp();
        if (ts.performanceTime && ts.contextTime !== undefined && ts.performanceTime > 0) {
          startEstMs = ts.performanceTime + (t0 - ts.contextTime) * 1000;
        }
      }
    } catch {
      /* keep scheduler estimate */
    }
    const rec: PlaybackRecord = {
      requestedMs,
      startEstMs,
      endExpectedMs: startEstMs + durationMs,
      endObservedMs: null,
      durationMs,
      outputLatencyMs: c2.outputLatency !== undefined ? c2.outputLatency * 1000 : null,
      interrupted: false,
      endEventMissing: false,
    };
    return new Promise<PlaybackRecord>((resolve) => {
      this.current = { osc, resolve, rec };
      // If the audio clock stalls (output device change, OS audio interruption) `ended` may never
      // fire. The watchdog then finishes the playback so the participant is not stuck; the record
      // carries endEventMissing and no observed end time.
      const watchdog = setTimeout(() => {
        if (this.current?.osc !== osc) return;
        rec.endEventMissing = true;
        this.current = null;
        try {
          osc.onended = null;
          osc.stop();
        } catch {
          /* already stopped */
        }
        gain.disconnect();
        resolve(rec);
      }, p.leadInMs + durationMs + END_WATCHDOG_GRACE_MS);
      osc.onended = () => {
        if (this.current?.osc !== osc) return;
        clearTimeout(watchdog);
        rec.endObservedMs = performance.now();
        this.current = null;
        gain.disconnect();
        resolve(rec);
      };
    });
  }

  /** Stops playback; a pending play() resolves with interrupted = true. */
  stop(): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    cur.rec.interrupted = true;
    try {
      cur.osc.onended = null;
      cur.osc.stop();
    } catch {
      /* already stopped */
    }
    cur.resolve(cur.rec);
  }

  async suspend(): Promise<void> {
    this.stop();
    try {
      await this.ctx?.suspend();
    } catch {
      /* ignore */
    }
  }
}

let shared: MorseAudio | null = null;
export function morseAudio(): MorseAudio {
  shared ??= new MorseAudio();
  return shared;
}
