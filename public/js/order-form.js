'use strict';
(function () {
  const tbody = document.querySelector('#items tbody');
  const totalEl = document.getElementById('form-total');
  const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
  const readJson = (id) => { try { return JSON.parse(document.getElementById(id).textContent || '[]'); } catch { return []; } };
  const products = new Map(readJson('picker-products').map((p) => [String(p.id), p]));
  const customers = readJson('picker-customers');

  function recalc() {
    let total = 0;
    tbody.querySelectorAll('tr').forEach((tr) => {
      const qty = Number(tr.querySelector('.qty').value) || 0;
      const price = Number(String(tr.querySelector('.price').value).replace(/[,\s₱]/g, '')) || 0;
      total += qty * price;
    });
    totalEl.textContent = peso.format(total);
  }

  // ---- Service / item picker per row ----
  tbody.addEventListener('change', (e) => {
    if (!e.target.classList.contains('pick')) return;
    const tr = e.target.closest('tr');
    const p = products.get(e.target.value);
    tr.querySelector('.product-id').value = p ? String(p.id) : '';
    if (p) {
      tr.querySelector('input[name=item]').value = p.name;
      tr.querySelector('.price').value = (p.price_cents / 100).toFixed(2);
      const qty = tr.querySelector('.qty');
      if (!qty.value) qty.value = '1';
      qty.focus();
      qty.select();
    }
    recalc();
  });

  document.getElementById('add-row').addEventListener('click', () => {
    const tr = tbody.querySelector('tr').cloneNode(true);
    tr.querySelectorAll('input').forEach((i) => { i.value = i.classList.contains('qty') ? '1' : ''; });
    tr.querySelector('.pick').value = '';
    tbody.appendChild(tr);
    tr.querySelector('.pick').focus();
    recalc();
  });

  tbody.addEventListener('click', (e) => {
    if (!e.target.classList.contains('remove-row')) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length > 1) e.target.closest('tr').remove();
    else {
      rows[0].querySelectorAll('input').forEach((i) => { i.value = ''; });
      rows[0].querySelector('.pick').value = '';
    }
    recalc();
  });
  tbody.addEventListener('input', recalc);
  recalc();

  // ---- Customer picker: choosing an existing customer fills phone/email ----
  const nameEl = document.getElementById('customer-name');
  const idEl = document.getElementById('customer-id');
  const phoneEl = document.getElementById('customer-phone');
  const emailEl = document.getElementById('customer-email');
  const hint = document.getElementById('customer-hint');
  function matchCustomer() {
    const name = nameEl.value.trim().toLowerCase();
    const current = customers.find((c) => String(c.id) === idEl.value);
    if (current && current.name.toLowerCase() === name) return; // still the same customer
    const found = name ? customers.find((c) => c.name.toLowerCase() === name) : null;
    idEl.value = found ? String(found.id) : '';
    if (found) {
      if (!phoneEl.value) phoneEl.value = found.phone || '';
      if (!emailEl.value) emailEl.value = found.email || '';
    }
    hint.textContent = found ? `Existing customer${found.phone ? ` · ${found.phone}` : ''}` : 'New customers are saved automatically.';
    hint.classList.toggle('ok', Boolean(found));
  }
  nameEl.addEventListener('change', matchCustomer);
  nameEl.addEventListener('input', () => { if (!nameEl.value.trim()) matchCustomer(); });
  if (idEl.value) hint.classList.add('ok');
}());
