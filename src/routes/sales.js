'use strict';
const express = require('express');
const { query, validationResult } = require('express-validator');
const { salesReport } = require('../services/sales');
const { manilaDay, addDays } = require('../format');
const { METHOD_LABELS } = require('../services/orders');

const RANGES = ['today', 'week', 'month', 'custom'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function presetRange(range, today) {
  if (range === 'today') return { range, from: today, to: today };
  if (range === 'month') return { range, from: `${today.slice(0, 8)}01`, to: today };
  return { range: 'week', from: addDays(today, -6), to: today };
}

function resolveRange(q) {
  const today = manilaDay();
  const preset = presetRange(RANGES.includes(q.range) ? q.range : 'week', today);
  const hasDates = DAY_RE.test(q.from || '') && DAY_RE.test(q.to || '');
  // Use the typed dates when "custom" is chosen, or when the dates were edited away from the preset.
  if (hasDates && (q.range === 'custom' || q.from !== preset.from || q.to !== preset.to)) {
    let { from, to } = q;
    if (from > to) [from, to] = [to, from];
    if (from < addDays(to, -366)) from = addDays(to, -366); // cap at about a year
    return { range: 'custom', from, to };
  }
  return preset;
}

/** Escape a CSV cell and neutralise spreadsheet formula injection. */
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const validators = [
  query('range').optional().isIn(RANGES),
  query('from').optional().matches(DAY_RE).isISO8601({ strict: true }),
  query('to').optional().matches(DAY_RE).isISO8601({ strict: true }),
];

module.exports = function salesRoutes(db) {
  const router = express.Router();

  router.get('/', validators, (req, res) => {
    const q = validationResult(req).isEmpty() ? req.query : {};
    const r = resolveRange(q);
    const report = salesReport(db, r.from, r.to);
    res.render('sales/history', { title: 'Sales history', report, range: r.range });
  });

  router.get('/export.csv', validators, (req, res) => {
    const q = validationResult(req).isEmpty() ? req.query : {};
    const r = resolveRange(q);
    const report = salesReport(db, r.from, r.to);
    const lines = [['Paid at (UTC)', 'Order no', 'Customer', 'Method', 'Reference', 'Amount (PHP)', 'Received by'].join(',')];
    for (const p of report.payments) {
      lines.push([p.paid_at, p.order_no, p.customer_name, METHOD_LABELS[p.method], p.reference, (p.amount_cents / 100).toFixed(2), p.received_by_name || '']
        .map(csvCell).join(','));
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="triplez-sales-${r.from}-to-${r.to}.csv"`);
    res.send(`﻿${lines.join('\r\n')}\r\n`);
  });

  return router;
};

module.exports.csvCell = csvCell;
