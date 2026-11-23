'use strict';
const express = require('express');
const { body, param, query, validationResult, matchedData } = require('express-validator');
const svc = require('../services/orders');
const { parseLocalInput, toLocalInput, parsePeso } = require('../format');
const { audit } = require('../db');
const { LEVELS } = require('../services/urgency');
const { PAPERS, KIND_LABELS, isPaper, getPaper } = require('../services/paper');
const customersSvc = require('../services/customers');
const catalog = require('../services/catalog');
const { getSettings } = require('../services/settings');

const MAX_ITEMS = 50;
const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const orderValidators = [
  body('customer_name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Customer name is required (max 100 characters).'),
  body('customer_phone').optional({ values: 'falsy' }).isString().trim().matches(/^[0-9+()\-\s]{3,30}$/).withMessage('Phone may only contain digits, spaces, +, -, ( ).'),
  body('customer_email').optional({ values: 'falsy' }).isString().trim().isLength({ max: 254 }).isEmail().withMessage('Email address is not valid.'),
  body('description').optional().isString().trim().isLength({ max: 1000 }).withMessage('Description is too long.'),
  body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes are too long.'),
  body('priority').isIn(svc.PRIORITIES).withMessage('Choose a priority.'),
  body('deadline').isString().custom((v) => parseLocalInput(v) !== null).withMessage('Enter a valid deadline date and time.'),
];

/** Validate the repeated item/qty/price/product_id fields. `products` maps id -> active service/item. */
function parseItems(reqBody, products = new Map()) {
  const names = asArray(reqBody.item);
  const qtys = asArray(reqBody.qty);
  const prices = asArray(reqBody.price);
  const productIds = asArray(reqBody.product_id);
  const errors = [];
  const items = [];
  const rawRows = [];
  if (names.length > MAX_ITEMS) return { items, errors: [`At most ${MAX_ITEMS} items per order.`], rawRows };
  for (let i = 0; i < names.length; i += 1) {
    const name = typeof names[i] === 'string' ? names[i].trim() : '';
    const qtyStr = typeof qtys[i] === 'string' ? qtys[i].trim() : '';
    const priceStr = typeof prices[i] === 'string' ? prices[i].trim() : '';
    const pidStr = typeof productIds[i] === 'string' ? productIds[i].trim() : '';
    rawRows.push({ item: name.slice(0, 120), qty: qtyStr.slice(0, 10), price: priceStr.slice(0, 15), product_id: /^\d{1,9}$/.test(pidStr) ? pidStr : '' });
    if (!name && !qtyStr && !priceStr) continue; // blank row
    let productId = null;
    if (pidStr) {
      if (/^\d{1,9}$/.test(pidStr) && products.has(Number(pidStr))) productId = Number(pidStr);
      else errors.push(`Item ${i + 1}: the selected service/item is no longer available.`);
    }
    const qty = /^\d{1,6}$/.test(qtyStr) ? Number(qtyStr) : NaN;
    const cents = parsePeso(priceStr);
    if (!name || name.length > 120) errors.push(`Item ${i + 1}: name is required (max 120 characters).`);
    if (!(qty >= 1 && qty <= 100000)) errors.push(`Item ${i + 1}: quantity must be a whole number from 1 to 100000.`);
    if (cents === null) errors.push(`Item ${i + 1}: price must be an amount like 150 or 1,250.50.`);
    if (name && qty >= 1 && cents !== null) items.push({ item: name, qty, unit_price_cents: cents, product_id: productId });
  }
  if (!errors.length && !items.length) errors.push('Add at least one item.');
  return { items, errors, rawRows };
}

function formFromBody(b, rawRows) {
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return {
    customer_name: str(b.customer_name, 100), customer_phone: str(b.customer_phone, 30), customer_email: str(b.customer_email, 254),
    description: str(b.description, 1000), notes: str(b.notes, 1000), priority: svc.PRIORITIES.includes(b.priority) ? b.priority : 'normal',
    deadline: str(b.deadline, 16), rows: rawRows, customer_id: /^\d{1,9}$/.test(b.customer_id || '') ? b.customer_id : '',
  };
}

function formFromOrder(o) {
  return {
    customer_name: o.customer_name, customer_phone: o.customer_phone, customer_email: o.customer_email,
    description: o.description, notes: o.notes, priority: o.priority, deadline: toLocalInput(o.deadline_at),
    rows: o.items.map((it) => ({ item: it.item, qty: String(it.qty), price: (it.unit_price_cents / 100).toFixed(2), product_id: it.product_id ? String(it.product_id) : '' })),
    customer_id: o.customer_id ? String(o.customer_id) : '',
  };
}

function collect(req, db) {
  const errors = validationResult(req).array().map((e) => e.msg);
  const products = new Map(catalog.pickerList(db).map((p) => [p.id, p]));
  const { items, errors: itemErrors, rawRows } = parseItems(req.body, products);
  errors.push(...itemErrors);
  const d = matchedData(req, { locations: ['body'] });
  const data = {
    customer_name: d.customer_name, customer_phone: d.customer_phone || '', customer_email: d.customer_email || '',
    description: d.description || '', notes: d.notes || '', priority: d.priority,
    deadline_at: parseLocalInput(req.body.deadline), items,
    customer_id: /^\d{1,9}$/.test(req.body.customer_id || '') ? Number(req.body.customer_id) : null,
  };
  return { errors: [...new Set(errors)], data, rawRows };
}

const idParam = param('id').isInt({ min: 1, max: 2147483647 }).toInt();

module.exports = function orderRoutes(db) {
  const router = express.Router();

  function loadOrder(req, res, next) {
    if (!validationResult(req).isEmpty()) return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
    const order = svc.getOrder(db, req.params.id);
    if (!order) return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
    req.order = order;
    return next();
  }

  router.get('/',
    query('q').optional().isString().trim().isLength({ max: 100 }),
    query('status').optional().isIn(['', 'open', ...svc.STATUSES]),
    query('urgency').optional().isIn(['', ...Object.keys(LEVELS)]),
    (req, res) => {
      const ok = validationResult(req).isEmpty();
      const filters = ok ? { q: req.query.q || '', status: req.query.status ?? 'open', urgency: req.query.urgency || '' }
        : { q: '', status: 'open', urgency: '' };
      const list = svc.listOrders(db, filters);
      res.render('orders/list', { title: 'Orders', orders: list, filters, STATUSES: svc.STATUSES, LEVELS });
    });

  /** Render the order form with the customer and service/item pickers. */
  function renderForm(res, status, opts) {
    res.status(status).render('orders/form', {
      errors: [], order: null, ...opts,
      pickerCustomers: customersSvc.pickerList(db),
      pickerProducts: catalog.pickerList(db),
    });
  }

  const flashWarnings = (req, warnings) => {
    if (warnings && warnings.length) req.session.flashError = `Stock alert: ${warnings.join(' ')}`;
  };

  router.get('/new', query('customer').optional().isInt({ min: 1, max: 2147483647 }).toInt(), (req, res) => {
    const form = { priority: 'normal', deadline: '', rows: [{ item: '', qty: '1', price: '', product_id: '' }] };
    const c = validationResult(req).isEmpty() && req.query.customer ? customersSvc.getCustomer(db, req.query.customer) : null;
    if (c) Object.assign(form, { customer_id: String(c.id), customer_name: c.name, customer_phone: c.phone, customer_email: c.email });
    renderForm(res, 200, { title: 'New order', action: '/orders', form });
  });

  router.post('/', orderValidators, (req, res) => {
    const { errors, data, rawRows } = collect(req, db);
    if (errors.length) {
      return renderForm(res, 400, { title: 'New order', errors, action: '/orders', form: formFromBody(req.body, rawRows) });
    }
    const { id, warnings } = svc.createOrder(db, data, req.user.id);
    audit(db, { userId: req.user.id, action: 'order_created', entity: 'order', entityId: id, ip: req.ip });
    req.session.flash = 'Order created.';
    flashWarnings(req, warnings);
    return res.redirect(`/orders/${id}`);
  });

  router.get('/:id', idParam, loadOrder, (req, res) => {
    res.render('orders/show', { title: req.order.order_no, order: req.order, STATUSES: svc.STATUSES, METHODS: svc.METHODS, errors: [] });
  });

  router.get('/:id/edit', idParam, loadOrder, (req, res) => {
    renderForm(res, 200, { title: `Edit ${req.order.order_no}`, action: `/orders/${req.order.id}`, form: formFromOrder(req.order), order: req.order });
  });

  router.post('/:id', idParam, loadOrder, orderValidators, (req, res) => {
    const { errors, data, rawRows } = collect(req, db);
    const newTotal = data.items.reduce((s, it) => s + it.qty * it.unit_price_cents, 0);
    if (!errors.length && newTotal < req.order.paid_cents) errors.push('The new total is less than what the customer has already paid.');
    if (errors.length) {
      return renderForm(res, 400, {
        title: `Edit ${req.order.order_no}`, errors, action: `/orders/${req.order.id}`, form: formFromBody(req.body, rawRows), order: req.order,
      });
    }
    const { warnings } = svc.updateOrder(db, req.order.id, data, req.user.id);
    audit(db, { userId: req.user.id, action: 'order_updated', entity: 'order', entityId: req.order.id, ip: req.ip });
    req.session.flash = 'Order updated.';
    flashWarnings(req, warnings);
    return res.redirect(`/orders/${req.order.id}`);
  });

  router.post('/:id/status', idParam, loadOrder, body('status').isIn(svc.STATUSES), (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).render('error', { title: 'Invalid', message: 'Unknown status.' });
    const { warnings } = svc.setStatus(db, req.order.id, req.body.status, req.user.id);
    audit(db, { userId: req.user.id, action: 'order_status', entity: 'order', entityId: req.order.id, details: `${req.order.status} -> ${req.body.status}`, ip: req.ip });
    req.session.flash = `Status changed to ${svc.STATUS_LABELS[req.body.status]}.`;
    flashWarnings(req, warnings);
    return res.redirect(`/orders/${req.order.id}`);
  });

  // Pages a payment form may send the user back to (whitelist, never a free URL).
  const RETURN_TO = { collections: '/collections' };

  router.post('/:id/payments', idParam, loadOrder,
    body('amount').isString().custom((v) => { const c = parsePeso(v); return c !== null && c > 0; }).withMessage('Enter a payment amount greater than zero.'),
    body('method').isIn(svc.METHODS).withMessage('Choose a payment method.'),
    body('reference').optional().isString().trim().isLength({ max: 100 }).withMessage('Reference is too long.'),
    body('return_to').optional().isIn(Object.keys(RETURN_TO)),
    (req, res) => {
      const errors = validationResult(req).array().map((e) => e.msg).filter(Boolean);
      const back = RETURN_TO[req.body.return_to];
      const renderErr = (errs) => {
        if (back) {
          req.session.flashError = `${req.order.order_no}: ${errs.join(' ')}`;
          return res.redirect(back);
        }
        return res.status(400).render('orders/show', {
          title: req.order.order_no, order: req.order, STATUSES: svc.STATUSES, METHODS: svc.METHODS, errors: errs,
        });
      };
      if (errors.length) return renderErr(errors);
      const amount = parsePeso(req.body.amount);
      try {
        const pid = svc.addPayment(db, req.order.id, { amount_cents: amount, method: req.body.method, reference: (req.body.reference || '').trim() }, req.user.id);
        audit(db, { userId: req.user.id, action: 'payment_recorded', entity: 'payment', entityId: pid, details: `order ${req.order.order_no} amount ${amount}`, ip: req.ip });
      } catch (err) {
        if (err instanceof svc.PaymentError) return renderErr([err.message]);
        throw err;
      }
      req.session.flash = back ? `Payment recorded for ${req.order.order_no}.` : 'Payment recorded.';
      return res.redirect(back || `/orders/${req.order.id}`);
    });

  router.get('/:id/invoice', idParam, loadOrder, (req, res) => {
    // Paper choice comes only from the whitelist; it is remembered per user.
    let key = req.user.invoice_paper;
    const asked = req.query.paper;
    if (isPaper(asked)) {
      key = asked;
      if (asked !== req.user.invoice_paper) db.prepare('UPDATE users SET invoice_paper = ? WHERE id = ?').run(asked, req.user.id);
    }
    res.render('invoice', {
      title: `Invoice ${req.order.order_no}`, order: req.order, printedAt: new Date().toISOString(),
      paper: getPaper(key), PAPERS, KIND_LABELS, shop: getSettings(db),
    });
  });

  return router;
};
