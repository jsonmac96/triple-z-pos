'use strict';
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const catalog = require('../services/catalog');
const inv = require('../services/inventory');
const { audit } = require('../db');
const { productEditor } = require('./catalog');

const idParam = param('id').isInt({ min: 1, max: 2147483647 }).toInt();

module.exports = function inventoryRoutes(db) {
  const router = express.Router();

  router.get('/',
    query('status').optional().isIn(['', 'low', 'out']),
    query('q').optional().isString().trim().isLength({ max: 100 }),
    (req, res) => {
      const ok = validationResult(req).isEmpty();
      const status = ok ? req.query.status || '' : '';
      const q = ok ? req.query.q || '' : '';
      let products = catalog.listProducts(db, { kinds: ['item', 'material'], active: 1, q, stockOnly: true });
      const totals = {
        count: products.length,
        low: products.filter((p) => p.stock_status === 'low').length,
        out: products.filter((p) => p.stock_status === 'out').length,
        value_cents: products.reduce((s, p) => s + Math.max(0, p.stock_qty) * p.cost_cents, 0),
      };
      if (status === 'low') products = products.filter((p) => p.stock_status === 'low' || p.stock_status === 'out');
      if (status === 'out') products = products.filter((p) => p.stock_status === 'out');
      res.render('inventory/list', { title: 'Inventory', products, totals, status, q });
    });

  // Materials (supplies) are added and edited here; sellable items live in Services & Items.
  productEditor(db, router, { base: '/inventory', kinds: ['material'], label: 'Inventory' });

  function load(req, res, next) {
    const p = validationResult(req).isEmpty() ? catalog.getProduct(db, req.params.id) : null;
    if (!p || !p.track_stock) return res.status(404).render('error', { title: 'Not found', message: 'Stock item not found.' });
    req.product = p;
    return next();
  }

  router.get('/:id', idParam, load, (req, res) => {
    res.render('inventory/show', {
      title: req.product.name, product: req.product, movements: inv.movements(db, req.product.id), REASON_LABELS: inv.REASON_LABELS, errors: [],
    });
  });

  router.post('/:id/stock', idParam, load,
    body('mode').isIn(['stock_in', 'stock_out', 'adjust']).withMessage('Choose a stock action.'),
    body('qty').isString().trim().matches(/^\d{1,7}$/).withMessage('Quantity must be a whole number.'),
    body('note').optional().isString().trim().isLength({ max: 200 }).withMessage('Note is too long (max 200).'),
    (req, res) => {
      const errors = validationResult(req).array().map((e) => e.msg);
      const qty = Number(String(req.body.qty || '').trim());
      if (!errors.length && req.body.mode !== 'adjust' && qty < 1) errors.push('Quantity must be at least 1.');
      if (!errors.length) {
        try {
          const change = inv.moveStock(db, req.product.id, { mode: req.body.mode, qty, note: (req.body.note || '').trim() }, req.user.id);
          audit(db, { userId: req.user.id, action: 'stock_changed', entity: 'product', entityId: req.product.id, details: `${req.body.mode} ${change}`, ip: req.ip });
          req.session.flash = `Stock updated (${change > 0 ? '+' : ''}${change} ${req.product.unit}).`;
          return res.redirect(`/inventory/${req.product.id}`);
        } catch (err) {
          if (!(err instanceof inv.StockError)) throw err;
          errors.push(err.message);
        }
      }
      return res.status(400).render('inventory/show', {
        title: req.product.name, product: req.product, movements: inv.movements(db, req.product.id), REASON_LABELS: inv.REASON_LABELS, errors,
      });
    });

  return router;
};
