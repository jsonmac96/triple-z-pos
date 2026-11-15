'use strict';
const express = require('express');
const { alertOrders } = require('../services/orders');

module.exports = function apiRoutes(db) {
  const router = express.Router();
  router.get('/alerts', (req, res) => {
    const orders = alertOrders(db).map((o) => ({
      id: o.id,
      order_no: o.order_no,
      customer_name: o.customer_name,
      urgency: o.urgency,
      time_left: o.time_left,
      deadline_at: o.deadline_at,
    }));
    res.set('Cache-Control', 'no-store');
    res.json({ count: orders.length, overdue: orders.filter((o) => o.urgency === 'overdue').length, orders });
  });
  return router;
};
