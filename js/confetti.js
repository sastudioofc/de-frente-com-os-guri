// Confete leve em canvas (roda só durante a animação).
const COLORS = ['#ecc97a', '#c9a14a', '#fff0c9', '#e2563b', '#74492a', '#ffffff'];

export function confetti({ count = 160, duration = 3200, origin = null } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.getElementById('confetti');
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const ox = origin ? origin.x : innerWidth / 2;
  const oy = origin ? origin.y : innerHeight * 0.35;
  const parts = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2;
    const sp = 4 + Math.random() * 9;
    return {
      x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 10, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      c: COLORS[(Math.random() * COLORS.length) | 0], shape: Math.random() < 0.3 ? 1 : 0,
    };
  });
  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.22; p.vx *= 0.99; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save();
      g.globalAlpha = Math.max(0, 1 - t / duration);
      g.translate(p.x, p.y); g.rotate(p.r);
      g.fillStyle = p.c;
      if (p.shape) { g.beginPath(); g.arc(0, 0, p.w / 2, 0, Math.PI * 2); g.fill(); }
      else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      g.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else g.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(frame);
}
