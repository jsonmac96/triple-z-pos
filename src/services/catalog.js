'use strict';

const KINDS = { service: 'Service', item: 'Item', material: 'Material (supply)' };
const UNITS = ['pc', 'set', 'box', 'pack', 'ream', 'sheet', 'roll', 'sq ft', 'meter', 'ml', 'bottle', 'job', 'hour'];

function stockStatus(p) {
  if (!p.track_stock) return 'untracked';
  if (p.stock_qty <= 0) return 'out';
  if (p.stock_qty <= p.reorder_level) return 'low';
  return 'ok';
}
const STOCK_LABELS = { ok: 'In stock', low: 'Low', out: 'Out of stock', untracked: '—' };

function decorate(p) {
  if (!p) return p;
  p.stock_status = stockStatus(p);
  p.stock_label = STOCK_LABELS[p.stock_status];
  p.kind_label = KINDS[p.kind];
  return p;
}

function listProducts(db, { kinds = ['service', 'item'], active = 1, q = '', stockOnly = false } = {}) {
  const where = [`kind IN (${kinds.map(() => '?').join(',')})`];
  const params = [...kinds];
  if (active !== null) { where.push('active = ?'); params.push(active); }
  if (stockOnly) where.push('track_stock = 1');
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where.push("(name LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  return db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY kind, category COLLATE NOCASE, name COLLATE NOCASE`)
    .all(...params).map(decorate);
}

function getProduct(db, id) {
  return decorate(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}

function createProduct(db, data, userId) {
  return db.transaction(() => {
    const track = data.kind === 'material' ? 1 : data.kind === 'service' ? 0 : (data.track_stock ? 1 : 0);
    const info = db.prepare(`INSERT INTO products (kind, name, category, sku, unit, price_cents, cost_cents, track_stock, stock_qty, reorder_level, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      data.kind, data.name, data.category, data.sku, data.unit, data.price_cents, data.cost_cents,
      track, track ? data.stock_qty : 0, track ? data.reorder_level : 0, data.notes
    );
    const id = Number(info.lastInsertRowid);
    if (track && data.stock_qty) {
      db.prepare("INSERT INTO stock_movements (product_id, change, reason, note, user_id) VALUES (?,?, 'opening', 'Opening stock', ?)")
        .run(id, data.stock_qty, userId);
    }
    return id;
  })();
}

/** Update descriptive fields. Stock quantity is only changed through stock movements. */
function updateProduct(db, id, data) {
  const current = db.prepare('SELECT kind FROM products WHERE id = ?').get(id);
  if (!current) return false;
  const track = current.kind === 'material' ? 1 : current.kind === 'service' ? 0 : (data.track_stock ? 1 : 0);
  return db.prepare(`UPDATE products SET name=?, category=?, sku=?, unit=?, price_cents=?, cost_cents=?, track_stock=?, reorder_level=?, notes=?,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(
    data.name, data.category, data.sku, data.unit, data.price_cents, data.cost_cents, track, data.reorder_level, data.notes, id
  ).changes > 0;
}

function setActive(db, id, active) {
  return db.prepare("UPDATE products SET active=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(active ? 1 : 0, id).changes > 0;
}

/** Active services and items for the order form picker. */
function pickerList(db) {
  return db.prepare("SELECT id, kind, name, category, unit, price_cents, track_stock, stock_qty FROM products WHERE active = 1 AND kind IN ('service','item') ORDER BY kind, category COLLATE NOCASE, name COLLATE NOCASE").all();
}

module.exports = { KINDS, UNITS, STOCK_LABELS, stockStatus, listProducts, getProduct, createProduct, updateProduct, setActive, pickerList };
