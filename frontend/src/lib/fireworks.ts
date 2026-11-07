/** Canvas fireworks. Intense for the first few seconds, then a calm ambience. Does nothing for reduced motion. */
interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; size: number }

export function startFireworks(canvas: HTMLCanvasElement, opts: { intenseMs?: number; onPop?: () => void } = {}): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => undefined;
  const intenseMs = opts.intenseMs ?? 8000;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0;
  const resize = () => {
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const parts: P[] = [];
  const HUES = [45, 40, 50, 200, 330, 0];
  function burst(big: boolean) {
    const x = w * (0.1 + Math.random() * 0.8);
    const y = h * (0.12 + Math.random() * 0.45);
    const n = big ? 90 : 45;
    const hue = HUES[Math.floor(Math.random() * HUES.length)]!;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
      const s = (big ? 2.2 : 1.4) + Math.random() * (big ? 4.2 : 2.4);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 70 + Math.random() * 40, hue: hue + Math.random() * 20 - 10, size: 1.5 + Math.random() * 1.5 });
    }
    opts.onPop?.();
  }

  const t0 = performance.now();
  let last = t0, nextBurst = t0, raf = 0;
  function frame(now: number) {
    const intense = now - t0 < intenseMs;
    if (now >= nextBurst) {
      burst(intense);
      if (intense && Math.random() < 0.5) burst(true);
      nextBurst = now + (intense ? 280 + Math.random() * 300 : 2200 + Math.random() * 1800);
    }
    const dt = Math.min(2, (now - last) / 16.67);
    last = now;
    ctx!.globalCompositeOperation = "destination-out";
    ctx!.fillStyle = "rgba(0,0,0,0.22)";
    ctx!.fillRect(0, 0, w, h);
    ctx!.globalCompositeOperation = "lighter";
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]!;
      p.life += dt;
      if (p.life > p.max) { parts.splice(i, 1); continue; }
      p.vy += 0.04 * dt; p.vx *= 0.99; p.vy *= 0.99;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const alpha = 1 - p.life / p.max;
      ctx!.fillStyle = `hsla(${p.hue}, 90%, ${60 + 20 * alpha}%, ${alpha})`;
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, p.size * (0.6 + alpha * 0.6), 0, Math.PI * 2);
      ctx!.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); ctx.clearRect(0, 0, w, h); };
}
