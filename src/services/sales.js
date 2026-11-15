'use strict';
const { manilaDay, dayStartIso, addDays } = require('../format');

/** Sales (payments received) between two Manila calendar days, inclusive. */
function salesReport(db, fromDay, toDay) {
  const from = dayStartIso(fromDay);
  const to = dayStartIso(addDays(toDay, 1));
  const payments = db.prepare(`SELECT p.*, o.order_no, o.customer_name, u.display_name AS received_by_name
    FROM payments p JOIN orders o ON o.id = p.order_id LEFT JOIN users u ON u.id = p.received_by
    WHERE p.paid_at >= ? AND p.paid_at < ? ORDER BY p.paid_at DESC`).all(from, to);
  const byDay = db.prepare(`SELECT date(paid_at, '+8 hours') AS day, SUM(amount_cents) AS total_cents, COUNT(*) AS count
    FROM payments WHERE paid_at >= ? AND paid_at < ? GROUP BY day ORDER BY day DESC`).all(from, to);
  const byMethod = db.prepare(`SELECT method, SUM(amount_cents) AS total_cents, COUNT(*) AS count
    FROM payments WHERE paid_at >= ? AND paid_at < ? GROUP BY method ORDER BY total_cents DESC`).all(from, to);
  const total_cents = payments.reduce((s, p) => s + p.amount_cents, 0);
  return { fromDay, toDay, payments, byDay, byMethod, total_cents, count: payments.length };
}

function dashboardStats(db, now = new Date()) {
  const today = manilaDay(now);
  const tomorrowStart = dayStartIso(addDays(today, 1));
  const todayStart = dayStartIso(today);
  const nowIso = now.toISOString();
  const one = (sql, ...p) => db.prepare(sql).get(...p);

  const todaySales = one('SELECT COALESCE(SUM(amount_cents),0) AS v FROM payments WHERE paid_at >= ? AND paid_at < ?', todayStart, tomorrowStart).v;
  const openOrders = one("SELECT COUNT(*) AS v FROM orders WHERE status IN ('pending','in_progress','ready')").v;
  const dueToday = one("SELECT COUNT(*) AS v FROM orders WHERE status IN ('pending','in_progress') AND deadline_at >= ? AND deadline_at < ?", nowIso, tomorrowStart).v;
  const overdue = one("SELECT COUNT(*) AS v FROM orders WHERE status IN ('pending','in_progress') AND deadline_at < ?", nowIso).v;
  const ready = one("SELECT COUNT(*) AS v FROM orders WHERE status = 'ready'").v;

  const startDay = addDays(today, -6);
  const rows = db.prepare(`SELECT date(paid_at, '+8 hours') AS day, SUM(amount_cents) AS total_cents FROM payments
    WHERE paid_at >= ? AND paid_at < ? GROUP BY day`).all(dayStartIso(startDay), tomorrowStart);
  const map = new Map(rows.map((r) => [r.day, r.total_cents]));
  const week = [];
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(startDay, i);
    week.push({ day, total_cents: map.get(day) || 0 });
  }
  const weekMax = Math.max(1, ...week.map((d) => d.total_cents));
  const weekTotal = week.reduce((s, d) => s + d.total_cents, 0);
  return { today, todaySales, openOrders, dueToday, overdue, ready, week, weekMax, weekTotal };
}

module.exports = { salesReport, dashboardStats };
