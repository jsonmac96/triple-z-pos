'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDb } = require('../src/db');

/** Build a database exactly like the previous released version, with real-looking data. */
function makeV1Db(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(path.join(__dirname, 'fixtures', 'schema-v1.sql'), 'utf8'));
  db.exec("ALTER TABLE users ADD COLUMN invoice_paper TEXT NOT NULL DEFAULT 'letter'");
  db.prepare("INSERT INTO users (username, display_name, password_hash, must_change_password, invoice_paper) VALUES ('razel','Razel','$argon2id$hash-razel',0,'thermal80')").run();
  db.prepare("INSERT INTO users (username, display_name, password_hash, must_change_password) VALUES ('joshua','Joshua','$argon2id$hash-joshua',0)").run();
  const order = db.prepare(`INSERT INTO orders (order_no, customer_name, customer_phone, customer_email, description, status, priority, deadline_at, created_by)
    VALUES (?,?,?,?,?,?,?,?,1)`);
  order.run('TZ-2026-0001', 'St. Jude Parish', '0917 555 1234', '', 'Tarps', 'released', 'normal', '2026-11-20T02:00:00.000Z');
  order.run('TZ-2026-0002', 'st. jude parish', '09175551234', '', 'Flyers', 'pending', 'rush', '2026-11-25T02:00:00.000Z');
  order.run('TZ-2026-0003', 'Mark Santos', '', '', 'Cards', 'ready', 'normal', '2026-11-24T02:00:00.000Z');
  order.run('TZ-2026-0004', 'Mark Santos', '', '', 'Cards again', 'pending', 'normal', '2026-11-26T02:00:00.000Z');
  const item = db.prepare('INSERT INTO order_items (order_id, item, qty, unit_price_cents) VALUES (?,?,?,?)');
  item.run(1, 'Tarpaulin', 2, 35000); item.run(2, 'Flyers', 3, 45000); item.run(3, 'Cards', 1, 30000); item.run(4, 'Cards', 1, 30000);
  db.prepare("INSERT INTO payments (order_id, amount_cents, method, reference, received_by) VALUES (1, 70000, 'gcash', 'GC-1', 1)").run();
  db.prepare("INSERT INTO audit_log (user_id, action) VALUES (1, 'login')").run();
  db.pragma('user_version = 0');
  db.close();
}

const dump = (db) => ({
  users: db.prepare('SELECT id, username, display_name, password_hash, must_change_password, invoice_paper FROM users ORDER BY id').all(),
  orders: db.prepare('SELECT id, order_no, customer_name, customer_phone, customer_email, description, status, priority, deadline_at, notes, created_by, created_at, updated_at FROM orders ORDER BY id').all(),
  items: db.prepare('SELECT id, order_id, item, qty, unit_price_cents FROM order_items ORDER BY id').all(),
  payments: db.prepare('SELECT * FROM payments ORDER BY id').all(),
  audit: db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
});

test('upgrading a previous-version database keeps every row, password and payment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-up-'));
  const file = path.join(dir, 'triplez.db');
  makeV1Db(file);
  const raw = new Database(file);
  const before = dump(raw);
  raw.close();

  const db = openDb(file);
  const after = dump(db);
  assert.deepStrictEqual(after.users, before.users, 'users and password hashes unchanged');
  assert.deepStrictEqual(after.orders, before.orders, 'orders unchanged');
  assert.deepStrictEqual(after.items, before.items, 'order items unchanged');
  assert.deepStrictEqual(after.payments, before.payments, 'payments unchanged');
  assert.deepStrictEqual(after.audit, before.audit, 'audit log unchanged');

  // New structures exist and repeat customers were grouped.
  for (const t of ['settings', 'customers', 'products', 'stock_movements']) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t), t);
  }
  const customers = db.prepare('SELECT * FROM customers ORDER BY id').all();
  assert.strictEqual(customers.length, 2, 'St. Jude (same phone) and Mark Santos (same name, no phone)');
  const links = db.prepare('SELECT customer_id FROM orders ORDER BY id').all().map((r) => r.customer_id);
  assert.deepStrictEqual(links, [customers[0].id, customers[0].id, customers[1].id, customers[1].id]);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 2);

  // A snapshot of the old database was written next to it.
  const snaps = fs.readdirSync(path.join(dir, 'backups'));
  assert.strictEqual(snaps.length, 1);
  const snap = new Database(path.join(dir, 'backups', snaps[0]), { readonly: true });
  assert.deepStrictEqual(dump(snap).orders, before.orders, 'snapshot holds the original data');
  snap.close();
  db.close();

  // Opening again is a no-op: no new snapshot, no duplicate customers, data identical.
  const again = openDb(file);
  assert.deepStrictEqual(dump(again).orders, before.orders);
  assert.strictEqual(again.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 2);
  assert.strictEqual(fs.readdirSync(path.join(dir, 'backups')).length, 1);
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('seed script keeps existing users and their passwords after upgrade', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-up-'));
  const file = path.join(dir, 'triplez.db');
  makeV1Db(file);
  const db = openDb(file);
  const { seed } = require('../scripts/seed-users');
  const r = await seed(db);
  assert.deepStrictEqual(r, ['kept razel (already exists)', 'kept joshua (already exists)']);
  assert.strictEqual(db.prepare("SELECT password_hash FROM users WHERE username='razel'").get().password_hash, '$argon2id$hash-razel');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
