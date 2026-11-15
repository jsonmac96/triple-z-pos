'use strict';
// Creates the staff accounts with the temporary password. Existing accounts are left untouched
// unless --reset is passed (which resets the password to the temporary one and unlocks the account).
const path = require('path');
const fs = require('fs');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const { openDb, audit } = require('../src/db');
const { hashPassword, TEMP_PASSWORD } = require('../src/security/password');

const STAFF = [
  { username: 'razel', display_name: 'Razel' },
  { username: 'joshua', display_name: 'Joshua' },
];

async function seed(db, { reset = false } = {}) {
  const results = [];
  for (const u of STAFF) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
    const hash = await hashPassword(TEMP_PASSWORD);
    if (!existing) {
      const info = db.prepare('INSERT INTO users (username, display_name, password_hash, must_change_password) VALUES (?,?,?,1)')
        .run(u.username, u.display_name, hash);
      audit(db, { userId: Number(info.lastInsertRowid), action: 'user_created' });
      results.push(`created ${u.username}`);
    } else if (reset) {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?')
        .run(hash, existing.id);
      db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(existing.id);
      audit(db, { userId: existing.id, action: 'password_reset' });
      results.push(`reset ${u.username}`);
    } else {
      results.push(`kept ${u.username} (already exists)`);
    }
  }
  return results;
}

if (require.main === module) {
  const db = openDb(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'triplez.db'));
  seed(db, { reset: process.argv.includes('--reset') })
    .then((r) => { r.forEach((line) => console.log(line)); console.log('Temporary password must be changed on first login.'); db.close(); })
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seed, STAFF };
