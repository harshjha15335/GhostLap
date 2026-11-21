/**
 * Tiny WebAudio "tick" for the kinetic letters. Muted by default; the
 * AudioContext is only created after the user explicitly enables sound.
 */
let ctx: AudioContext | null = null;
let enabled = false;

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (on && !ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (on) void ctx?.resume();
}

export function isSoundEnabled() {
  return enabled;
}

export function tick(pitch = 1) {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1400 * pitch, t);
  osc.frequency.exponentialRampToValueAtTime(380 * pitch, t + 0.05);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.08, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.08);
}

export function disposeSound() {
  void ctx?.close();
  ctx = null;
  enabled = false;
}
