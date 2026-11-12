const test = require('node:test');
const assert = require('node:assert/strict');
require('../../imagegrab-extension/sourcing-image.js');
require('../../imagegrab-extension/sourcing-match.js');

test('OCR parsing separates title, explicit brand, category, primary size, barcode and retail IDs', () => {
  const text = `Oo ee 悦鲜活 鲜牛奶 260ml(250ml+赠 ”260ml*1瓶(260毫升Iml) / HR) 单品 门店: 1/8 总部零售价: - 2 渠道类目: 多
ni 10ml/瓶 SKU: 2118272065820971008 国乳品>牛奶/羊奶>鲜奶/巴氏奶
SPU: 2118272065812582417 商品条码: 6922577738152 乳制品>鲜奶/纯奶>冷藏鲜奶`;
  const parsed = globalThis.ImageGrabSourcingImage.parse(text, 88);
  assert.match(parsed.title, /^悦鲜活 鲜牛奶 260ml$/);
  assert.equal(parsed.brand, '');
  assert.match(parsed.category, /鲜牛奶/);
  assert.equal(parsed.specs, '260ml');
  assert.equal(parsed.barcode, '6922577738152');
  assert.equal(parsed.sku, '2118272065820971008');
  assert.equal(parsed.spu, '2118272065812582417');
  assert.equal(parsed.confidence, 88);
});

test('OCR parsing keeps the product title usable and does not infer brand or barcode from platform identifiers', () => {
  const text = `a 猫咪卡通款发夹少女可爱发夹发来。 (10克(9) / 个)                单品      门店: 1/8>       BREA: - 2        渠道类目:                 编辑
4 鸭叶来无痕侧边发夹发饰可爱夹子 ”SKU: 2118304875050954836                                                     A ARE EL > 服饰配饰>发饰       同步商品到渠道
1个               商品条码: 2118304875050954836                                    回 美收饰品>美发工具及饰品>发饰 Nas
SPU: 2118304875046543431    外部编码: -                                                                                      更多
商品类目: -               售卖
店内分类: 美妆护肤>头饰发夹`;
  const parsed = globalThis.ImageGrabSourcingImage.parse(text, 78);
  assert.match(parsed.title, /猫咪卡通款发夹少女可爱发夹/);
  assert.doesNotMatch(parsed.title, /SKU|SPU|商品条码|店内分类|10克/);
  assert.equal(parsed.brand, '');
  assert.match(parsed.category, /发夹/);
  assert.equal(parsed.specs, '');
  assert.equal(parsed.barcode, '');
  assert.equal(parsed.sku, '2118304875050954836');
  assert.equal(parsed.spu, '2118304875046543431');
});

test('milliliter constraints are compared against listing titles', () => {
  const result = globalThis.ImageGrabSourcingMatch.screen([{
    title: '悦鲜活 鲜牛奶 260ml（250ml加赠10ml）',
    url: 'https://detail.1688.com/offer/12345678.html',
    images: []
  }], {
    name: '悦鲜活 鲜牛奶 260ml', category: '鲜牛奶 牛奶', specs: '260ml', mode: 'alternative'
  });
  assert.equal(result.shortlist.length, 1);
  assert.equal(result.shortlist[0].status, 'candidate');
});
