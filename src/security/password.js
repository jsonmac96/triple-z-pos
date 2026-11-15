'use strict';
const argon2 = require('argon2');

const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const TEMP_PASSWORD = 'TripleZ1!';

// A valid hash used to keep timing the same when the username does not exist.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = argon2.hash('not-a-real-password-#9f2', HASH_OPTIONS);
  return dummyHashPromise;
}

function hashPassword(plain) {
  return argon2.hash(plain, HASH_OPTIONS);
}

async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash || (await dummyHash()), plain);
  } catch {
    return false;
  }
}

/** Returns a list of problems; empty list means the password is acceptable. */
function checkPolicy(plain, { username = '' } = {}) {
  const problems = [];
  if (typeof plain !== 'string' || plain.length < 10) problems.push('at least 10 characters');
  if (typeof plain === 'string' && plain.length > 128) problems.push('at most 128 characters');
  if (!/[a-z]/.test(plain)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(plain)) problems.push('an uppercase letter');
  if (!/[0-9]/.test(plain)) problems.push('a number');
  if (!/[^A-Za-z0-9]/.test(plain)) problems.push('a symbol');
  if (plain === TEMP_PASSWORD) problems.push('must not be the temporary password');
  if (username && typeof plain === 'string' && plain.toLowerCase().includes(username.toLowerCase())) {
    problems.push('must not contain your username');
  }
  return problems;
}

module.exports = { hashPassword, verifyPassword, checkPolicy, TEMP_PASSWORD };
