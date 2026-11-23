'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { setup, loggedIn, token, createOrder, deadlineInput } = require('./helpers');
const { classify } = require('../src/services/urgency');
const { csvCell } = require('../src/routes/sales');

const H = 3600 * 1000;

test('urgency classification boundaries', () => {
  const now = Date.now();
  const o = (h, extra = {}) => ({ status: 'pending', priority: 'normal', deadline_at: new Date(now + h * H).toISOString(), ...extra });
  assert.strictEqual(classify(o(-1), now), 'overdue');
  assert.strictEqual(classify(o(5), now), 'urgent');
  assert.strictEqual(classify(o(24), now), 'urgent');
  assert.strictEqual(classify(o(30), now), 'soon');
  assert.strictEqual(classify(o(30, { priority: 'rush' }), now), 'urgent');
  assert.strictEqual(classify(o(72), now), 'soon');
  assert.strictEqual(classify(o(100), now), 'normal');
  assert.strictEqual(classify(o(-5, { status: 'released' }), now), 'none');
  assert.strictEqual(classify(o(-5, { status: 'ready' }), now), 'none');
  assert.strictEqual(classify(o(-5, { status: 'cancelled' }), now), 'none');
});

test('create, view, edit an order and compute totals', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const { res, id } = await createOrder(agent);
  assert.strictEqual(res.status, 302);
  const show = await agent.get(`/orders/${id}`);
  assert.strictEqual(show.status, 200);
  assert.match(show.text, /TZ-\d{4}-0001/);
  assert.match(show.text, /₱850\.50/); // 2 x 350 + 150.50

  const edit = await agent.post(`/orders/${id}`).type('form').send({
    _csrf: await token(agent, `/orders/${id}/edit`), customer_name: 'Juan Dela Cruz', priority: 'rush',
    deadline: deadlineInput(10 * H), item: 'Business cards', qty: '3', price: '1,000',
  });
  assert.strictEqual(edit.status, 302);
  const after = await agent.get(`/orders/${id}`);
  assert.match(after.text, /₱3,000\.00/);
  assert.match(after.text, /Urgent/);
  assert.match(after.text, /Rush/);
});

test('order validation rejects bad input', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const cases = [
    { customer_name: '' },
    { deadline: 'tomorrow' },
    { priority: 'super' },
    { customer_email: 'not-an-email' },
    { item: ['Flyers'], qty: ['-1'], price: ['10'] },
    { item: ['Flyers'], qty: ['1'], price: ['abc'] },
    { item: [''], qty: [''], price: [''] },
  ];
  for (const c of cases) {
    const { res } = await createOrder(agent, c);
    assert.strictEqual(res.status, 400, JSON.stringify(c));
  }
});

test('user content is HTML-escaped (no stored XSS), including on the invoice', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const evil = '<script>alert(1)</script>';
  const { id } = await createOrder(agent, { customer_name: evil, description: `<img src=x onerror=alert(1)>`, item: [evil], qty: ['1'], price: ['5'] });
  for (const p of [`/orders/${id}`, `/orders/${id}/invoice`, '/orders', '/']) {
    const res = await agent.get(p);
    assert.strictEqual(res.status, 200, p);
    assert.ok(!res.text.includes(evil), p);
    assert.ok(!res.text.includes('<img src=x'), p);
  }
});

test('invalid / missing order ids give 404', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  for (const p of ['/orders/999', '/orders/abc', '/orders/1%20OR%201=1', '/orders/999/invoice']) {
    assert.strictEqual((await agent.get(p)).status, 404, p);
  }
});

test('status change, alerts API and dashboard reminders', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const { id: overdueId } = await createOrder(agent, { customer_name: 'Late Customer', deadline: deadlineInput(-2 * H) });
  await createOrder(agent, { customer_name: 'Rush Customer', priority: 'rush', deadline: deadlineInput(30 * H) });
  await createOrder(agent, { customer_name: 'Relaxed Customer', deadline: deadlineInput(200 * H) });

  let alerts = (await agent.get('/api/alerts')).body;
  assert.strictEqual(alerts.count, 2);
  assert.strictEqual(alerts.overdue, 1);
  assert.strictEqual(alerts.orders[0].urgency, 'overdue');

  const dash = await agent.get('/');
  assert.match(dash.text, /2 orders need attention/);
  assert.match(dash.text, /Late Customer/);

  const st = await agent.post(`/orders/${overdueId}/status`).type('form').send({ _csrf: await token(agent), status: 'ready' });
  assert.strictEqual(st.status, 302);
  alerts = (await agent.get('/api/alerts')).body;
  assert.strictEqual(alerts.count, 1);

  const bad = await agent.post(`/orders/${overdueId}/status`).type('form').send({ _csrf: await token(agent), status: 'deleted' });
  assert.strictEqual(bad.status, 400);

  const filtered = await agent.get('/orders?status=open&urgency=urgent');
  assert.match(filtered.text, /Rush Customer/);
  assert.doesNotMatch(filtered.text, /Relaxed Customer/);
});

test('payments are recorded, limited to balance, and show in sales history + CSV', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const { id } = await createOrder(agent); // total 850.50
  const pay = async (amount, method = 'cash') => agent.post(`/orders/${id}/payments`).type('form')
    .send({ _csrf: await token(agent), amount, method, reference: '=HYPERLINK("x")' });

  assert.strictEqual((await pay('500', 'gcash')).status, 302);
  assert.strictEqual((await pay('400')).status, 400, 'over balance');
  assert.strictEqual((await pay('0')).status, 400);
  assert.strictEqual((await pay('-5')).status, 400);
  assert.strictEqual((await pay('10', 'bitcoin')).status, 400);
  assert.strictEqual((await pay('350.50')).status, 302);

  const show = await agent.get(`/orders/${id}`);
  assert.match(show.text, /Fully paid/);

  const sales = await agent.get('/sales?range=today');
  assert.match(sales.text, /₱850\.50/);
  assert.match(sales.text, /GCash/);

  const dash = await agent.get('/');
  assert.match(dash.text, /data-count="85050"/);

  const csv = await agent.get('/sales/export.csv?range=today');
  assert.strictEqual(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /500\.00/);
  assert.match(csv.text, /'=HYPERLINK/, 'formula injection neutralised');

  const inv = await agent.get(`/orders/${id}/invoice`);
  assert.match(inv.text, /PAID/);
  assert.match(inv.text, /print-btn/);
});

test('edit cannot reduce total below amount already paid', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const { id } = await createOrder(agent);
  await agent.post(`/orders/${id}/payments`).type('form').send({ _csrf: await token(agent), amount: '800', method: 'cash' });
  const res = await agent.post(`/orders/${id}`).type('form').send({
    _csrf: await token(agent), customer_name: 'X', priority: 'normal', deadline: deadlineInput(H), item: 'Small', qty: '1', price: '10',
  });
  assert.strictEqual(res.status, 400);
});

test('cancelled orders cannot take payments', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const { id } = await createOrder(agent);
  await agent.post(`/orders/${id}/status`).type('form').send({ _csrf: await token(agent), status: 'cancelled' });
  const res = await agent.post(`/orders/${id}/payments`).type('form').send({ _csrf: await token(agent), amount: '10', method: 'cash' });
  assert.strictEqual(res.status, 400);
});

test('csv cells are escaped', () => {
  assert.strictEqual(csvCell('a,b'), '"a,b"');
  assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csvCell('+1'), "'+1");
  assert.strictEqual(csvCell('@SUM(A1)'), "'@SUM(A1)");
});

test('search with SQL wildcard characters is safe', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  await createOrder(agent, { customer_name: 'Maria' });
  const res = await agent.get(`/orders?status=&q=${encodeURIComponent("%' OR 1=1 --")}`);
  assert.strictEqual(res.status, 200);
  assert.match(res.text, /No orders match/);
  const ok = await agent.get('/orders?status=&q=mar');
  assert.match(ok.text, /Maria/);
});

test('sales date filters: presets and custom dates', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const res = await agent.get('/sales?range=today&from=2026-01-01&to=2026-01-31');
  assert.match(res.text, /value="2026-01-01"/);
  assert.match(res.text, /<option value="custom" selected>/);
  const bad = await agent.get('/sales?range=custom&from=2026-13-45&to=x');
  assert.strictEqual(bad.status, 200);
  assert.match(bad.text, /<option value="week" selected>/);
});

test('invoice paper sizes: default letter, choice remembered, whitelist only', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const { id } = await createOrder(agent);
  let res = await agent.get(`/orders/${id}/invoice`);
  assert.match(res.text, /\/static\/css\/paper\/letter\.css/);
  assert.match(res.text, /class="paper-letter kind-sheet spacing-wide text-normal"/);

  res = await agent.get(`/orders/${id}/invoice?paper=thermal80`);
  assert.match(res.text, /\/static\/css\/paper\/thermal80\.css/);
  assert.match(res.text, /class="invoice receipt"/);
  assert.match(res.text, /2 × ₱350\.00/);

  res = await agent.get(`/orders/${id}/invoice`);
  assert.match(res.text, /paper\/thermal80\.css/, 'choice remembered');

  for (const bad of ['evil', '../x', 'letter.css', '']) {
    res = await agent.get(`/orders/${id}/invoice?paper=${encodeURIComponent(bad)}`);
    assert.strictEqual(res.status, 200, bad);
    assert.match(res.text, /paper\/thermal80\.css/, bad);
  }
  res = await agent.get(`/orders/${id}/invoice?paper=a5`);
  assert.match(res.text, /kind-half/);
});

test('every paper stylesheet exists and sets a page size', async () => {
  const request = require('supertest');
  const { PAPERS } = require('../src/services/paper');
  const { app } = await setup();
  for (const k of Object.keys(PAPERS)) {
    const res = await request(app).get(`/static/css/paper/${k}.css`);
    assert.strictEqual(res.status, 200, k);
    assert.match(res.text, /@page \{ size: /, k);
  }
});

test('database migration is idempotent', () => {
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const { openDb } = require('../src/db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-'));
  const file = path.join(dir, 'm.db');
  openDb(file).close();
  const db = openDb(file);
  assert.ok(db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'invoice_paper'));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
