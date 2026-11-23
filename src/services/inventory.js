'use strict';

class StockError extends Error {}

/** How much stock an order currently consumes: { productId: qty }. Cancelled orders consume nothing. */
function orderStockEffect(db, orderId) {
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status === 'cancelled') return {};
  const rows = db.prepare(`SELECT i.product_id, SUM(i.qty) AS qty FROM order_items i JOIN products p ON p.id = i.product_id
    WHERE i.order_id = ? AND p.track_stock = 1 GROUP BY i.product_id`).all(orderId);
  return Object.fromEntries(rows.map((r) => [r.product_id, r.qty]));
}

/**
 * Apply the difference between an order's stock effect before and after a change.
 * Must run inside the same transaction as the order change. Returns products now low/out.
 */
function syncOrderStock(db, before, after, orderId, userId) {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const upd = db.prepare("UPDATE products SET stock_qty = stock_qty + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?");
  const mov = db.prepare("INSERT INTO stock_movements (product_id, change, reason, order_id, user_id) VALUES (?,?, 'order', ?, ?)");
  const warnings = [];
  for (const id of ids) {
    const change = (before[id] || 0) - (after[id] || 0); // more used => stock goes down
    if (!change) continue;
    upd.run(change, id);
    mov.run(id, change, orderId, userId);
    const p = db.prepare('SELECT name, stock_qty, reorder_level, unit FROM products WHERE id = ?').get(id);
    if (change < 0 && p.stock_qty <= p.reorder_level) {
      warnings.push(p.stock_qty <= 0 ? `${p.name} is out of stock (${p.stock_qty} ${p.unit}).` : `${p.name} is low (${p.stock_qty} ${p.unit} left).`);
    }
  }
  return warnings;
}

/** Manual stock change from the Inventory tab. mode: stock_in | stock_out | adjust (set to count). */
function moveStock(db, productId, { mode, qty, note }, userId) {
  return db.transaction(() => {
    const p = db.prepare('SELECT id, track_stock, stock_qty FROM products WHERE id = ?').get(productId);
    if (!p) throw new StockError('Item not found.');
    if (!p.track_stock) throw new StockError('Stock is not tracked for this item.');
    let change;
    if (mode === 'stock_in') change = qty;
    else if (mode === 'stock_out') change = -qty;
    else if (mode === 'adjust') change = qty - p.stock_qty;
    else throw new StockError('Unknown stock action.');
    if (change === 0) throw new StockError('Nothing to change: the count is already the same.');
    db.prepare("UPDATE products SET stock_qty = stock_qty + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(change, productId);
    db.prepare('INSERT INTO stock_movements (product_id, change, reason, note, user_id) VALUES (?,?,?,?,?)').run(productId, change, mode, note, userId);
    return change;
  })();
}

function movements(db, productId, limit = 200) {
  return db.prepare(`SELECT m.*, u.display_name AS user_name, o.order_no FROM stock_movements m
    LEFT JOIN users u ON u.id = m.user_id LEFT JOIN orders o ON o.id = m.order_id
    WHERE m.product_id = ? ORDER BY m.id DESC LIMIT ?`).all(productId, limit);
}

function lowStock(db) {
  return db.prepare(`SELECT * FROM products WHERE active = 1 AND track_stock = 1 AND stock_qty <= reorder_level
    ORDER BY (stock_qty <= 0) DESC, stock_qty - reorder_level, name`).all();
}

const REASON_LABELS = { stock_in: 'Stock in', stock_out: 'Stock out', adjust: 'Count adjusted', order: 'Order', opening: 'Opening stock' };

module.exports = { StockError, orderStockEffect, syncOrderStock, moveStock, movements, lowStock, REASON_LABELS };
