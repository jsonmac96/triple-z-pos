'use strict';
(function () {
  const kind = document.getElementById('kind-select');
  const stock = document.getElementById('stock-fields');
  if (!kind || !stock) return;
  const sync = () => stock.classList.toggle('is-hidden', kind.value === 'service');
  kind.addEventListener('change', sync);
  sync();
}());
