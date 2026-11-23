'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = 2;
const KEEP_SNAPSHOTS = 5;

/** Where the SQLite file lives: DB_FILE, else the Railway volume, else ./data. */
function defaultDbFile() {
  if (process.env.DB_FILE) return process.env.DB_FILE;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'triplez.db');
  return path.join(__dirname, '..', 'data', 'triplez.db');
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

/**
 * Before upgrading an existing database, copy it to <dir>/backups so nothing can be lost.
 * Keeps the newest KEEP_SNAPSHOTS snapshots. Returns the snapshot path (or null).
 */
function snapshotBeforeUpgrade(db, file, fromVersion) {
  if (file === ':memory:' || !tableExists(db, 'users')) return null;
  const hasData = db.prepare('SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM orders) AS n').get().n > 0;
  if (!hasData) return null;
  const dir = path.join(path.dirname(path.resolve(file)), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `triplez-pre-v${SCHEMA_VERSION}-from-v${fromVersion}-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(target);
  const old = fs.readdirSync(dir).filter((f) => /^triplez-pre-v\d+.*\.db$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_SNAPSHOTS))) fs.rmSync(path.join(dir, f), { force: true });
  console.log(`Database snapshot saved before upgrade: ${target}`);
  return target;
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true });
  if (version < SCHEMA_VERSION) snapshotBeforeUpgrade(db, file, version);
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);
  if (version < SCHEMA_VERSION) db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return db;
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

/**
 * Idempotent, additive-only upgrades for databases created by older versions.
 * Never drops tables or columns and never deletes or rewrites existing rows.
 */
function migrate(db) {
  if (!columns(db, 'users').includes('invoice_paper')) {
    db.exec("ALTER TABLE users ADD COLUMN invoice_paper TEXT NOT NULL DEFAULT 'letter'");
  }
  if (!columns(db, 'orders').includes('customer_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id)');
  }
  if (!columns(db, 'order_items').includes('product_id')) {
    db.exec('ALTER TABLE order_items ADD COLUMN product_id INTEGER REFERENCES products(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id)');
  backfillCustomers(db);
}

const digits = (s) => String(s || '').replace(/\D/g, '');

/** Create customer records for orders that have none yet (repeat clients grouped by phone, else name). */
function backfillCustomers(db) {
  const orphans = db.prepare(`SELECT id, customer_name, customer_phone, customer_email FROM orders
    WHERE customer_id IS NULL ORDER BY id`).all();
  if (!orphans.length) return;
  const { findOrCreateCustomer } = require('./services/customers');
  db.transaction(() => {
    const link = db.prepare('UPDATE orders SET customer_id = ? WHERE id = ? AND customer_id IS NULL');
    for (const o of orphans) {
      const id = findOrCreateCustomer(db, { name: o.customer_name, phone: o.customer_phone, email: o.customer_email });
      link.run(id, o.id);
    }
  })();
}

function audit(db, { userId = null, action, entity = '', entityId = null, details = '', ip = '' }) {
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?)'
  ).run(userId, action, entity, entityId, String(details).slice(0, 500), String(ip || '').slice(0, 64));
}

module.exports = { openDb, audit, defaultDbFile, digits, SCHEMA_VERSION };
