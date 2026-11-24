'use client';

/** Bump when the participant interface changes in a way that could affect behaviour. ui-v1 = first pilot design. */
export const UI_VERSION = 'ui-v3';

/**
 * Coarse device description (category, browser family, OS family, touch, viewport).
 * Deliberately avoids fingerprinting signals such as fonts, canvas, plugins or full user agent.
 */
export function deviceInfo(audio: { sampleRate: number | null; baseLatencyMs: number | null; outputLatencyMs: number | null; hasGetOutputTimestamp: boolean }) {
  const ua = navigator.userAgent;
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isIpadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const minSide = Math.min(screen.width, screen.height);
  let deviceCategory: 'mobile' | 'tablet' | 'desktop' | 'unknown' = 'desktop';
  if (/iPad|Tablet/.test(ua) || isIpadOs || (/Android/.test(ua) && !/Mobile/.test(ua))) deviceCategory = 'tablet';
  else if (/Mobi|iPhone|Android/.test(ua)) deviceCategory = 'mobile';
  else if (touch && minSide < 600) deviceCategory = 'mobile';
  const browserFamily =
    /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
      : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const osFamily = /iPhone|iPad|iPod/.test(ua) || isIpadOs ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  return {
    deviceCategory,
    browserFamily,
    osFamily,
    touch,
    maxTouchPoints: Math.min(64, navigator.maxTouchPoints || 0),
    viewportWidth: Math.round(window.innerWidth),
    viewportHeight: Math.round(window.innerHeight),
    devicePixelRatio: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    audioSampleRate: audio.sampleRate,
    audioBaseLatencyMs: audio.baseLatencyMs,
    audioOutputLatencyMs: audio.outputLatencyMs,
    hasGetOutputTimestamp: audio.hasGetOutputTimestamp,
    prefersReducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    uiVersion: UI_VERSION,
  };
}
