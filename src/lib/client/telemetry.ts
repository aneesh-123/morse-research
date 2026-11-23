'use client';
import { apiFetch, ApiError, store, uuid } from './api';
import type { EventType } from '../protocol/events';

/**
 * Task-relevant behavioural telemetry. Created only after consent.
 *
 * - Every event has a client-generated UUID and a per-page-load sequence number, so server inserts
 *   are idempotent and ordering is preserved.
 * - Events are queued in localStorage and sent in batches; a batch is removed from the queue only
 *   after the server confirms it. Pending events from an earlier page load are sent on the next one.
 * - Only counts are kept for pointer/keyboard activity, and only inside the study area. No key
 *   values, no text, no mouse trajectories.
 */

type Payload = Record<string, string | number | boolean | null>;

interface QueuedEvent {
  id: string;
  seq: number;
  type: EventType;
  clientLoadId: string;
  clientMs: number;
  clientEpochMs: number;
  trialPosition: number | null;
  screen: string | null;
  payload: Payload;
}

interface ScreenCounters {
  name: string;
  enteredMs: number;
  mouseMoves: number;
  taps: number;
  clicks: number;
  taskClicks: number;
  keyPresses: number;
  idleMs: number;
  hiddenMs: number;
}

export class Telemetry {
  readonly clientLoadId = uuid();
  readonly timeOrigin = performance.timeOrigin;
  private seq = 0;
  private key: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private backoffUntil = 0;
  private screen: ScreenCounters | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleSince: number | null = null;
  private cleanup: (() => void)[] = [];
  dropped = 0;

  /** Live interruption state used by the trial runner. */
  hidden = typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false;
  focused = typeof document !== 'undefined' ? document.hasFocus() : true;
  private hiddenAt: number | null = null;

  constructor(private sessionId: string, private idleThresholdMs: number, private root: () => HTMLElement | null) {
    this.key = `mr_events_${sessionId}`;
  }

  start(): void {
    const on = <K extends keyof DocumentEventMap>(t: EventTarget, type: K | string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.cleanup.push(() => t.removeEventListener(type, fn, opts));
    };
    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.hidden = true;
        this.hiddenAt = performance.now();
        this.log('visibility_hidden');
        void this.flush(true);
      } else {
        this.hidden = false;
        const d = this.hiddenAt === null ? null : Math.round(performance.now() - this.hiddenAt);
        if (this.screen && d !== null) this.screen.hiddenMs += d;
        this.hiddenAt = null;
        this.log('visibility_visible', { payload: { hiddenMs: d } });
      }
    });
    on(window, 'focus', () => { this.focused = true; this.log('window_focus'); });
    on(window, 'blur', () => { this.focused = false; this.log('window_blur'); });
    on(window, 'online', () => { this.log('network_online'); void this.flush(); });
    on(window, 'offline', () => this.log('network_offline'));
    on(window, 'pagehide', () => { this.exitScreen(); this.log('page_unload'); void this.flush(true); });

    const activity = (e: Event) => {
      const el = this.root();
      const inside = el ? el.contains(e.target as Node) : false;
      if (e.type === 'pointermove') {
        if ((e as PointerEvent).pointerType === 'mouse' && this.screen) this.screen.mouseMoves++;
      } else if (e.type === 'pointerdown' && this.screen) {
        const pt = (e as PointerEvent).pointerType;
        if (pt === 'mouse') this.screen.clicks++;
        else this.screen.taps++;
        if (inside && (e.target as HTMLElement | null)?.closest('button, input, [role="button"]')) this.screen.taskClicks++;
      } else if (e.type === 'keydown' && this.screen) {
        // Counted only for keys pressed on study controls; the key itself is never read.
        if (inside && (e.target as HTMLElement | null)?.closest('button, input, [role="button"]')) this.screen.keyPresses++;
      }
      this.bumpIdle();
    };
    for (const t of ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel']) on(document, t, activity, { passive: true });

    this.timer = setInterval(() => void this.flush(), 4000);
    this.bumpIdle();
    void this.flush();
  }

  stop(): void {
    this.exitScreen();
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    if (this.timer) clearInterval(this.timer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    void this.flush(true);
  }

  private bumpIdle(): void {
    const now = performance.now();
    if (this.idleSince !== null) {
      const d = Math.round(now - this.idleSince);
      if (this.screen) this.screen.idleMs += d;
      this.log('idle_end', { payload: { idleMs: d } });
      this.idleSince = null;
    }
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      // Idle is measured from the last interaction, so the threshold counts towards it.
      this.idleSince = performance.now() - this.idleThresholdMs;
      this.log('idle_start', { payload: { thresholdMs: this.idleThresholdMs } });
    }, this.idleThresholdMs);
  }

  enterScreen(name: string, trialPosition: number | null = null): void {
    if (this.screen?.name === name) return;
    this.exitScreen(trialPosition);
    this.screen = { name, enteredMs: performance.now(), mouseMoves: 0, taps: 0, clicks: 0, taskClicks: 0, keyPresses: 0, idleMs: 0, hiddenMs: 0 };
    this.log('screen_enter', { screen: name, trialPosition });
  }

  private exitScreen(trialPosition: number | null = null): void {
    const s = this.screen;
    if (!s) return;
    this.screen = null;
    this.log('screen_exit', {
      screen: s.name,
      trialPosition,
      payload: {
        durationMs: Math.round(performance.now() - s.enteredMs),
        mouseMoves: s.mouseMoves, taps: s.taps, clicks: s.clicks, taskClicks: s.taskClicks, keyPresses: s.keyPresses,
        idleMs: s.idleMs, hiddenMs: s.hiddenMs, eventsDroppedSoFar: this.dropped,
      },
    });
  }

  log(type: EventType, opts: { trialPosition?: number | null; screen?: string | null; payload?: Payload } = {}): void {
    const now = performance.now();
    const ev: QueuedEvent = {
      id: uuid(),
      seq: ++this.seq,
      type,
      clientLoadId: this.clientLoadId,
      clientMs: Math.max(0, now),
      clientEpochMs: this.timeOrigin + now,
      trialPosition: opts.trialPosition ?? null,
      screen: opts.screen ?? this.screen?.name ?? null,
      payload: opts.payload ?? {},
    };
    const q = store.get<QueuedEvent[]>(this.key) ?? [];
    q.push(ev);
    store.set(this.key, q);
    if (q.length >= 25) void this.flush();
  }

  pending(): number {
    return (store.get<QueuedEvent[]>(this.key) ?? []).length;
  }

  async flush(keepalive = false): Promise<void> {
    if (this.flushing && !keepalive) return;
    if (!keepalive && Date.now() < this.backoffUntil) return;
    const q = store.get<QueuedEvent[]>(this.key) ?? [];
    if (!q.length) return;
    const batch = q.slice(0, keepalive ? 50 : 100);
    this.flushing = true;
    try {
      const r = await apiFetch<{ accepted: string[]; duplicates: string[] }>(
        `/api/sessions/${this.sessionId}/events`,
        { events: batch },
        keepalive ? { keepalive: true } : {},
      );
      const done = new Set([...r.accepted, ...r.duplicates]);
      this.removeIds(done);
      this.backoffUntil = 0;
    } catch (e) {
      const err = e as ApiError;
      if (err instanceof ApiError && !err.retryable) {
        // Rejected permanently (e.g. session ended or invalid event). Keep a visible count; never silently.
        this.dropped += batch.length;
        console.warn(`Telemetry batch rejected (${err.code}); ${batch.length} events dropped`);
        this.removeIds(new Set(batch.map((b) => b.id)));
      } else {
        this.backoffUntil = Date.now() + 5000;
      }
    } finally {
      this.flushing = false;
    }
  }

  private removeIds(ids: Set<string>): void {
    const q = store.get<QueuedEvent[]>(this.key) ?? [];
    store.set(this.key, q.filter((e) => !ids.has(e.id)));
  }
}
