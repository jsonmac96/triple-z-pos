'use strict';
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

  // Count-up numbers
  document.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    const money = el.dataset.money === '1';
    const show = (v) => { el.textContent = money ? peso.format(v / 100) : String(Math.round(v)); };
    if (reduce || target === 0) return show(target);
    const duration = 1100;
    const start = performance.now() + 250;
    show(0);
    function tick(now) {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      show(target * eased);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  // Grow the sales bars
  const bars = document.querySelectorAll('.bar[data-pct]');
  const grow = () => bars.forEach((b) => { b.style.height = `${Math.max(1, Number(b.dataset.pct) || 0)}%`; });
  if (reduce) grow(); else setTimeout(grow, 500);
}());
