'use strict';

const digits = (s) => String(s || '').replace(/\D/g, '');

/** Find a customer by phone (digits) or, when no phone, by name; create one if none matches. */
function findOrCreateCustomer(db, { name, phone = '', email = '' }) {
  const cleanName = String(name || '').trim();
  const d = digits(phone);
  let row = null;
  if (d.length >= 7) {
    row = db.prepare("SELECT id FROM customers WHERE replace(replace(replace(replace(replace(replace(phone,' ',''),'-',''),'+',''),'(',''),')',''),'.','') = ? ORDER BY id LIMIT 1").get(d);
  }
  if (!row && !d) {
    row = db.prepare("SELECT id FROM customers WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1").get(cleanName);
  }
  if (row) return row.id;
  const info = db.prepare('INSERT INTO customers (name, phone, email) VALUES (?,?,?)').run(cleanName, String(phone || '').trim(), String(email || '').trim());
  return Number(info.lastInsertRowid);
}

const STATS_SQL = `
  SELECT c.*,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
    (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at,
    COALESCE((SELECT SUM(p.amount_cents) FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.customer_id = c.id), 0) AS paid_cents,
    COALESCE((SELECT SUM(i.qty * i.unit_price_cents) FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.customer_id = c.id AND o.status != 'cancelled'), 0) AS billed_cents
  FROM customers c`;

function decorate(c) {
  if (!c) return c;
  // Balance only counts non-cancelled orders; payments on cancelled orders are not "owed back".
  c.balance_cents = Math.max(0, c.billed_cents - c.paid_cents);
  return c;
}

function listCustomers(db, { q = '', limit = 300 } = {}) {
  const params = [];
  let where = '';
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where = "WHERE c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\'";
    params.push(like, like, like);
  }
  params.push(limit);
  return db.prepare(`${STATS_SQL} ${where} ORDER BY (last_order_at IS NULL), last_order_at DESC, c.name LIMIT ?`).all(...params).map(decorate);
}

function getCustomer(db, id) {
  return decorate(db.prepare(`${STATS_SQL} WHERE c.id = ?`).get(id));
}

function createCustomer(db, data) {
  const info = db.prepare('INSERT INTO customers (name, phone, email, address, notes) VALUES (?,?,?,?,?)')
    .run(data.name, data.phone, data.email, data.address, data.notes);
  return Number(info.lastInsertRowid);
}

function updateCustomer(db, id, data) {
  return db.prepare(`UPDATE customers SET name=?, phone=?, email=?, address=?, notes=?,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .run(data.name, data.phone, data.email, data.address, data.notes, id).changes > 0;
}

/** Light list for the order form's customer picker. */
function pickerList(db) {
  return db.prepare('SELECT id, name, phone, email FROM customers ORDER BY name COLLATE NOCASE LIMIT 2000').all();
}

module.exports = { findOrCreateCustomer, listCustomers, getCustomer, createCustomer, updateCustomer, pickerList, digits };
