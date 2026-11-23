'use strict';
const express = require('express');
const { query, validationResult } = require('express-validator');
const { collections, BUCKETS } = require('../services/collections');
const { METHODS, STATUS_LABELS } = require('../services/orders');

module.exports = function collectionRoutes(db) {
  const router = express.Router();
  router.get('/',
    query('q').optional().isString().trim().isLength({ max: 100 }),
    query('bucket').optional().isIn(['', ...BUCKETS.map((b) => b.key)]),
    (req, res) => {
      const ok = validationResult(req).isEmpty();
      const filters = ok ? { q: req.query.q || '', bucket: req.query.bucket || '' } : { q: '', bucket: '' };
      const { rows, summary } = collections(db, filters);
      res.render('collections', { title: 'Collections', rows, summary, filters, BUCKETS, METHODS, STATUS_LABELS });
    });
  return router;
};
