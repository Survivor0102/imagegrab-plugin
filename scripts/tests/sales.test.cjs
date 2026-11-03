const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSalesText } = require('../../imagegrab-extension/sales.js');

test('keeps visible monthly sales wording and amount', () => {
  assert.equal(extractSalesText('商品标题 月销 1.2万+'), '月销 1.2万+');
});

test('recognizes sold and payment-count labels without normalizing them', () => {
  assert.equal(extractSalesText('已售 328 件'), '已售 328 件');
  assert.equal(extractSalesText('2.4万人已付款'), '2.4万人已付款');
});

test('does not infer a number without a recognized sales label', () => {
  assert.equal(extractSalesText('商品标题 2026 新款 128'), '');
  assert.equal(extractSalesText(''), '');
});
