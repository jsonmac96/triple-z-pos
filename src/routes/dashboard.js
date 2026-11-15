'use strict';
const express = require('express');
const { dashboardStats } = require('../services/sales');
const { alertOrders, listOrders } = require('../services/orders');

module.exports = function dashboardRoutes(db) {
  const router = express.Router();
  router.get('/', (req, res) => {
    const stats = dashboardStats(db);
    const alerts = alertOrders(db);
    const upcoming = listOrders(db, { status: 'open', limit: 50 })
      .filter((o) => o.urgency !== 'none' || o.status === 'ready').slice(0, 10);
    const recent = db.prepare(`SELECT p.*, o.order_no, o.customer_name FROM payments p JOIN orders o ON o.id = p.order_id
      ORDER BY p.paid_at DESC LIMIT 6`).all();
    res.render('dashboard', { title: 'Dashboard', stats, alerts, upcoming, recent });
  });
  return router;
};
