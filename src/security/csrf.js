'use strict';
const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Synchronizer-token CSRF protection. Token lives in the server-side session. */
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!tokensMatch(sent, req.session.csrfToken)) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Your form expired or was invalid. Please go back, refresh the page and try again.' });
  }
  return next();
}

module.exports = { csrfProtection };
