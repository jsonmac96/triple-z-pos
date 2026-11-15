'use strict';

/**
 * Paper sizes the invoice can be printed on. `width`/`height` are CSS lengths used by
 * public/css/paper/<key>.css; receipts have no fixed height (it follows the content).
 */
const PAPERS = {
  letter: { label: 'Short bond / Letter (8.5 × 11 in)', kind: 'sheet', width: '8.5in', height: '11in' },
  a4: { label: 'A4 (210 × 297 mm)', kind: 'sheet', width: '210mm', height: '297mm' },
  longbond: { label: 'Long bond / Folio (8.5 × 13 in)', kind: 'sheet', width: '8.5in', height: '13in' },
  legal: { label: 'Legal (8.5 × 14 in)', kind: 'sheet', width: '8.5in', height: '14in' },
  a5: { label: 'A5 half sheet (148 × 210 mm)', kind: 'half', width: '148mm', height: '210mm' },
  halfletter: { label: 'Half letter (5.5 × 8.5 in)', kind: 'half', width: '5.5in', height: '8.5in' },
  thermal80: { label: 'Thermal receipt 80 mm', kind: 'receipt', width: '80mm', height: null },
  thermal58: { label: 'Thermal receipt 58 mm', kind: 'receipt', width: '58mm', height: null },
};

const KIND_LABELS = { sheet: 'Bond paper', half: 'Half sheet', receipt: 'Receipt printer' };
const DEFAULT_PAPER = 'letter';

function isPaper(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(PAPERS, key);
}

function getPaper(key) {
  const k = isPaper(key) ? key : DEFAULT_PAPER;
  return { key: k, ...PAPERS[k] };
}

module.exports = { PAPERS, KIND_LABELS, DEFAULT_PAPER, isPaper, getPaper };
