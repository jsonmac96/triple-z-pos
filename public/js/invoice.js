'use strict';
(function () {
  const form = document.getElementById('paper-form');
  const select = document.getElementById('paper-select');
  document.getElementById('paper-apply').hidden = true; // JS on: changing the select applies it
  select.addEventListener('change', () => form.submit());

  // Receipt rolls have no fixed length: size the printed page to fit the receipt.
  const MM_PER_PX = 25.4 / 96;
  let ruleIndex = null;
  function fitReceipt() {
    if (!document.body.classList.contains('kind-receipt')) return;
    const sheet = document.getElementById('paper-css').sheet;
    const inv = document.querySelector('.invoice');
    if (!sheet || !inv) return;
    const width = document.body.dataset.paperWidth || '80mm';
    const heightMm = Math.ceil(inv.scrollHeight * MM_PER_PX) + 8;
    if (ruleIndex !== null) sheet.deleteRule(ruleIndex);
    ruleIndex = sheet.insertRule(`@page { size: ${width} ${heightMm}mm; margin: 0; }`, sheet.cssRules.length);
  }
  window.addEventListener('beforeprint', fitReceipt);
  document.getElementById('print-btn').addEventListener('click', () => { fitReceipt(); window.print(); });
  fitReceipt();
}());
