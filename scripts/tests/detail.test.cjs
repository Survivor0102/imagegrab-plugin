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
      <div id="gallery"><img class="preview-img" src="https://img.test/main.jpg"><img class="preview-img" src="https://img.test/variant.jpg_.webp"><img src="https://img.test/icon.jpg"></div>
      <div id="description"><v-detail-j></v-detail-j></div>
      <div id="skuSelection"><div class="feature-item"><h3>颜色</h3><div class="sku-filter-button active"><span class="label-name">原木色</span><img src="https://img.test/variant.jpg_sum.jpg"></div></div><div class="feature-item"><h3>尺寸</h3>${['6mm','8mm','10mm'].map(value => `<div class="expand-view-item"><span class="item-label" title="${value}">${value}</span><span class="item-price-stock">¥0.01</span><span class="item-price-stock">库存100个</span><input></div>`).join('')}</div></div>
      <aside><a href="https://detail.1688.com/offer/999.html"><img src="https://img.test/unrelated.jpg">推荐商品</a></aside>`);
    await page.evaluate(() => {
      document.querySelector('v-detail-j').attachShadow({ mode: 'open' }).innerHTML = '<style>.private{color:red}</style><img src="https://img.test/description.jpg"><a href="https://detail.1688.com/offer/999.html"><img src="https://img.test/recommended-in-description.jpg"></a>';
      window.chrome = { storage: { local: { get: async () => ({}) } }, runtime: { sendMessage(message, callback) { window.__capture = message; callback({ ok: true }); } } };
      const script = document.createElement('script'); script.type = 'application/x-fixture';
      script.textContent = 'window.context=(function(b,d){return d})(window.contextPath,' + JSON.stringify({ result: { hierarchy: { root: 'Root' }, data: { Root: { fields: { dataJson: { offerBaseInfo: { offerId: 123 }, frontSellerMemberModel: { frontOfferId: 123, frontSellerLoginId: '木珠客服', frontSellerMemberId: 'b2b-wood' } } } } } } }) + ');';
      document.body.appendChild(script);
    });
    await page.addScriptTag({ path: source('detail-capture.js') });
    const manifest = JSON.parse(fs.readFileSync(source('manifest.json'), 'utf8'));
    const detailScripts = manifest.content_scripts.find(entry => entry.matches.includes('*://*.1688.com/*'));
    for (const css of detailScripts.css || []) await page.addStyleTag({ path: source(css) });
    await page.addScriptTag({ path: source('research-capture.js') });
    await page.evaluate(() => {
      document.body.style.minHeight = '12000px';
      window.scrollTo(0, 0);
    });
    const buttonPosition = await page.locator('#imagegrab-research-button').evaluate(button => {
      const rect = button.getBoundingClientRect();
      return { position: getComputedStyle(button.parentElement).position, visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth, clickable: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) };
    });
    assert.deepEqual(buttonPosition, { position: 'fixed', visible: true, clickable: true });
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
    assert.equal(row.customerService.loginId, '木珠客服');
    assert.equal(new URL(row.customerService.url).searchParams.get('touid'), 'cnalichn木珠客服');
    assert.deepEqual(row.packaging, [{ headers: ['重量(g)'], rows: [['50']] }]);
    assert.equal(row.moqText, '100个起批');
    assert.equal(row.skus.length, 3);
    assert.equal(row.skus[0].imageAssociation, 'selected-option-shared');
    assert.equal(row.skus[0].imageUrl, 'https://img.test/variant.jpg_.webp');
    assert.equal(row.skus[0].thumbnailUrl, 'https://img.test/variant.jpg_sum.jpg');
    assert.deepEqual(row.media.map(x => x.role), ['main', 'main', 'description', 'sku-option']);
    assert.equal(row.videoUrls.length, 0);
    assert.equal(row.salesObservations.length, 1);
    assert.doesNotMatch(JSON.stringify(row), /私人地址|unrelated|recommended|color:red/);

    // Single-price offers have an actual purchasable row with an empty label.
    // Retain its displayed price and stock without inventing a named variant.
    const single = await page.evaluate(() => {
      const group = document.querySelector('#skuSelection .feature-item:last-child');
      group.classList.add('pseudo');
      const labels = [...group.querySelectorAll('.item-label')];
      labels[0].textContent = ''; labels[0].setAttribute('title', '');
      group.querySelectorAll('.expand-view-item')[1].querySelector('.item-price-stock:last-of-type').outerHTML = '<div class="item-count-invalid">库存不足</div>';
      return ImageGrabDetail.collect();
    });
    assert.equal(single.skus.length, 3);
    assert.equal(single.skus[0].value, '默认规格（页面未列名称）');
    assert.equal(single.skus[0].priceText, '¥0.01');
    assert.equal(single.skus[0].stockText, '库存100个');
    assert.equal(single.skus[1].stockText, '库存不足');

    // A SKU row can carry its own image instead of sharing a selected color.
    const rowImages = await page.evaluate(() => {
      const rows = document.querySelectorAll('#skuSelection .expand-view-item');
      rows[0].insertAdjacentHTML('afterbegin', '<img src="https://img.test/12w.jpg">');
      rows[1].insertAdjacentHTML('afterbegin', '<img src="https://img.test/18w.jpg">');
      return ImageGrabDetail.collect();
    });
    assert.equal(rowImages.skus[0].imageUrl, 'https://img.test/12w.jpg');
    assert.equal(rowImages.skus[1].imageUrl, 'https://img.test/18w.jpg');
    assert.equal(rowImages.skus[0].imageAssociation, 'sku-row');
    assert.equal(rowImages.skus[2].imageAssociation, 'selected-option-shared');
    assert(rowImages.media.some(x => x.role === 'sku-option' && x.url === 'https://img.test/12w.jpg'));

    const rowOnly = await page.evaluate(() => {
      document.querySelector('.sku-filter-button').remove();
      return ImageGrabDetail.collect();
    });
    assert.equal(rowOnly.skus[0].imageUrl, 'https://img.test/12w.jpg');
    assert.equal(rowOnly.skus[2].imageAssociation, 'not-found');

    const store = { imagegrabResearchData: { products: [{ id: 'p1', title: '榜单木珠', sourceUrl: 'https://detail.1688.com/offer/123.html?old=2', sourceType: 'ranking', images: [] }], offers: [{ id: 'o1', productId: 'p1', url: 'https://detail.1688.com/offer/123.html?old=2', salesText: '1.2M 月销量', sourceType: 'ranking', sourceUrl: 'https://air.1688.com/ranking' }], certificates: [] }, imagegrabResearchCapture: capture };
    const workbench = await browser.newPage();
    const html = fs.readFileSync(source('research.html'), 'utf8').replace(/<link[^>]+>/, '').replace('<script src="research.js"></script>', '');
    async function importAgain() {
      await workbench.setContent(html);
      await workbench.evaluate(value => { window.__store = value; window.chrome = { storage: { local: { get: async key => ({ [key]: window.__store[key] }), set: async data => Object.assign(window.__store, data), remove: async key => { delete window.__store[key]; } } } }; }, store);
      await workbench.addScriptTag({ path: source('offer-data.js') });
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
    assert.match(csv, /客服链接/);
    assert.match(csv, /木珠客服/);
    assert.match(csv, /6mm/);
    assert.match(csv, /ranking-displayed-sales/);
    assert.equal(store.imagegrabResearchData.offers.length, 1);
    assert.equal(store.imagegrabResearchData.products[0].sourceType, 'ranking');
    assert.equal(store.imagegrabResearchData.products[0].brand, '乐铭工艺');
    assert.equal(store.imagegrabResearchData.offers[0].supplierName, '木珠工厂');
    assert.equal(store.imagegrabResearchData.offers[0].customerService.url, row.customerService.url);
    assert.equal(await workbench.locator('.offer-card [data-customer-service="o1"]').getAttribute('href'), row.customerService.url);
    assert.equal(store.imagegrabResearchData.offers[0].salesObservations.length, 2);
    assert.match(await workbench.locator('#detail-panel').innerText(), /规格报价（3 项）/);
    assert.match(await workbench.locator('.offer-card').innerText(), /发货地：浙江台州/);
    assert.match(await workbench.locator('.status-text').innerText(), /基础资料齐全/);
    await workbench.locator('[data-view="offers"]').click();
    assert.match(await workbench.locator('tbody').innerText(), /发货地：浙江台州/);
    assert.equal(await workbench.locator('tbody [data-customer-service="o1"]').getAttribute('href'), row.customerService.url);
    assert.doesNotMatch(await workbench.locator('tbody').innerText(), /地区待补/);
    await workbench.locator('#search').fill('浙江台州');
    assert.equal(await workbench.locator('tbody tr').count(), 1);
    store.imagegrabResearchCapture = capture;
    await importAgain();
    assert.equal(store.imagegrabResearchData.offers[0].salesObservations.length, 2);
    assert.equal(store.imagegrabResearchData.products.length, 1);
    store.imagegrabResearchData.offers.push({ id: 'second-offer', productId: 'p1', url: 'https://detail.1688.com/offer/456.html', supplierName: '第二工厂' });
    store.imagegrabResearchCapture = { sourceUrl: 'https://detail.1688.com/offer/456.html', products: [{ ...row, url: 'https://detail.1688.com/offer/456.html', title: '第二工厂的同款', supplierName: '第二工厂', priceText: '¥9.99', skus: [{ value: '99mm', priceText: '¥9.99', imageUrl: 'https://img.test/second.jpg' }] }] };
    await importAgain();
    assert.equal(store.imagegrabResearchData.products.length, 1);
    assert.equal(store.imagegrabResearchData.offers.length, 2);
    assert.equal(store.imagegrabResearchData.offers[0].details.skus.length, 3);
    assert.equal(store.imagegrabResearchData.offers[1].details.skus[0].priceText, '¥9.99');
    assert.equal(store.imagegrabResearchData.products[0].title, '大孔木珠');
  } finally { await browser.close(); }
});
