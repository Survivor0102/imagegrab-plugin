const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
function load() {
  const context = vm.createContext({ URL });
  vm.runInContext(fs.readFileSync(path.join(root, 'imagegrab-extension/ranking-scope.js'), 'utf8'), context);
  return context.ImageGrabRankingScope;
}

test('ranking scope exposes three board labels and fixes country to China', () => {
  const scope = load();
  assert.deepEqual(Array.from(scope.RANKINGS, item => item.label), ['人气热销', '潜力新品', '近期趋势']);
  const value = scope.normalize({ rankingKey: 'trend', categoryKey: 'home' });
  assert.equal(value.rankingName, 'TRENDING');
  assert.equal(value.countryCode, 'CN');
  assert.equal(value.categoryName, '居家日用品');
  const url = new URL(scope.toUrl(value));
  assert.equal(url.searchParams.get('rankingName'), 'TRENDING');
  assert.equal(url.searchParams.get('cateId'), '15');
  assert.equal(url.searchParams.get('countryCode'), 'CN');
});

test('scope round-trips the verified 1688 ranking URL', () => {
  const scope = load();
  const value = scope.fromUrl('https://air.1688.com/kapp/1688-global/sales/ranking?rankingName=Most_Popular&countryCode=CN&platform=cbu&cateId=15&cateLevel=1');
  assert.equal(value.rankingKey, 'hot');
  assert.equal(value.categoryKey, 'home');
  assert.equal(value.categoryName, '居家日用品');
});
