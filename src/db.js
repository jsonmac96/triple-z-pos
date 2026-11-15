'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/** Where the SQLite file lives: DB_FILE, else the Railway volume, else ./data. */
function defaultDbFile() {
  if (process.env.DB_FILE) return process.env.DB_FILE;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'triplez.db');
  return path.join(__dirname, '..', 'data', 'triplez.db');
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}

function audit(db, { userId = null, action, entity = '', entityId = null, details = '', ip = '' }) {
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?)'
  ).run(userId, action, entity, entityId, String(details).slice(0, 500), String(ip || '').slice(0, 64));
}

module.exports = { openDb, audit, defaultDbFile };
