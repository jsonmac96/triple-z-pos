'use strict';
const express = require('express');
const { body, param, query, validationResult, matchedData } = require('express-validator');
const svc = require('../services/customers');
const { listOrders } = require('../services/orders');
const { audit } = require('../db');

const idParam = param('id').isInt({ min: 1, max: 2147483647 }).toInt();
const validators = [
  body('name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Name is required (max 100 characters).'),
  body('phone').optional({ values: 'falsy' }).isString().trim().matches(/^[0-9+()\-\s/,]{3,60}$/).withMessage('Phone may only contain digits, spaces, +, -, ( ), / and commas.'),
  body('email').optional({ values: 'falsy' }).isString().trim().isLength({ max: 254 }).isEmail().withMessage('Email address is not valid.'),
  body('address').optional().isString().trim().isLength({ max: 300 }).withMessage('Address is too long (max 300).'),
  body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes are too long (max 1000).'),
];

function dataFrom(req) {
  const d = matchedData(req, { locations: ['body'] });
  return { name: d.name, phone: d.phone || '', email: d.email || '', address: d.address || '', notes: d.notes || '' };
}

function formFromBody(b) {
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return { name: s(b.name, 100), phone: s(b.phone, 60), email: s(b.email, 254), address: s(b.address, 300), notes: s(b.notes, 1000) };
}

module.exports = function customerRoutes(db) {
  const router = express.Router();

  function load(req, res, next) {
    const c = validationResult(req).isEmpty() ? svc.getCustomer(db, req.params.id) : null;
    if (!c) return res.status(404).render('error', { title: 'Not found', message: 'Customer not found.' });
    req.customer = c;
    return next();
  }

  router.get('/', query('q').optional().isString().trim().isLength({ max: 100 }), (req, res) => {
    const q = validationResult(req).isEmpty() ? req.query.q || '' : '';
    res.render('customers/list', { title: 'Customers', customers: svc.listCustomers(db, { q }), q });
  });

  router.get('/new', (req, res) => {
    res.render('customers/form', { title: 'New customer', errors: [], action: '/customers', form: {}, customer: null });
  });

  router.post('/', validators, (req, res) => {
    const errors = validationResult(req).array().map((e) => e.msg);
    if (errors.length) return res.status(400).render('customers/form', { title: 'New customer', errors, action: '/customers', form: formFromBody(req.body), customer: null });
    const id = svc.createCustomer(db, dataFrom(req));
    audit(db, { userId: req.user.id, action: 'customer_created', entity: 'customer', entityId: id, ip: req.ip });
    req.session.flash = 'Customer saved.';
    return res.redirect(`/customers/${id}`);
  });

  router.get('/:id', idParam, load, (req, res) => {
    const orders = listOrders(db, { customerId: req.customer.id, limit: 500 })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    res.render('customers/show', { title: req.customer.name, customer: req.customer, orders });
  });

  router.get('/:id/edit', idParam, load, (req, res) => {
    res.render('customers/form', { title: `Edit ${req.customer.name}`, errors: [], action: `/customers/${req.customer.id}`, form: req.customer, customer: req.customer });
  });

  router.post('/:id', idParam, load, validators, (req, res) => {
    const errors = validationResult(req).array().map((e) => e.msg);
    if (errors.length) {
      return res.status(400).render('customers/form', { title: `Edit ${req.customer.name}`, errors, action: `/customers/${req.customer.id}`, form: formFromBody(req.body), customer: req.customer });
    }
    svc.updateCustomer(db, req.customer.id, dataFrom(req));
    audit(db, { userId: req.user.id, action: 'customer_updated', entity: 'customer', entityId: req.customer.id, ip: req.ip });
    req.session.flash = 'Customer updated.';
    return res.redirect(`/customers/${req.customer.id}`);
  });

  return router;
};
