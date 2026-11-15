'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

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

module.exports = { openDb, audit };
