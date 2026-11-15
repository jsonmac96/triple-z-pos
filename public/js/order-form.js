'use strict';
(function () {
  const tbody = document.querySelector('#items tbody');
  const totalEl = document.getElementById('form-total');
  const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

  function recalc() {
    let total = 0;
    tbody.querySelectorAll('tr').forEach((tr) => {
      const qty = Number(tr.querySelector('.qty').value) || 0;
      const price = Number(String(tr.querySelector('.price').value).replace(/[,\s₱]/g, '')) || 0;
      total += qty * price;
    });
    totalEl.textContent = peso.format(total);
  }

  document.getElementById('add-row').addEventListener('click', () => {
    const tr = tbody.querySelector('tr').cloneNode(true);
    tr.querySelectorAll('input').forEach((i) => { i.value = i.classList.contains('qty') ? '1' : ''; });
    tbody.appendChild(tr);
    tr.querySelector('input').focus();
    recalc();
  });

  tbody.addEventListener('click', (e) => {
    if (!e.target.classList.contains('remove-row')) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length > 1) e.target.closest('tr').remove();
    else rows[0].querySelectorAll('input').forEach((i) => { i.value = ''; });
    recalc();
  });
  tbody.addEventListener('input', recalc);
  recalc();
}());
