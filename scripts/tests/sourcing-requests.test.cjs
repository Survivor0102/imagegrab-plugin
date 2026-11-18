const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const scope = vm.createContext({ URL, TextEncoder, crypto: require('node:crypto').webcrypto });
for (const file of ['sourcing-match.js', 'sourcing-substitute-match.js', 'sourcing-requests.js', 'you-sync.js'])
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../imagegrab-extension', file), 'utf8'), scope);
const helper = scope.ImageGrabSourcingRequests;
const copy = value => JSON.parse(JSON.stringify(value));
const target = { criteria: { name: '亮亮照明 LED 筒灯', brand: '亮亮照明', specs: '12W' }, reference: { image: 'data:image/png;base64,AAAA' } };

test('target identity is stable and separates distinct specifications and input images', () => {
  const a = helper.snapshot(target);
  assert.equal(a.id, helper.snapshot(copy(target)).id);
  assert.notEqual(a.id, helper.snapshot({ ...target, criteria: { ...target.criteria, specs: '5W' } }).id);
  assert.notEqual(a.id, helper.snapshot({ ...target, reference: { image: 'data:image/png;base64,BBBB' } }).id);
  assert.equal(helper.snapshot({ criteria: {} }), null);
  assert.equal(a.reference.image, target.reference.image);
});

test('a brand abbreviation remains unknown instead of becoming a false different-brand substitute', () => {
  const result = scope.ImageGrabSubstituteMatch.brandEvidence({details:{attributes:[{name:'品牌',value:'亮亮'}]}},{brand:'亮亮照明'});
  assert.equal(result.relation,'unknown');assert.match(result.reason,/简称/);
});

test('a supplier may be linked to several targets without erasing membership', () => {
  const a = helper.snapshot(target), b = helper.snapshot({ criteria: { name: '备用筒灯', specs: '5W' } });
  const data = { sourcingRequests: [a, b], offers: [{ productId: 'p', url: 'https://detail.1688.com/offer/123.html',
    sourcingRequests: [{ requestId: a.id, evidence: { criteria: a.criteria } }, { requestId: b.id, evidence: { criteria: b.criteria } }] }] };
  const before = JSON.stringify(data), result = helper.collect(data);
  assert.equal(result.requests.length, 2); assert.equal(result.links.length, 2);
  assert.equal(JSON.stringify(data), before);
});

test('history is restored only from explicit saved criteria, never from candidate title similarity', () => {
  const criteria = { name: '亮亮照明 LED 筒灯', specs: '12W' };
  const result = helper.collect({ offers: [
    { productId: 'p1', url: 'https://detail.1688.com/offer/1.html', sourcingEvidence: { criteria } },
    { productId: 'p2', url: 'https://detail.1688.com/offer/2.html', sourcingEvidence: { criteria } },
    { productId: 'p3', url: 'https://detail.1688.com/offer/3.html', title: '亮亮照明 LED 筒灯 12W' },
    { productId: 'p4', url: 'https://detail.1688.com/offer/4.html', sourcingEvidence: { criteria: { name: '桶装 小皮筋' } } },
  ] });
  assert.equal(result.requests.length, 2); assert.equal(result.links.length, 3);
  assert.ok(result.requests.every(r => r.reference === null && r.provenance === 'saved-criteria'));
  assert.ok(!result.links.some(r => r.productId === 'p3'));
});

test('current detail capture overrides an obsolete affirmative comparison during synchronization', () => {
  const request = helper.snapshot({ criteria: { name: '全塑筒灯', brand: '亮亮照明', specs: '12W' } });
  const result = helper.collect({ sourcingRequests: [request], offers: [{ productId: 'p', title: '铁壳筒灯', url: 'https://detail.1688.com/offer/1.html',
    details: { title: '铁壳筒灯', attributes: [{ name: '材质', value: '铁' }], skus: [{ value: '12W' }] },
    sourcingRequests: [{ requestId: request.id, evidence: { criteria: request.criteria, targetSpecStatus: 'included' } }] }] });
  assert.equal(result.links[0].evidence.targetSpecStatus, 'excluded');
});

test('synchronization places products and offers before requests, and all links after requests', () => {
  const a = helper.snapshot(target), data = { products: [{ id: 'p' }], sourcingRequests: [a],
    offers: [{ productId: 'p', url: 'https://detail.1688.com/offer/123.html', sourcingRequests: [{ requestId: a.id, evidence: { criteria: a.criteria } }] }] };
  const batches = scope.ImageGrabYouSync.batches(data, 'client-12345', { id: 'job' });
  const productIndex = batches.findIndex(b => b.products.length), offerIndex = batches.findIndex(b => b.offers.length);
  const requestIndex = batches.findIndex(b => b.requests?.length), linkIndex = batches.findIndex(b => b.links?.length);
  assert.ok(productIndex < offerIndex && offerIndex < requestIndex && requestIndex < linkIndex);
  assert.equal(batches[linkIndex].links[0].requestId, a.id);
  assert.ok(batches.at(-1).job);
});

test('all independent candidates sync without admission; only twenty non-excluded rows are planned', () => {
  const state = { criteria: { name: '筒灯', specs: '12W', substitute: true, matchMode: 'exact', limit: 20 },
    candidates: Array.from({ length: 32 }, (_, i) => ({ url: `https://detail.1688.com/offer/${1000+i}.html`,
      title: i === 31 ? '筒灯 18W' : i === 0 ? '筒灯 12W' : '筒灯', images: ['https://example.com/a.jpg'] })) };
  const archive = { products: [], offers: [] }, pools = { imagegrabSourcingSubstituteData: state };
  const before = JSON.stringify({ archive, pools }), result = helper.collect(archive, pools);
  assert.equal(result.requests.length, 1); assert.equal(result.candidates.length, 32);
  assert.equal(result.links.length, 0); assert.ok(result.candidates.every(c => !c.productId));
  const planned = result.candidates.filter(c => c.plannedRank);
  assert.equal(planned.length, 20); assert.equal(planned[0].stage, 'priority');
  assert.ok(planned.some(c => c.stage === 'review')); assert.ok(!planned.some(c => c.stage === 'excluded'));
  assert.equal(new Set(planned.map(c => c.plannedRank)).size, 20);
  const chunks = scope.ImageGrabYouSync.batches({ ...archive, sourcingSync: result }, 'client-empty');
  assert.equal(chunks.flatMap(c => c.candidates || []).length, 32);
  assert.equal(chunks.flatMap(c => c.products).length, 0);
  assert.ok(chunks.findIndex(c => c.requests?.length) < chunks.findIndex(c => c.candidates?.length));
  assert.equal(JSON.stringify({ archive, pools }), before);
});

test('pool sync refreshes current detail evidence and keeps separate branch targets', () => {
  const state = { criteria: { name: '全塑筒灯', specs: '12W', substitute: true, matchMode: 'exact' },
    candidates: [{ title: '全塑筒灯 12W', url: 'https://detail.1688.com/offer/1.html' }] };
  const legacy = helper.snapshot(state, 'history', true);
  const archive = { sourcingRequests: [legacy], offers: [{ productId: 'p', url: state.candidates[0].url,
    details: { title: '铁壳筒灯 12W', attributes: [{ name: '材质', value: '铁' }], capturedAt: 123 } }] };
  const result = helper.collect(archive, { imagegrabSourcingSubstituteData: state,
    imagegrabSourcingData: { criteria: { name: '小皮筋' }, candidates: [{ title: '小皮筋', url: 'https://detail.1688.com/offer/2.html' }] } });
  assert.equal(result.requests.length, 2);
  const lamp = result.candidates.find(c => c.productId === 'p');
  assert.equal(lamp.requestId, legacy.id); assert.equal(lamp.stage, 'excluded');
  assert.equal(lamp.evidence.targetSpecStatus, 'excluded'); assert.equal(lamp.plannedRank, null);
});
