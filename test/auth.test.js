'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { setup, login, loggedIn, csrfFrom, NEW_PASSWORD } = require('./helpers');

test('both staff accounts can log in with the temporary password and must change it', async () => {
  const { app } = await setup();
  for (const u of ['razel', 'joshua']) {
    const { agent, res } = await login(app, u);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/change-password');
    const dash = await agent.get('/');
    assert.strictEqual(dash.headers.location, '/change-password', 'blocked until password is changed');
    const api = await agent.get('/api/alerts');
    assert.strictEqual(api.status, 403);
  }
});

test('session cookie is httpOnly + SameSite=Strict and rotated on login', async () => {
  const { app } = await setup();
  const agent = request.agent(app);
  const page = await agent.get('/login');
  const before = page.headers['set-cookie'][0].split(';')[0];
  assert.match(page.headers['set-cookie'][0], /HttpOnly/i);
  assert.match(page.headers['set-cookie'][0], /SameSite=Strict/i);
  const res = await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), username: 'razel', password: 'TripleZ1!' });
  const after = res.headers['set-cookie'][0].split(';')[0];
  assert.notStrictEqual(before, after);
});

test('secure cookie flag is set in production mode', async () => {
  const { app } = await setup({ production: true, cookieSecure: true, trustProxy: true });
  const res = await request(app).get('/login').set('X-Forwarded-Proto', 'https');
  assert.match(res.headers['set-cookie'][0], /Secure/);
});

test('wrong password and unknown user give the same generic error', async () => {
  const { app } = await setup();
  const a = await login(app, 'razel', 'wrong');
  const b = await login(app, 'nobody', 'wrong');
  assert.strictEqual(a.res.status, 401);
  assert.strictEqual(b.res.status, 401);
  assert.match(a.res.text, /Invalid username or password/);
  assert.match(b.res.text, /Invalid username or password/);
});

test('account locks after 5 failed attempts, even with the right password', async () => {
  const { app } = await setup();
  for (let i = 0; i < 5; i += 1) await login(app, 'joshua', 'bad-password');
  const { res } = await login(app, 'joshua', 'TripleZ1!');
  assert.strictEqual(res.status, 401);
  assert.match(res.text, /locked/);
});

test('login is rate limited per IP', async () => {
  const { app } = await setup({ loginRateLimit: { limit: 3 } });
  const statuses = [];
  for (let i = 0; i < 4; i += 1) statuses.push((await login(app, 'nobody', 'x')).res.status);
  assert.deepStrictEqual(statuses, [401, 401, 401, 429]);
});

test('POST without CSRF token is rejected', async () => {
  const { app } = await setup();
  const agent = request.agent(app);
  await agent.get('/login');
  const res = await agent.post('/login').type('form').send({ username: 'razel', password: 'TripleZ1!' });
  assert.strictEqual(res.status, 403);
  const forged = await agent.post('/login').type('form').send({ _csrf: 'a'.repeat(64), username: 'razel', password: 'TripleZ1!' });
  assert.strictEqual(forged.status, 403);
});

test('password policy is enforced and temp password cannot be reused', async () => {
  const { app } = await setup();
  const { agent } = await login(app);
  const tok = csrfFrom((await agent.get('/change-password')).text);
  for (const pw of ['short1!A', 'alllowercase1!', 'TripleZ1!', 'NoSymbols1234']) {
    const res = await agent.post('/change-password').type('form').send({ _csrf: tok, current_password: 'TripleZ1!', new_password: pw, confirm_password: pw });
    assert.strictEqual(res.status, 400, pw);
  }
  const wrongCurrent = await agent.post('/change-password').type('form').send({ _csrf: tok, current_password: 'nope', new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD });
  assert.strictEqual(wrongCurrent.status, 401);
});

test('after changing password the old one stops working and the new one works', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  assert.strictEqual((await agent.get('/')).status, 200);
  assert.strictEqual((await login(app, 'razel', 'TripleZ1!')).res.status, 401);
  const { res } = await login(app, 'razel', NEW_PASSWORD);
  assert.strictEqual(res.headers.location, '/');
});

test('logout destroys the session', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const tok = csrfFrom((await agent.get('/')).text);
  await agent.post('/logout').type('form').send({ _csrf: tok });
  const res = await agent.get('/');
  assert.strictEqual(res.headers.location, '/login');
});

test('unauthenticated users are redirected / get 401', async () => {
  const { app } = await setup();
  for (const p of ['/', '/orders', '/orders/new', '/orders/1', '/orders/1/invoice', '/sales', '/sales/export.csv']) {
    const res = await request(app).get(p);
    assert.strictEqual(res.status, 302, p);
    assert.strictEqual(res.headers.location, '/login');
  }
  assert.strictEqual((await request(app).get('/api/alerts')).status, 401);
});

test('security headers are present', async () => {
  const { app } = await setup();
  const res = await request(app).get('/login');
  const h = res.headers;
  assert.match(h['content-security-policy'], /default-src 'self'/);
  assert.match(h['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(h['content-security-policy'], /object-src 'none'/);
  assert.doesNotMatch(h['content-security-policy'], /unsafe-inline/);
  assert.strictEqual(h['x-frame-options'], 'DENY');
  assert.strictEqual(h['x-content-type-options'], 'nosniff');
  assert.strictEqual(h['referrer-policy'], 'no-referrer');
  assert.match(h['strict-transport-security'], /max-age=31536000/);
  assert.ok(h['permissions-policy']);
  assert.strictEqual(h['x-powered-by'], undefined);
});

test('app refuses to start with a weak session secret', () => {
  const { openDb } = require('../src/db');
  const { createApp } = require('../src/app');
  assert.throws(() => createApp({ db: openDb(':memory:'), sessionSecret: 'short' }));
});

test('logo, favicon and manifest are served without login', async () => {
  const { app } = await setup();
  const ico = await request(app).get('/favicon.ico');
  assert.strictEqual(ico.status, 200);
  for (const p of ['/static/img/logo.svg', '/static/img/logo-mark.svg', '/static/img/favicon.svg', '/static/img/apple-touch-icon.png', '/site.webmanifest']) {
    assert.strictEqual((await request(app).get(p)).status, 200, p);
  }
  const login = await request(app).get('/login');
  assert.match(login.text, /rel="icon"/);
  assert.match(login.text, /logo\.svg/);
});

test('storage warning banner shows only when data is not stored permanently', async () => {
  const plain = await setup();
  assert.doesNotMatch((await request(plain.app).get('/login')).text, /storage-warning/);
  const eph = await setup({ ephemeralStorage: true });
  const res = await request(eph.app).get('/login');
  assert.match(res.text, /class="storage-warning"/);
  assert.match(res.text, /NOT being saved permanently/);
});
