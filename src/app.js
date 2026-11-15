'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const SqliteStore = require('./security/sqliteStore');
const { csrfProtection } = require('./security/csrf');
const { loadUser, requireLogin, IDLE_MS } = require('./security/auth');
const { loginLimiter, generalLimiter } = require('./security/rateLimit');
const fmt = require('./format');
const orders = require('./services/orders');

function createApp({
  db,
  sessionSecret,
  production = process.env.NODE_ENV === 'production',
  trustProxy = false,
  cookieSecure = production,
  loginRateLimit = {},
} = {}) {
  if (!db) throw new Error('db is required');
  if (!sessionSecret || sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  if (production) app.set('view cache', true);

  // ---- Security headers ----
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(production ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
    crossOriginEmbedderPolicy: true,
  }));
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });

  // ---- Template helpers (set first so every page, including early errors, can render) ----
  app.use((req, res, next) => {
    Object.assign(res.locals, {
      fmt,
      STATUS_LABELS: orders.STATUS_LABELS,
      METHOD_LABELS: orders.METHOD_LABELS,
      currentPath: req.path,
      currentUser: null,
      csrfToken: '',
      flash: null,
    });
    next();
  });

  app.use(generalLimiter());
  // Browser favicon + web app manifest live at the site root.
  const publicDir = path.join(__dirname, '..', 'public');
  app.get('/favicon.ico', (req, res) => res.sendFile(path.join(publicDir, 'favicon.ico'), { maxAge: '7d' }));
  app.get('/site.webmanifest', (req, res) => res.type('application/manifest+json').sendFile(path.join(publicDir, 'site.webmanifest'), { maxAge: '1d' }));
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { index: false, maxAge: production ? '1d' : 0 }));
  app.use(express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 300 }));

  // ---- Sessions ----
  app.use(session({
    name: 'tz.sid',
    secret: sessionSecret,
    store: new SqliteStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: { httpOnly: true, sameSite: 'strict', secure: cookieSecure, maxAge: IDLE_MS },
  }));
  app.use((req, res, next) => {
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    next();
  });
  app.use(loadUser(db));
  app.use(csrfProtection);

  // ---- Routes ----
  app.use(require('./routes/auth')(db, { limiter: loginLimiter(loginRateLimit) }));
  app.use(requireLogin);
  app.use(require('./routes/dashboard')(db));
  app.use('/orders', require('./routes/orders')(db));
  app.use('/sales', require('./routes/sales')(db));
  app.use('/api', require('./routes/api')(db));

  app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status === 413 ? 'The form you sent was too large.'
      : status < 500 ? 'The request was not valid.' : 'Something went wrong. Please try again.';
    res.status(status).render('error', { title: 'Error', message });
  });

  return app;
}

module.exports = { createApp };
