'use strict';
const request = require('supertest');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { seed } = require('../scripts/seed-users');

const NEW_PASSWORD = 'Printing#2026ok';

async function setup(opts = {}) {
  const db = openDb(':memory:');
  await seed(db);
  const app = createApp({ db, sessionSecret: 's'.repeat(48), loginRateLimit: { limit: 1000 }, ...opts });
  return { db, app };
}

function csrfFrom(html) {
  const m = /name="_csrf" value="([a-f0-9]{64})"/.exec(html);
  if (!m) throw new Error('no csrf token in page');
  return m[1];
}

async function login(app, username = 'razel', password = 'TripleZ1!') {
  const agent = request.agent(app);
  const page = await agent.get('/login');
  const res = await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), username, password });
  return { agent, res };
}

/** Log in with the temporary password and complete the forced password change. */
async function loggedIn(app, username = 'razel') {
  const { agent } = await login(app, username);
  const page = await agent.get('/change-password');
  const res = await agent.post('/change-password').type('form').send({
    _csrf: csrfFrom(page.text), current_password: 'TripleZ1!', new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD,
  });
  if (res.status !== 302) throw new Error(`password change failed: ${res.status}`);
  return agent;
}

async function token(agent, path = '/') {
  return csrfFrom((await agent.get(path)).text);
}

function deadlineInput(msFromNow) {
  // datetime-local in Manila time
  const d = new Date(Date.now() + msFromNow + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

async function createOrder(agent, fields = {}) {
  const res = await agent.post('/orders').type('form').send({
    _csrf: await token(agent, '/orders/new'),
    customer_name: 'Juan Dela Cruz', customer_phone: '0917 123 4567', customer_email: '', description: 'Tarpaulin 3x6',
    priority: 'normal', deadline: deadlineInput(5 * 24 * 3600 * 1000), notes: '',
    item: ['Tarpaulin 3x6 ft', 'Layout fee'], qty: ['2', '1'], price: ['350', '150.50'],
    ...fields,
  });
  const id = res.headers.location ? Number(res.headers.location.split('/').pop()) : null;
  return { res, id };
}

module.exports = { setup, login, loggedIn, token, csrfFrom, createOrder, deadlineInput, NEW_PASSWORD };
