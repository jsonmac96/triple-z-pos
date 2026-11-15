'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const { verifyPassword, hashPassword, checkPolicy } = require('../security/password');
const { audit } = require('../db');

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

module.exports = function authRoutes(db, { limiter }) {
  const router = express.Router();
  const findUser = db.prepare('SELECT * FROM users WHERE username = ?');

  function startSession(req, user, cb) {
    // New session id (prevents session fixation) and a fresh CSRF token.
    req.session.regenerate((err) => {
      if (err) return cb(err);
      req.session.userId = user.id;
      req.session.loginAt = Date.now();
      req.session.lastSeen = Date.now();
      return req.session.save(cb);
    });
  }

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    return res.render('login', { title: 'Log in', error: null, username: '' });
  });

  router.post('/login', limiter,
    body('username').isString().trim().isLength({ min: 1, max: 50 }),
    body('password').isString().isLength({ min: 1, max: 200 }),
    async (req, res, next) => {
      try {
        const fail = (msg = 'Invalid username or password.') => res.status(401).render('login', {
          title: 'Log in', error: msg, username: typeof req.body.username === 'string' ? req.body.username.slice(0, 50) : '',
        });
        if (!validationResult(req).isEmpty()) return fail();
        const { username, password } = req.body;
        const user = findUser.get(username);
        const ok = await verifyPassword(user && user.password_hash, password);
        if (!user) {
          audit(db, { action: 'login_failed', details: `unknown user ${username}`, ip: req.ip });
          return fail();
        }
        if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
          audit(db, { userId: user.id, action: 'login_locked', ip: req.ip });
          const mins = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
          return fail(`Too many failed attempts. This account is locked for ${mins} more minute(s).`);
        }
        if (!ok) {
          const attempts = user.failed_attempts + 1;
          if (attempts >= MAX_FAILED) {
            db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?')
              .run(new Date(Date.now() + LOCK_MS).toISOString(), user.id);
            audit(db, { userId: user.id, action: 'account_locked', ip: req.ip });
          } else {
            db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id);
          }
          audit(db, { userId: user.id, action: 'login_failed', ip: req.ip });
          return fail();
        }
        db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(user.id);
        audit(db, { userId: user.id, action: 'login', ip: req.ip });
        return startSession(req, user, (err) => {
          if (err) return next(err);
          return res.redirect(user.must_change_password ? '/change-password' : '/');
        });
      } catch (err) { return next(err); }
    });

  router.post('/logout', (req, res, next) => {
    if (req.user) audit(db, { userId: req.user.id, action: 'logout', ip: req.ip });
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('tz.sid', { httpOnly: true, sameSite: 'strict' });
      return res.redirect('/login');
    });
  });

  const requireUser = (req, res, next) => (req.user ? next() : res.redirect('/login'));

  router.get('/change-password', requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.render('change-password', { title: 'Change password', errors: [] });
  });

  router.post('/change-password', requireUser, limiter,
    body('current_password').isString().isLength({ min: 1, max: 200 }),
    body('new_password').isString().isLength({ max: 200 }),
    body('confirm_password').isString().isLength({ max: 200 }),
    async (req, res, next) => {
      try {
        const render = (errors, status = 400) => res.status(status).render('change-password', { title: 'Change password', errors });
        if (!validationResult(req).isEmpty()) return render(['Please fill in every field.']);
        const { current_password: current, new_password: next1, confirm_password: confirm } = req.body;
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
        if (!(await verifyPassword(user.password_hash, current))) {
          audit(db, { userId: user.id, action: 'password_change_failed', ip: req.ip });
          return render(['Your current password is incorrect.'], 401);
        }
        const errors = [];
        if (next1 !== confirm) errors.push('The new passwords do not match.');
        const problems = checkPolicy(next1, { username: user.username });
        if (problems.length) errors.push(`New password needs: ${problems.join(', ')}.`);
        if (next1 === current) errors.push('The new password must be different from the current one.');
        if (errors.length) return render(errors);

        const hash = await hashPassword(next1);
        db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);
        // Sign out every other session of this user, then rotate this session.
        db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(user.id);
        audit(db, { userId: user.id, action: 'password_changed', ip: req.ip });
        return startSession(req, user, (err) => {
          if (err) return next(err);
          req.session.flash = 'Password changed.';
          return req.session.save(() => res.redirect('/'));
        });
      } catch (err) { return next(err); }
    });

  return router;
};
