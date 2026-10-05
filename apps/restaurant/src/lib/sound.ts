/**
 * The new-order chime (Bloc 10, docs/33 §order-board "+ son"). A synthesized
 * two-tone beep via the Web Audio API — no audio asset to ship, host, or get
 * blocked by a content pipeline that doesn't exist yet (docs/32-adjacent
 * debt: the object-storage adapter is still a Bloc-0 placeholder). Browsers
 * require a user gesture before any audio context may produce sound; this is
 * called from a click handler (`OrderBoard`'s "Activer le son" button) for
 * exactly that reason — see its call site.
 */
let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx ??= new Ctor();
  return audioCtx;
}

function beep(ctx: AudioContext, startAt: number, frequency: number, durationSec: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.25, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec);
}

/** Resumes/creates the audio context — call this directly from a click handler to satisfy the browser's user-gesture requirement. */
export function primeSound(): void {
  const ctx = getContext();
  if (ctx?.state === 'suspended') void ctx.resume();
}

/** Plays the "new order" chime — a no-op if the browser blocked audio (no prior user gesture) or has no Web Audio support. */
export function playNewOrderChime(): void {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  beep(ctx, now, 880, 0.15);
  beep(ctx, now + 0.18, 1175, 0.2);
}
