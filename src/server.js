'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env if present (no dependency needed on Node >= 20.12)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

// Tidy values typed into hosting dashboards: stray spaces or surrounding quotes break things.
for (const key of ['NODE_ENV', 'SESSION_SECRET', 'TRUST_PROXY', 'COOKIE_SECURE', 'HOST', 'PORT', 'DB_FILE']) {
  if (typeof process.env[key] === 'string') {
    process.env[key] = process.env[key].trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  }
}

const { openDb, defaultDbFile } = require('./db');
const { createApp } = require('./app');

const production = process.env.NODE_ENV === 'production';
let secret = process.env.SESSION_SECRET || '';
if (!secret || secret === 'change-me' || secret.length < 32) {
  if (production) {
    // Explain what is wrong without ever printing the secret itself.
    let why;
    if (!('SESSION_SECRET' in process.env)) {
      const similar = Object.keys(process.env).filter((k) => k.toUpperCase().replace(/[^A-Z]/g, '').includes('SESSIONSECRET'));
      why = similar.length
        ? `SESSION_SECRET is not set, but a similarly named variable exists: ${similar.map((k) => JSON.stringify(k)).join(', ')}. Rename it to exactly SESSION_SECRET.`
        : 'SESSION_SECRET is not set for this service. On Railway, add it in this service\'s Variables tab (not only as a shared/project variable) and click Deploy.';
    } else if (!secret) why = 'SESSION_SECRET is set but empty.';
    else if (secret === 'change-me') why = 'SESSION_SECRET is still the placeholder "change-me".';
    else why = `SESSION_SECRET is only ${secret.length} characters long.`;
    console.error(`FATAL: ${why} It must be a random string of at least 32 characters.`);
    process.exit(1);
  }
  secret = crypto.randomBytes(48).toString('hex');
  console.warn('WARNING: SESSION_SECRET not set; using a random one (sessions reset on restart). Do not do this in production.');
}

const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME
  || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
if (onRailway && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DB_FILE) {
  console.warn('WARNING: no Railway volume attached. Orders and sales WILL BE LOST on the next deploy. Add a volume to this service.');
}
const dbFile = defaultDbFile();
console.log(`Database: ${dbFile}`);
const db = openDb(dbFile);
const app = createApp({
  db,
  sessionSecret: secret,
  production,
  trustProxy: process.env.TRUST_PROXY === '1',
  cookieSecure: production && process.env.COOKIE_SECURE !== '0',
  ephemeralStorage: onRailway && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DB_FILE,
});

let port = Number(process.env.PORT);
if (process.env.PORT && !(Number.isInteger(port) && port > 0 && port < 65536)) {
  console.warn(`WARNING: PORT "${process.env.PORT}" is not a valid port number; using ${onRailway ? 8080 : 3000}.`);
  port = 0;
}
port = port || (onRailway ? 8080 : 3000);
// On Railway listen on all interfaces ("::" accepts both IPv6 and IPv4); locally only on this machine.
const host = process.env.HOST || (onRailway ? '::' : '127.0.0.1');
console.log(`Starting web server on host "${host}" port ${port}...`);
const server = app.listen(port, host);
server.on('listening', () => {
  const a = server.address();
  console.log(`Triple Z POS running on ${a.address} port ${a.port}`);
});
let fellBack = false;
server.on('error', (err) => {
  // If the configured host can't be used (typo, no IPv6, ...), fall back to all IPv4 interfaces.
  if (!fellBack && host !== '0.0.0.0' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EAI_AGAIN', 'EINVAL'].includes(err.code)) {
    fellBack = true;
    console.warn(`WARNING: cannot listen on host "${host}" (${err.code}); listening on 0.0.0.0 instead.`);
    server.listen(port, '0.0.0.0');
    return;
  }
  console.error(`FATAL: web server could not start on port ${port}: ${err.code || ''} ${err.message}`);
  process.exit(1);
});
server.headersTimeout = 20000;
server.requestTimeout = 30000;

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
