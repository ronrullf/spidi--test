const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createServer } = require('./server');
const skylink = require('../lib/skylink');

test('store uses server prices, deduplicates attempts and never invents a link', async t => {
  let calls = 0, rejected = false, sent;
  const server = createServer({
    request: async (endpoint, method, body) => {
      calls++; sent = body;
      return rejected ? { ok: false, status: 401, data: { success: false, message: 'Firma inválida' } }
        : { ok: true, status: 201, data: { success: true, data: { token: 'real-token', url: 'https://dev-axis-payment.valinkgroup.com/pay/real-token' } } };
    },
    paymentFromResponse: skylink.paymentFromResponse
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = data => fetch(`${base}/api/payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const catalog = await (await fetch(`${base}/api/products`)).json();
  assert.deepEqual(catalog.products.map(p => p.amount), [2200, 3000, 4500, 6000]);
  const input = { productId: 'galletas', amount: 1, attemptId: crypto.randomUUID() };
  const results = await Promise.all([post(input), post(input)]);
  assert.equal(calls, 1); assert.equal(sent.amount, 2200);
  assert.equal(sent.currency, 'VES');
  for (const res of results) { assert.equal(res.status, 201); assert.match((await res.json()).url, /pay\/real-token$/); }
  assert.equal((await post({ ...input, productId: 'combo' })).status, 409);
  assert.equal((await post({ productId: 'invented', attemptId: crypto.randomUUID() })).status, 400);
  assert.equal(calls, 1);
  rejected = true;
  const res = await post({ productId: 'combo', attemptId: crypto.randomUUID() });
  const body = await res.json();
  assert.equal(res.status, 502); assert.equal(body.diagnostics.httpStatus, 401);
  assert.equal(body.message, 'Firma inválida'); assert.equal(body.url, undefined);
  assert.equal(sent.amount, 6000);
  for (const file of ['/', '/app.js', '/style.css']) assert.equal((await fetch(base + file)).status, 200);
  assert.equal((await fetch(base + '/.env')).status, 404);
});
