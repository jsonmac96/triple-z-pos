'use strict';
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const svc = require('../services/catalog');
const { parsePeso } = require('../format');
const { audit } = require('../db');

const idParam = param('id').isInt({ min: 1, max: 2147483647 }).toInt();
const intField = (name, label) => body(name).optional({ values: 'falsy' }).isString().trim()
  .matches(/^\d{1,7}$/).withMessage(`${label} must be a whole number (0 to 9,999,999).`);

const productValidators = [
  body('name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Name is required (max 120 characters).'),
  body('category').optional().isString().trim().isLength({ max: 60 }).withMessage('Category is too long (max 60).'),
  body('sku').optional().isString().trim().isLength({ max: 40 }).withMessage('Code/SKU is too long (max 40).'),
  body('unit').isString().trim().isLength({ min: 1, max: 20 }).withMessage('Unit is required (e.g. pc, ream, sq ft).'),
  body('price').optional({ values: 'falsy' }).isString().custom((v) => parsePeso(v) !== null).withMessage('Price must be an amount like 150 or 1,250.50.'),
  body('cost').optional({ values: 'falsy' }).isString().custom((v) => parsePeso(v) !== null).withMessage('Cost must be an amount like 150 or 1,250.50.'),
  intField('stock_qty', 'Starting stock'),
  intField('reorder_level', 'Reorder level'),
  body('notes').optional().isString().trim().isLength({ max: 500 }).withMessage('Notes are too long (max 500).'),
];

function dataFrom(b, kind) {
  const t = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    kind,
    name: t(b.name), category: t(b.category), sku: t(b.sku), unit: t(b.unit) || 'pc',
    price_cents: parsePeso(t(b.price) || '0') || 0, cost_cents: parsePeso(t(b.cost) || '0') || 0,
    track_stock: b.track_stock === '1',
    stock_qty: Number(t(b.stock_qty) || 0), reorder_level: Number(t(b.reorder_level) || 0), notes: t(b.notes),
  };
}

function formFromBody(b) {
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return {
    kind: s(b.kind, 10), name: s(b.name, 120), category: s(b.category, 60), sku: s(b.sku, 40), unit: s(b.unit, 20),
    price: s(b.price, 15), cost: s(b.cost, 15), track_stock: b.track_stock === '1', stock_qty: s(b.stock_qty, 7),
    reorder_level: s(b.reorder_level, 7), notes: s(b.notes, 500),
  };
}

const money = (c) => (c ? (c / 100).toFixed(2) : '');
function formFromProduct(p) {
  return { kind: p.kind, name: p.name, category: p.category, sku: p.sku, unit: p.unit, price: money(p.price_cents), cost: money(p.cost_cents),
    track_stock: Boolean(p.track_stock), stock_qty: String(p.stock_qty), reorder_level: String(p.reorder_level), notes: p.notes };
}

/**
 * Shared add/edit routes for Services & Items (/catalog) and Inventory materials (/inventory).
 * `kinds` limits which product types this router may create or edit.
 */
function productEditor(db, router, { base, kinds, label }) {
  const render = (res, status, opts) => res.status(status).render('catalog/form', {
    errors: [], product: null, KINDS: svc.KINDS, UNITS: svc.UNITS, base, kinds, sectionLabel: label, ...opts,
  });

  function load(req, res, next) {
    const p = validationResult(req).isEmpty() ? svc.getProduct(db, req.params.id) : null;
    if (!p || !kinds.includes(p.kind)) return res.status(404).render('error', { title: 'Not found', message: 'Item not found.' });
    req.product = p;
    return next();
  }

  router.get('/new', query('kind').optional().isIn(kinds), (req, res) => {
    const kind = validationResult(req).isEmpty() && req.query.kind ? req.query.kind : kinds[0];
    render(res, 200, { title: `Add ${svc.KINDS[kind].toLowerCase()}`, action: base, form: { kind, unit: 'pc', track_stock: kind !== 'service' } });
  });

  router.post('/', body('kind').isIn(kinds).withMessage('Choose a type.'), productValidators, (req, res) => {
    const errors = validationResult(req).array().map((e) => e.msg);
    if (errors.length) return render(res, 400, { title: `Add to ${label}`, errors, action: base, form: formFromBody(req.body) });
    const id = svc.createProduct(db, dataFrom(req.body, req.body.kind), req.user.id);
    audit(db, { userId: req.user.id, action: 'product_created', entity: 'product', entityId: id, details: req.body.kind, ip: req.ip });
    req.session.flash = `${req.body.name.trim()} added.`;
    return res.redirect(base);
  });

  router.get('/:id/edit', idParam, load, (req, res) => {
    render(res, 200, { title: `Edit ${req.product.name}`, action: `${base}/${req.product.id}`, form: formFromProduct(req.product), product: req.product });
  });

  router.post('/:id', idParam, load, productValidators, (req, res) => {
    const errors = validationResult(req).array().map((e) => e.msg);
    if (errors.length) {
      return render(res, 400, { title: `Edit ${req.product.name}`, errors, action: `${base}/${req.product.id}`, form: { ...formFromBody(req.body), kind: req.product.kind }, product: req.product });
    }
    svc.updateProduct(db, req.product.id, dataFrom(req.body, req.product.kind));
    audit(db, { userId: req.user.id, action: 'product_updated', entity: 'product', entityId: req.product.id, ip: req.ip });
    req.session.flash = 'Saved.';
    return res.redirect(base);
  });

  router.post('/:id/active', idParam, load, body('active').isIn(['0', '1']), (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).render('error', { title: 'Invalid', message: 'Invalid request.' });
    svc.setActive(db, req.product.id, req.body.active === '1');
    audit(db, { userId: req.user.id, action: req.body.active === '1' ? 'product_activated' : 'product_deactivated', entity: 'product', entityId: req.product.id, ip: req.ip });
    req.session.flash = req.body.active === '1' ? `${req.product.name} is available again.` : `${req.product.name} was deactivated (kept for history).`;
    return res.redirect(base);
  });
}

module.exports = function catalogRoutes(db) {
  const router = express.Router();
  router.get('/',
    query('show').optional().isIn(['', 'service', 'item', 'inactive']),
    query('q').optional().isString().trim().isLength({ max: 100 }),
    (req, res) => {
      const ok = validationResult(req).isEmpty();
      const show = ok ? req.query.show || '' : '';
      const q = ok ? req.query.q || '' : '';
      const kinds = show === 'service' ? ['service'] : show === 'item' ? ['item'] : ['service', 'item'];
      const products = svc.listProducts(db, { kinds, active: show === 'inactive' ? 0 : 1, q });
      res.render('catalog/list', { title: 'Services & Items', products, show, q });
    });
  productEditor(db, router, { base: '/catalog', kinds: ['service', 'item'], label: 'Services & Items' });
  return router;
};

module.exports.productEditor = productEditor;
