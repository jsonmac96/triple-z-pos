'use strict';
const { rateLimit } = require('express-rate-limit');

function loginLimiter({ limit = 10, windowMs = 15 * 60 * 1000 } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true, // only failed logins count
    handler: (req, res) => res.status(429).render('login', {
      title: 'Log in', error: 'Too many login attempts from this device. Please wait 15 minutes and try again.', username: '',
    }),
  });
}

function generalLimiter({ limit = 600, windowMs = 5 * 60 * 1000 } = {}) {
  return rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false });
}

module.exports = { loginLimiter, generalLimiter };
