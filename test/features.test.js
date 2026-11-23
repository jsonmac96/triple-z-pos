'use strict';
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { setup, loggedIn, token, createOrder, deadlineInput } = require('./helpers');

const H = 3600 * 1000;
const post = async (agent, path, fields, from = '/') => agent.post(path).type('form').send({ _csrf: await token(agent, from), ...fields });
const idFrom = (res) => Number(res.headers.location.split('/').pop());

// ---------------------------------------------------------------- Settings & receipt style
test('settings: shop details are the only bold text on receipts and invoices', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  let res = await post(agent, '/settings', {
    shop_name: 'Triple Z Printing', shop_tagline: 'Printing services', shop_address: '123 Rizal St.\nQuezon City',
    shop_phone: '0917 000 1111', shop_email: 'shop@example.com', shop_other: 'FB: TripleZ', shop_tin: '123-456',
    receipt_spacing: 'xwide', receipt_text: 'large', receipt_logo: '1', receipt_footer: 'Salamat po!',
  }, '/settings');
  assert.strictEqual(res.status, 302);
  const { id } = await createOrder(agent);
  for (const paper of ['letter', 'thermal80']) {
    res = await agent.get(`/orders/${id}/invoice?paper=${paper}`);
    assert.match(res.text, /class="shop-info"/);
    assert.match(res.text, /123 Rizal St\.\nQuezon City/);
    assert.match(res.text, /Tel: 0917 000 1111/);
    assert.match(res.text, /TIN: 123-456/);
    assert.match(res.text, /Salamat po!/);
    assert.match(res.text, /spacing-xwide text-large/);
    const article = res.text.slice(res.text.indexOf('<article'), res.text.indexOf('</article>'));
    assert.doesNotMatch(article, /<strong|<b>/, `${paper}: no bold tags in the printed invoice`);
  }
});

test('settings: validation and escaping', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  const base = { shop_name: 'X', receipt_spacing: 'wide', receipt_text: 'normal' };
  assert.strictEqual((await post(agent, '/settings', { ...base, shop_name: '' }, '/settings')).status, 400);
  assert.strictEqual((await post(agent, '/settings', { ...base, receipt_spacing: 'huge' }, '/settings')).status, 400);
  assert.strictEqual((await post(agent, '/settings', { ...base, shop_email: 'nope' }, '/settings')).status, 400);
  assert.strictEqual((await post(agent, '/settings', { ...base, shop_tagline: 'x'.repeat(500) }, '/settings')).status, 400);
  await post(agent, '/settings', { ...base, shop_name: '<script>alert(1)</script>' }, '/settings');
  const { id } = await createOrder(agent);
  const inv = await agent.get(`/orders/${id}/invoice`);
  assert.ok(!inv.text.includes('<script>alert(1)</script>'));
});

test('settings: backup download has business data but no password hashes', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  await createOrder(agent);
  const res = await agent.get('/settings/backup.json');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-disposition'], /attachment/);
  const data = JSON.parse(res.text);
  assert.strictEqual(data.tables.orders.length, 1);
  assert.strictEqual(data.tables.customers.length, 1);
  assert.ok(!res.text.includes('password_hash'));
  assert.ok(!res.text.includes('$argon2'));
});

// ---------------------------------------------------------------- Customers
test('customers: orders auto-create customers and repeat clients are matched by phone', async () => {
  const { app, db } = await setup();
  const agent = await loggedIn(app);
  await createOrder(agent, { customer_name: 'Ana Reyes', customer_phone: '0917 111 2222' });
  await createOrder(agent, { customer_name: 'ana reyes', customer_phone: '09171112222' });
  await createOrder(agent, { customer_name: 'Ben Cruz', customer_phone: '' });
  await createOrder(agent, { customer_name: 'Ben Cruz', customer_phone: '' });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 2);
  const list = await agent.get('/customers');
  assert.match(list.text, /Ana Reyes/);
  assert.match(list.text, /Repeat/);
  const search = await agent.get('/customers?q=ben');
  assert.match(search.text, /Ben Cruz/);
  assert.doesNotMatch(search.text, /Ana Reyes/);
});

test('customers: create, edit, view history, start an order for them', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  let res = await post(agent, '/customers', { name: 'Parish Office', phone: '0918 222 3333', email: 'parish@example.com', address: 'Brgy. 1', notes: 'VIP' }, '/customers/new');
  assert.strictEqual(res.status, 302);
  const cid = idFrom(res);
  assert.strictEqual((await post(agent, '/customers', { name: '' }, '/customers/new')).status, 400);
  assert.strictEqual((await post(agent, '/customers', { name: 'X', email: 'bad' }, '/customers/new')).status, 400);
  res = await post(agent, `/customers/${cid}`, { name: 'St. Jude Parish Office', phone: '0918 222 3333', address: 'Brgy. 2' }, `/customers/${cid}/edit`);
  assert.strictEqual(res.status, 302);

  const form = await agent.get(`/orders/new?customer=${cid}`);
  assert.match(form.text, new RegExp(`name="customer_id" id="customer-id" value="${cid}"`));
  assert.match(form.text, /value="St\. Jude Parish Office"/);
  const { id: oid } = await createOrder(agent, { customer_id: String(cid), customer_name: 'St. Jude Parish Office', customer_phone: '0918 222 3333' });
  const show = await agent.get(`/customers/${cid}`);
  assert.match(show.text, /TZ-\d{4}-0001/);
  assert.match(show.text, /₱850\.50/);
  const inv = await agent.get(`/orders/${oid}/invoice?paper=letter`);
  assert.match(inv.text, /Brgy\. 2/, 'customer address on invoice');
  assert.strictEqual((await agent.get('/customers/999')).status, 404);
});

test('customer names are safely embedded in the order form data block', async () => {
  const { app } = await setup();
  const agent = await loggedIn(app);
  await post(agent, '/customers', { name: '</script><script>alert(1)</script>' }, '/customers/new');
  const form = await agent.get('/orders/new');
  const block = form.text.slice(form.text.indexOf('id="picker-customers"'), form.text.indexOf('id="picker-products"'));
  assert.ok(!block.includes('</script><script>'), 'no script break-out');
  assert.match(block, /\\u003c\/script\\u003e/);
});

// ---------------------------------------------------------------- Services & Items + Inventory
async function addProduct(agent, fields) {
  const res = await post(agent, fields.kind === 'material' ? '/inventory' : '/catalog', { unit: 'pc', ...fields }, '/catalog/new');
  assert.strictEqual(res.status, 302, JSON.stringify(fields));
  return res;
}

test('catalog: add services and items, deactivate keeps them out of the order picker', async () => {
  const { app, db } = await setup();
  const agent = await loggedIn(app);
  await addProduct(agent, { kind: 'service', name: 'Tarpaulin printing', unit: 'sq ft', price: '15', category: 'Large format' });
  await addProduct(agent, { kind: 'item', name: 'Sublimation mug', price: '180', cost: '95', track_stock: '1', stock_qty: '20', reorder_level: '5' });
  assert.strictEqual((await post(agent, '/catalog', { kind: 'material', name: 'x', unit: 'pc' }, '/catalog/new')).status, 400, 'materials only via inventory');
  assert.strictEqual((await post(agent, '/catalog', { kind: 'service', name: '', unit: 'pc' }, '/catalog/new')).status, 400);
  assert.strictEqual((await post(agent, '/catalog', { kind: 'item', name: 'A', unit: 'pc', price: 'abc' }, '/catalog/new')).status, 400);

  let list = await agent.get('/catalog');
  assert.match(list.text, /Tarpaulin printing/);
  assert.match(list.text, /Sublimation mug/);
  let form = await agent.get('/orders/new');
  assert.match(form.text, /Sublimation mug \(₱180\.00\/pc\)/);

  const mug = db.prepare("SELECT id FROM products WHERE name = 'Sublimation mug'").get().id;
  await post(agent, `/catalog/${mug}/active`, { active: '0' }, '/catalog');
  form = await agent.get('/orders/new');
  assert.match(form.text, /Sublimation mug was deactivated/, 'confirmation shown');
  assert.doesNotMatch(form.text, /Sublimation mug \(₱/, 'not offered in the picker');
  list = await agent.get('/catalog?show=inactive');
  assert.match(list.text, /Sublimation mug/);
  const { res } = await createOrder(agent, { item: ['Mug'], qty: ['1'], price: ['180'], product_id: [String(mug)] });
  assert.strictEqual(res.status, 400, 'inactive product rejected');
});

test('inventory: ordering a stock item deducts stock; edit, cancel and un-cancel stay in sync', async () => {
  const { app, db } = await setup();
  const agent = await loggedIn(app);
  await addProduct(agent, { kind: 'item', name: 'Mug', price: '180', track_stock: '1', stock_qty: '10', reorder_level: '3' });
  await addProduct(agent, { kind: 'service', name: 'Layout', price: '150' });
  const mug = db.prepare("SELECT id FROM products WHERE name = 'Mug'").get().id;
  const layout = db.prepare("SELECT id FROM products WHERE name = 'Layout'").get().id;
  const stock = () => db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(mug).stock_qty;

  const { res, id } = await createOrder(agent, { item: ['Mug', 'Layout'], qty: ['4', '1'], price: ['180', '150'], product_id: [String(mug), String(layout)] });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(stock(), 6);

  const edit = await post(agent, `/orders/${id}`, {
    customer_name: 'Juan', priority: 'normal', deadline: deadlineInput(48 * H),
    item: ['Mug'], qty: ['8'], price: ['180'], product_id: [String(mug)],
  }, `/orders/${id}/edit`);
  assert.strictEqual(edit.status, 302);
  assert.strictEqual(stock(), 2, 'edit applies the difference');
  const show = await agent.get(`/orders/${id}`);
  assert.match(show.text, /Stock alert: Mug is low \(2 pc left\)/);

  await post(agent, `/orders/${id}/status`, { status: 'cancelled' });
  assert.strictEqual(stock(), 10, 'cancel returns stock');
  await post(agent, `/orders/${id}/status`, { status: 'pending' });
  assert.strictEqual(stock(), 2, 'un-cancel takes it again');
  await post(agent, `/orders/${id}/status`, { status: 'released' });
  assert.strictEqual(stock(), 2, 'other status changes do not move stock');

  const page = await agent.get(`/inventory/${mug}`);
  assert.match(page.text, /Opening stock/);
  assert.match(page.text, /TZ-\d{4}-0001/);
});

test('inventory: materials, stock in / out / count, low-stock on dashboard', async () => {
  const { app, db } = await setup();
  const agent = await loggedIn(app);
  await addProduct(agent, { kind: 'material', name: 'Bond paper long (ream)', unit: 'ream', cost: '250', stock_qty: '4', reorder_level: '5' });
  const id = db.prepare("SELECT id FROM products WHERE kind = 'material'").get().id;
  const qty = () => db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id).stock_qty;
  let dash = await agent.get('/');
  assert.match(dash.text, /Low stock/);
  assert.match(dash.text, /Bond paper long \(ream\)/);

  assert.strictEqual((await post(agent, `/inventory/${id}/stock`, { mode: 'stock_in', qty: '10', note: 'Delivery' }, `/inventory/${id}`)).status, 302);
  assert.strictEqual(qty(), 14);
  await post(agent, `/inventory/${id}/stock`, { mode: 'stock_out', qty: '3', note: 'Used' }, `/inventory/${id}`);
  assert.strictEqual(qty(), 11);
  await post(agent, `/inventory/${id}/stock`, { mode: 'adjust', qty: '9', note: 'Count' }, `/inventory/${id}`);
  assert.strictEqual(qty(), 9);
  assert.strictEqual((await post(agent, `/inventory/${id}/stock`, { mode: 'adjust', qty: '9' }, `/inventory/${id}`)).status, 400, 'no-op adjust');
  assert.strictEqual((await post(agent, `/inventory/${id}/stock`, { mode: 'stock_in', qty: '-2' }, `/inventory/${id}`)).status, 400);
  assert.strictEqual((await post(agent, `/inventory/${id}/stock`, { mode: 'steal', qty: '2' }, `/inventory/${id}`)).status, 400);

  dash = await agent.get('/');
  assert.doesNotMatch(dash.text, /reorder soon/);
  const inv = await agent.get('/inventory');
  assert.match(inv.text, /₱2,250\.00/, 'stock value 9 x 250');
  const form = await agent.get('/orders/new');
  assert.doesNotMatch(form.text, /Bond paper long/, 'materials are not sold on orders');
  const { res } = await createOrder(agent, { item: ['Paper'], qty: ['1'], price: ['1'], product_id: [String(id)] });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ?').get(id).n, 4);
});

// ---------------------------------------------------------------- Collections
test('collections: lists unpaid orders with totals and buckets; quick payment returns here', async () => {
  const { app, db } = await setup();
  const agent = await loggedIn(app);
  const { id: a } = await createOrder(agent, { customer_name: 'Unpaid Ana' }); // 850.50
  const { id: b } = await createOrder(agent, { customer_name: 'Paid Ben' });
  const { id: c } = await createOrder(agent, { customer_name: 'Cancelled Cara' });
  await post(agent, `/orders/${b}/payments`, { amount: '850.50', method: 'cash' });
  await post(agent, `/orders/${c}/status`, { status: 'cancelled' });
  db.prepare("UPDATE orders SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days') WHERE id = ?").run(a);

  let res = await agent.get('/collections');
  assert.match(res.text, /Unpaid Ana/);
  assert.doesNotMatch(res.text, /Paid Ben/);
  assert.doesNotMatch(res.text, /Cancelled Cara/);
  assert.match(res.text, /₱850\.50/);
  assert.match(res.text, /40 days/);
  res = await agent.get('/collections?bucket=0-7');
  assert.doesNotMatch(res.text, /<strong>TZ-/);
  res = await agent.get('/collections?bucket=31-60');
  assert.match(res.text, /Unpaid Ana/);
  assert.strictEqual((await agent.get('/collections?bucket=evil')).status, 200);

  const pay = await post(agent, `/orders/${a}/payments`, { amount: '500', method: 'gcash', return_to: 'collections' }, '/collections');
  assert.strictEqual(pay.headers.location, '/collections');
  const over = await post(agent, `/orders/${a}/payments`, { amount: '999', method: 'cash', return_to: 'collections' }, '/collections');
  assert.strictEqual(over.headers.location, '/collections');
  res = await agent.get('/collections');
  assert.match(res.text, /more than the remaining balance/);
  assert.match(res.text, /₱350\.50/);
  const evil = await post(agent, `/orders/${a}/payments`, { amount: '1', method: 'cash', return_to: 'https://evil.example' }, '/collections');
  assert.strictEqual(evil.status, 400, 'return_to is whitelisted');

  const dash = await agent.get('/');
  assert.match(dash.text, /Unpaid balance/);
  assert.match(dash.text, /data-count="35050"/);
});

test('new pages require login', async () => {
  const { app } = await setup();
  for (const p of ['/collections', '/customers', '/customers/new', '/catalog', '/catalog/new', '/inventory', '/inventory/new', '/settings', '/settings/backup.json']) {
    const res = await request(app).get(p);
    assert.strictEqual(res.status, 302, p);
    assert.strictEqual(res.headers.location, '/login', p);
  }
});
