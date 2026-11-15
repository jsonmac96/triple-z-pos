'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env if present (no dependency needed on Node >= 20.12)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const { openDb } = require('./db');
const { createApp } = require('./app');

const production = process.env.NODE_ENV === 'production';
let secret = process.env.SESSION_SECRET;
if (!secret || secret === 'change-me' || secret.length < 32) {
  if (production) {
    console.error('FATAL: set SESSION_SECRET to a random string of at least 32 characters (see .env.example).');
    process.exit(1);
  }
  secret = crypto.randomBytes(48).toString('hex');
  console.warn('WARNING: SESSION_SECRET not set; using a random one (sessions reset on restart). Do not do this in production.');
}

const db = openDb(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'triplez.db'));
const app = createApp({
  db,
  sessionSecret: secret,
  production,
  trustProxy: process.env.TRUST_PROXY === '1',
  cookieSecure: production && process.env.COOKIE_SECURE !== '0',
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`Triple Z POS running at http://${host}:${port}`));
server.headersTimeout = 20000;
server.requestTimeout = 30000;

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
