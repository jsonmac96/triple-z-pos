'use strict';

const DAY = 24 * 60 * 60 * 1000;
const BUCKETS = [
  { key: '0-7', label: '0–7 days', min: 0, max: 7 },
  { key: '8-30', label: '8–30 days', min: 8, max: 30 },
  { key: '31-60', label: '31–60 days', min: 31, max: 60 },
  { key: '60+', label: 'Over 60 days', min: 61, max: Infinity },
];

function bucketFor(days) {
  return BUCKETS.find((b) => days >= b.min && days <= b.max).key;
}

/** Orders that still have money owed (not cancelled), oldest first. */
function collections(db, { q = '', bucket = '' } = {}, now = Date.now()) {
  const params = [];
  let search = '';
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    search = "AND (o.order_no LIKE ? ESCAPE '\\' OR o.customer_name LIKE ? ESCAPE '\\' OR o.customer_phone LIKE ? ESCAPE '\\')";
    params.push(like, like, like);
  }
  const rows = db.prepare(`SELECT * FROM (
      SELECT o.id, o.order_no, o.customer_name, o.customer_phone, o.customer_id, o.status, o.created_at, o.deadline_at,
        COALESCE((SELECT SUM(qty * unit_price_cents) FROM order_items WHERE order_id = o.id), 0) AS total_cents,
        COALESCE((SELECT SUM(amount_cents) FROM payments WHERE order_id = o.id), 0) AS paid_cents
      FROM orders o WHERE o.status != 'cancelled' ${search}
    ) WHERE total_cents > paid_cents ORDER BY created_at ASC`).all(...params);

  const all = rows.map((r) => {
    const days = Math.max(0, Math.floor((now - new Date(r.created_at).getTime()) / DAY));
    return { ...r, balance_cents: r.total_cents - r.paid_cents, days, bucket: bucketFor(days) };
  });
  const summary = {
    total_cents: all.reduce((s, r) => s + r.balance_cents, 0),
    count: all.length,
    released_cents: all.filter((r) => r.status === 'released').reduce((s, r) => s + r.balance_cents, 0),
    released_count: all.filter((r) => r.status === 'released').length,
    buckets: BUCKETS.map((b) => {
      const inB = all.filter((r) => r.bucket === b.key);
      return { ...b, count: inB.length, total_cents: inB.reduce((s, r) => s + r.balance_cents, 0) };
    }),
  };
  const byCustomer = new Map();
  for (const r of all) {
    const key = r.customer_id ? `c${r.customer_id}` : `n${r.customer_name.toLowerCase()}`;
    const e = byCustomer.get(key) || { customer_id: r.customer_id, name: r.customer_name, phone: r.customer_phone, count: 0, balance_cents: 0 };
    e.count += 1; e.balance_cents += r.balance_cents;
    byCustomer.set(key, e);
  }
  summary.topCustomers = [...byCustomer.values()].sort((a, b) => b.balance_cents - a.balance_cents).slice(0, 5);
  const list = bucket && BUCKETS.some((b) => b.key === bucket) ? all.filter((r) => r.bucket === bucket) : all;
  return { rows: list, summary };
}

module.exports = { BUCKETS, collections };
