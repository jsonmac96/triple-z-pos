'use strict';
const { classify, timeLeftText, LEVELS } = require('./urgency');
const { findOrCreateCustomer } = require('./customers');
const { orderStockEffect, syncOrderStock } = require('./inventory');

const STATUSES = ['pending', 'in_progress', 'ready', 'released', 'cancelled'];
const STATUS_LABELS = {
  pending: 'Pending', in_progress: 'In progress', ready: 'Ready for pickup', released: 'Released', cancelled: 'Cancelled',
};
const PRIORITIES = ['normal', 'rush'];
const METHODS = ['cash', 'gcash', 'bank', 'other'];
const METHOD_LABELS = { cash: 'Cash', gcash: 'GCash', bank: 'Bank transfer', other: 'Other' };

const TOTALS_SQL = `
  SELECT o.*,
    COALESCE((SELECT SUM(qty * unit_price_cents) FROM order_items WHERE order_id = o.id), 0) AS total_cents,
    COALESCE((SELECT SUM(amount_cents) FROM payments WHERE order_id = o.id), 0) AS paid_cents,
    u.display_name AS created_by_name,
    c.address AS customer_address
  FROM orders o LEFT JOIN users u ON u.id = o.created_by LEFT JOIN customers c ON c.id = o.customer_id`;

function decorate(order, now = Date.now()) {
  if (!order) return order;
  order.balance_cents = order.total_cents - order.paid_cents;
  order.urgency = classify(order, now);
  order.urgency_label = LEVELS[order.urgency].label;
  order.time_left = timeLeftText(order, now);
  order.status_label = STATUS_LABELS[order.status];
  return order;
}

function nextOrderNo(db, now = new Date()) {
  const year = now.getUTCFullYear();
  const prefix = `TZ-${year}-`;
  const row = db
    .prepare("SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY order_no DESC LIMIT 1")
    .get(`${prefix}%`);
  const n = row ? parseInt(row.order_no.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}

function insertItems(db, orderId, items) {
  const stmt = db.prepare('INSERT INTO order_items (order_id, item, qty, unit_price_cents, product_id) VALUES (?,?,?,?,?)');
  for (const it of items) stmt.run(orderId, it.item, it.qty, it.unit_price_cents, it.product_id || null);
}

/** Link the order to a customer: the one picked, else a match by phone/name, else a new customer. */
function resolveCustomer(db, data) {
  if (data.customer_id && db.prepare('SELECT 1 FROM customers WHERE id = ?').get(data.customer_id)) return data.customer_id;
  return findOrCreateCustomer(db, { name: data.customer_name, phone: data.customer_phone, email: data.customer_email });
}

/** Returns { id, warnings } where warnings lists items that are now low or out of stock. */
function createOrder(db, data, userId) {
  return db.transaction(() => {
    const orderNo = nextOrderNo(db);
    const customerId = resolveCustomer(db, data);
    const info = db.prepare(`INSERT INTO orders
      (order_no, customer_name, customer_phone, customer_email, description, priority, deadline_at, notes, created_by, customer_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      orderNo, data.customer_name, data.customer_phone, data.customer_email, data.description,
      data.priority, data.deadline_at, data.notes, userId, customerId
    );
    const id = Number(info.lastInsertRowid);
    insertItems(db, id, data.items);
    const warnings = syncOrderStock(db, {}, orderStockEffect(db, id), id, userId);
    return { id, warnings };
  })();
}

/** Returns { ok, warnings }. */
function updateOrder(db, id, data, userId = null) {
  return db.transaction(() => {
    const before = orderStockEffect(db, id);
    const customerId = resolveCustomer(db, data);
    const res = db.prepare(`UPDATE orders SET customer_name=?, customer_phone=?, customer_email=?, description=?,
      priority=?, deadline_at=?, notes=?, customer_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(
      data.customer_name, data.customer_phone, data.customer_email, data.description,
      data.priority, data.deadline_at, data.notes, customerId, id
    );
    if (res.changes === 0) return { ok: false, warnings: [] };
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
    insertItems(db, id, data.items);
    const warnings = syncOrderStock(db, before, orderStockEffect(db, id), id, userId);
    return { ok: true, warnings };
  })();
}

/** Returns { ok, warnings }. Cancelling returns stock; un-cancelling takes it again. */
function setStatus(db, id, status, userId = null) {
  if (!STATUSES.includes(status)) throw new Error('invalid status');
  return db.transaction(() => {
    const before = orderStockEffect(db, id);
    const ok = db.prepare("UPDATE orders SET status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
      .run(status, id).changes > 0;
    const warnings = ok ? syncOrderStock(db, before, orderStockEffect(db, id), id, userId) : [];
    return { ok, warnings };
  })();
}

function getOrder(db, id) {
  const order = decorate(db.prepare(`${TOTALS_SQL} WHERE o.id = ?`).get(id));
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
  order.payments = db.prepare(`SELECT p.*, u.display_name AS received_by_name FROM payments p
    LEFT JOIN users u ON u.id = p.received_by WHERE p.order_id = ? ORDER BY p.paid_at`).all(id);
  return order;
}

function listOrders(db, { q = '', status = '', urgency = '', customerId = null, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (customerId) { where.push('o.customer_id = ?'); params.push(customerId); }
  if (status === 'open') where.push("o.status IN ('pending','in_progress','ready')");
  else if (STATUSES.includes(status)) { where.push('o.status = ?'); params.push(status); }
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(o.order_no LIKE ? ESCAPE '\\' OR o.customer_name LIKE ? ESCAPE '\\' OR o.description LIKE ? ESCAPE '\\' OR o.customer_phone LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  const sql = `${TOTALS_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.deadline_at ASC LIMIT ?`;
  params.push(limit);
  const now = Date.now();
  let rows = db.prepare(sql).all(...params).map((o) => decorate(o, now));
  if (urgency && LEVELS[urgency]) rows = rows.filter((o) => o.urgency === urgency);
  return rows;
}

/** Orders still being worked on that are overdue or urgent, most pressing first. */
function alertOrders(db, now = Date.now()) {
  return db.prepare(`${TOTALS_SQL} WHERE o.status IN ('pending','in_progress') ORDER BY o.deadline_at ASC`)
    .all()
    .map((o) => decorate(o, now))
    .filter((o) => o.urgency === 'overdue' || o.urgency === 'urgent');
}

class PaymentError extends Error {}

function addPayment(db, orderId, { amount_cents, method, reference }, userId) {
  return db.transaction(() => {
    const order = getOrder(db, orderId);
    if (!order) throw new PaymentError('Order not found.');
    if (order.status === 'cancelled') throw new PaymentError('Cannot take payment for a cancelled order.');
    if (amount_cents > order.balance_cents) throw new PaymentError('Payment is more than the remaining balance.');
    const info = db.prepare('INSERT INTO payments (order_id, amount_cents, method, reference, received_by) VALUES (?,?,?,?,?)')
      .run(orderId, amount_cents, method, reference, userId);
    return Number(info.lastInsertRowid);
  })();
}

module.exports = {
  STATUSES, STATUS_LABELS, PRIORITIES, METHODS, METHOD_LABELS,
  createOrder, updateOrder, setStatus, getOrder, listOrders, alertOrders, addPayment, PaymentError, nextOrderNo,
};
