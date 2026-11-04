const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const source = name => path.join(root, 'imagegrab-extension', name);

test('detail capture excludes recommendations, reads shadow images and enriches the same ranked offer', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto('https://detail.1688.com/offer/123.html?tracking=1');
    await page.setContent(`<h1>这是店铺名称不是商品名</h1>
      <div id="productTitle"><div class="title-content"><h1>大孔木珠</h1></div></div>
      <div id="shopNavigation"><a class="shop-company-name" href="https://shop123.1688.com/">木珠工厂</a></div>
      <div id="productAttributes"><div class="cpv-attr-item"><span class="cpv-attr-label">材质</span><span class="cpv-attr-value">荷木</span></div><table><tr><th class="ant-descriptions-item-label">品牌</th><td>乐铭工艺</td><th class="ant-descriptions-item-label">类别</th><td>圆球</td></tr></table></div>
      <div id="mainPrice"><div class="price-info">¥ 0.01 ~ ¥ 1.20</div><div class="price-component"><p>100个起批60天老客价</p></div><span class="old-customer-tag">60天老客价</span><div class="sold-count"><div class="slick-slide">已售10万+个</div><div class="slick-slide slick-cloned">已售10万+个</div></div></div>
      <div id="shippingServices"><span class="location">浙江台州</span><span>收货到不应收录的私人地址</span></div>
      <div id="productPackInfo"><table><thead><tr><th>重量(g)</th></tr></thead><tbody><tr><td>50</td></tr></tbody></table></div>
      <div id="gallery"><img class="preview-img" src="https://img.test/main.jpg"><img src="https://img.test/icon.jpg"></div>
      <div id="description"><v-detail-j></v-detail-j></div>
      <div id="skuSelection"><div class="feature-item"><h3>颜色</h3><div class="sku-filter-button active"><span class="label-name">原木色</span><img src="https://img.test/color.jpg"></div></div><div class="feature-item"><h3>尺寸</h3>${['6mm','8mm','10mm'].map(value => `<div class="expand-view-item"><span class="item-label" title="${value}">${value}</span><span class="item-price-stock">¥0.01</span><span class="item-price-stock">库存100个</span><input></div>`).join('')}</div></div>
      <aside><a href="https://detail.1688.com/offer/999.html"><img src="https://img.test/unrelated.jpg">推荐商品</a></aside>`);
    await page.evaluate(() => {
      document.querySelector('v-detail-j').attachShadow({ mode: 'open' }).innerHTML = '<style>.private{color:red}</style><img src="https://img.test/description.jpg"><a href="https://detail.1688.com/offer/999.html"><img src="https://img.test/recommended-in-description.jpg"></a>';
      window.chrome = { storage: { local: { get: async () => ({}) } }, runtime: { sendMessage(message, callback) { window.__capture = message; callback({ ok: true }); } } };
    });
    await page.addScriptTag({ path: source('detail-capture.js') });
    await page.addScriptTag({ path: source('research-capture.js') });
    await page.locator('#imagegrab-research-button').click();
    const capture = await page.evaluate(() => window.__capture);
    assert.equal(capture.products.length, 1);
    const row = capture.products[0];
    assert.equal(row.title, '大孔木珠');
    assert.equal(row.url, 'https://detail.1688.com/offer/123.html');
    assert.equal(row.supplierName, '木珠工厂');
    assert.equal(row.brand, '乐铭工艺');
    assert.equal(row.origin, '');
    assert.equal(row.shipFrom, '浙江台州');
    assert.deepEqual(row.packaging, [{ headers: ['重量(g)'], rows: [['50']] }]);
    assert.equal(row.moqText, '100个起批');
    assert.equal(row.skus.length, 3);
    assert.equal(row.skus[0].imageAssociation, 'selected-option-shared');
    assert.deepEqual(row.media.map(x => x.role), ['main', 'description', 'sku-option']);
    assert.equal(row.videoUrls.length, 0);
    assert.equal(row.salesObservations.length, 1);
    assert.doesNotMatch(JSON.stringify(row), /私人地址|unrelated|recommended|color:red/);

    const store = { imagegrabResearchData: { products: [{ id: 'p1', title: '榜单木珠', sourceUrl: 'https://detail.1688.com/offer/123.html?old=2', sourceType: 'ranking', images: [] }], offers: [{ id: 'o1', productId: 'p1', url: 'https://detail.1688.com/offer/123.html?old=2', salesText: '1.2M 月销量', sourceType: 'ranking', sourceUrl: 'https://air.1688.com/ranking' }], certificates: [] }, imagegrabResearchCapture: capture };
    const workbench = await browser.newPage();
    const html = fs.readFileSync(source('research.html'), 'utf8').replace(/<link[^>]+>/, '').replace('<script src="research.js"></script>', '');
    async function importAgain() {
      await workbench.setContent(html);
      await workbench.evaluate(value => { window.__store = value; window.chrome = { storage: { local: { get: async key => ({ [key]: window.__store[key] }), set: async data => Object.assign(window.__store, data), remove: async key => { delete window.__store[key]; } } } }; }, store);
      await workbench.addScriptTag({ path: source('research.js') });
      await workbench.waitForFunction(() => !window.__store.imagegrabResearchCapture);
      Object.assign(store, await workbench.evaluate(() => window.__store));
    }
    await importAgain();
    assert.equal(store.imagegrabResearchData.products.length, 1);
    const downloaded = workbench.waitForEvent('download');
    await workbench.locator('#csv-button').click();
    const stream = await (await downloaded).createReadStream();
    let csv = ''; for await (const chunk of stream) csv += chunk.toString('utf8');
    assert.match(csv, /规格报价JSON/);
    assert.match(csv, /6mm/);
    assert.match(csv, /ranking-displayed-sales/);
    assert.equal(store.imagegrabResearchData.offers.length, 1);
    assert.equal(store.imagegrabResearchData.products[0].sourceType, 'ranking');
    assert.equal(store.imagegrabResearchData.products[0].brand, '乐铭工艺');
    assert.equal(store.imagegrabResearchData.offers[0].supplierName, '木珠工厂');
    assert.equal(store.imagegrabResearchData.offers[0].salesObservations.length, 2);
    assert.match(await workbench.locator('#detail-panel').innerText(), /规格报价（3 项）/);
    store.imagegrabResearchCapture = capture;
    await importAgain();
    assert.equal(store.imagegrabResearchData.offers[0].salesObservations.length, 2);
    assert.equal(store.imagegrabResearchData.products.length, 1);
  } finally { await browser.close(); }
});
