let active = 0;

/**
 * Лёгкий конфетти-салют на canvas без зависимостей.
 * Используется при закрытии цели и разблокировке наград.
 */
export function fireConfetti() {
  if (typeof document === 'undefined' || active > 2) return;
  active += 1;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const context = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#e7e7ff', '#9b5de5'];
  const particles = Array.from({ length: 140 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 200,
    y: canvas.height * 0.35,
    vx: (Math.random() - 0.5) * 12,
    vy: Math.random() * -11 - 4,
    size: Math.random() * 6 + 3,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.3,
  }));

  const startedAt = performance.now();
  function frame(now) {
    const elapsed = now - startedAt;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const particle of particles) {
      particle.vy += 0.25;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.spin;
      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.6);
      context.restore();
    }
    if (elapsed < 1800) requestAnimationFrame(frame);
    else {
      canvas.remove();
      active -= 1;
    }
  }
  requestAnimationFrame(frame);
}
