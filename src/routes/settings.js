'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const settings = require('../services/settings');
const { audit } = require('../db');

const validators = [
  ...Object.entries(settings.LIMITS).map(([k, max]) => body(k).optional().isString().isLength({ max })
    .withMessage(`${k.replace(/_/g, ' ')} is too long (max ${max} characters).`)),
  body('shop_name').isString().trim().isLength({ min: 1 }).withMessage('Shop name is required.'),
  body('shop_email').optional({ values: 'falsy' }).isString().trim().isEmail().withMessage('Shop email is not valid.'),
  body('receipt_spacing').isIn(Object.keys(settings.SPACING)).withMessage('Choose a line spacing.'),
  body('receipt_text').isIn(Object.keys(settings.TEXT_SIZES)).withMessage('Choose a text size.'),
];

// Tables included in a backup download. Password hashes and sessions are never exported.
const BACKUP_TABLES = {
  users: 'SELECT id, username, display_name, must_change_password, invoice_paper, created_at, last_login_at FROM users',
  customers: 'SELECT * FROM customers',
  orders: 'SELECT * FROM orders',
  order_items: 'SELECT * FROM order_items',
  payments: 'SELECT * FROM payments',
  products: 'SELECT * FROM products',
  stock_movements: 'SELECT * FROM stock_movements',
  settings: 'SELECT * FROM settings',
};

module.exports = function settingsRoutes(db) {
  const router = express.Router();
  const render = (res, status, opts) => res.status(status).render('settings', {
    title: 'Settings', errors: [], SPACING: settings.SPACING, TEXT_SIZES: settings.TEXT_SIZES, LIMITS: settings.LIMITS,
    latestOrder: db.prepare('SELECT id, order_no FROM orders ORDER BY id DESC LIMIT 1').get() || null, ...opts,
  });

  router.get('/', (req, res) => render(res, 200, { form: settings.getSettings(db) }));

  router.post('/', validators, (req, res) => {
    const errors = [...new Set(validationResult(req).array().map((e) => e.msg))];
    const values = {};
    for (const k of Object.keys(settings.DEFAULTS)) {
      if (k === 'receipt_logo') values[k] = req.body.receipt_logo === '1' ? '1' : '0';
      else values[k] = typeof req.body[k] === 'string' ? req.body[k].replace(/\r\n/g, '\n').trim() : '';
    }
    if (errors.length) return render(res, 400, { form: values, errors });
    settings.saveSettings(db, values);
    audit(db, { userId: req.user.id, action: 'settings_updated', ip: req.ip });
    req.session.flash = 'Settings saved. Receipts and invoices now use them.';
    return res.redirect('/settings');
  });

  router.get('/backup.json', (req, res) => {
    const tables = {};
    for (const [name, sql] of Object.entries(BACKUP_TABLES)) tables[name] = db.prepare(sql).all();
    audit(db, { userId: req.user.id, action: 'backup_downloaded', ip: req.ip });
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="triplez-backup-${stamp}.json"`);
    res.set('Cache-Control', 'no-store');
    res.type('application/json').send(JSON.stringify({ app: 'triple-z-pos', format: 2, created_at: new Date().toISOString(), tables }, null, 1));
  });

  return router;
};
