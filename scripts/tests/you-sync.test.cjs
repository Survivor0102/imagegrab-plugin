const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { TextEncoder } = require('node:util');
const script = fs.readFileSync(path.resolve(__dirname, '../../imagegrab-extension/you-sync.js'), 'utf8');
function load(extra = {}) { const scope = { TextEncoder, URL, ...extra }; vm.runInNewContext(script, scope); return scope; }

test('server sync batches preserve every parent, offer, certificate and SKU within limits', () => {
  const { ImageGrabYouSync: sync } = load();
  const data = { products: [], offers: [], certificates: [] };
  for (let i = 0; i < 43; i++) {
    data.products.push({ id: `p${i}`, title: `商品${i}`, skus: ['legacy-parent-duplicate'] });
    data.certificates.push({ productId: `p${i}`, status: 'unverified' });
    data.offers.push({ id: `o${i}`, productId: `p${i}`, details: { skus: [{ value: '12W', priceText: '¥15', imageUrl: 'https://example.com/sku.jpg' }] } });
  }
  const before = JSON.stringify(data);
  const chunks = sync.batches(data, 'test-client-123', { id: 'run-a', items: [{ status: 'complete' }] });
  assert.equal(chunks.length, 7);
  assert.equal(chunks.flatMap(c => c.products).length, 43);
  assert.equal(chunks.flatMap(c => c.offers).length, 43);
  assert.equal(chunks.flatMap(c => c.certificates).length, 43);
  assert.equal(chunks.at(-1).job.run_id, 'run-a');
  assert.equal(chunks.flatMap(c => c.offers)[42].details.skus[0].priceText, '¥15');
  assert.equal(JSON.stringify(data), before);
  assert.ok(chunks.every(c => c.products.length <= 20 && c.offers.length <= 20));
  assert.ok(chunks.filter(c => c.offers.length).every(c => c.products.length === 0));
});

test('orphan records and oversized single captures fail before any upload', () => {
  const sync = load().ImageGrabYouSync;
  assert.throws(() => sync.batches({ products: [{ id: 'p' }], offers: [{ productId: 'missing' }] }, 'client'), /没有所属商品/);
  assert.throws(() => sync.batches({ products: [{ id: 'p' }], offers: [{ productId: 'p', huge: 'x'.repeat(4000) }] }, 'client', null, 1000), /过大/);
});

test('site bridge refreshes expired website JWT and returns counts without credentials', async () => {
  const local = new Map([['access_token', 'expired-secret']]); const calls = [];
  const scope = load({
    location: { origin: 'http://47.94.215.192:8000' },
    localStorage: { getItem: k => local.get(k), setItem: (k, v) => local.set(k, v) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('refresh_token')) return { ok: true, json: async () => ({ access: 'new-secret' }) };
      if (calls.length === 1) return { status: 401, ok: false };
      return { status: 200, ok: true, json: async () => ({ result: 'success', created_offers: 1 }) };
    },
  });
  const result = await scope.ImageGrabYouSync.sendFromWebsite({ client_id: 'c', offers: [] }, scope.location.origin);
  assert.equal(result.ok, true); assert.equal(calls.length, 3);
  assert.equal(calls[2].options.headers.Authorization, 'Bearer new-secret');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal((await scope.ImageGrabYouSync.sendFromWebsite({}, 'https://other.test')).ok, false);
});

test('site bridge refuses logged-out and non-admin website sessions', async () => {
  let calls = 0;
  const scope = load({ location: { origin: 'http://47.94.215.192:8000' }, localStorage: { getItem: () => '' }, fetch: () => { calls++; } });
  assert.equal((await scope.ImageGrabYouSync.sendFromWebsite({}, scope.location.origin)).ok, false); assert.equal(calls, 0);
  scope.localStorage.getItem = () => 'reader-jwt';
  scope.fetch = async () => ({ ok: false, status: 403, json: async () => ({ detail: '需要管理员权限' }) });
  const result = await scope.ImageGrabYouSync.sendFromWebsite({}, scope.location.origin);
  assert.equal(result.ok, false); assert.match(result.error, /管理员/);
});
