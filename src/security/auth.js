'use strict';

const IDLE_MS = 30 * 60 * 1000;      // log out after 30 minutes of inactivity
const ABSOLUTE_MS = 8 * 60 * 60 * 1000; // force re-login after 8 hours

function loadUser(db) {
  const stmt = db.prepare('SELECT id, username, display_name, must_change_password, invoice_paper FROM users WHERE id = ?');
  return (req, res, next) => {
    const s = req.session;
    if (s && s.userId) {
      const now = Date.now();
      if (now - (s.lastSeen || 0) > IDLE_MS || now - (s.loginAt || 0) > ABSOLUTE_MS) {
        return s.regenerate(() => {
          req.session.flash = 'Your session expired. Please log in again.';
          res.locals.currentUser = null;
          next();
        });
      }
      const user = stmt.get(s.userId);
      if (!user) return s.regenerate(() => next());
      // Background alert polling must not keep an idle session alive.
      if (req.path !== '/api/alerts') s.lastSeen = now;
      req.user = user;
      res.locals.currentUser = user;
    } else {
      res.locals.currentUser = null;
    }
    return next();
  };
}

function requireLogin(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthenticated' });
    return res.redirect('/login');
  }
  if (req.user.must_change_password && !['/change-password', '/logout'].includes(req.path)) {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'password_change_required' });
    return res.redirect('/change-password');
  }
  res.set('Cache-Control', 'no-store');
  return next();
}

module.exports = { loadUser, requireLogin, IDLE_MS, ABSOLUTE_MS };
