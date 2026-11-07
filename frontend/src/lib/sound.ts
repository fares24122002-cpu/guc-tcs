/** Original synthesized sounds (WebAudio). Nothing is downloaded and nothing is copyrighted. */
let ctx: AudioContext | null = null;

export function unlockAudio(): boolean {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx.state === "running";
  } catch {
    return false;
  }
}
export const audioReady = () => ctx?.state === "running";

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, endFreq?: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + start);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

export const sounds = {
  start() { tone(180, 0, 0.9, "sawtooth", 0.08, 720); tone(90, 0, 0.9, "sine", 0.12, 360); },
  tick(final: boolean) { tone(final ? 1320 : 880, 0, 0.09, "square", final ? 0.07 : 0.04); },
  reveal() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.07, 1.6, "triangle", 0.09));
    tone(130.8, 0, 1.8, "sine", 0.14);
    tone(2093, 0.28, 1.1, "sine", 0.04);
  },
  pop() { tone(300 + Math.random() * 400, 0, 0.18, "triangle", 0.035, 80); },
};
