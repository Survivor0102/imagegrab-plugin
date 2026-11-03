const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

test('ImageGrab associates visible sales on search and detail DOMs and renders the result', {
  skip: !fs.existsSync(chromePath), timeout: 30000
}, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://s.taobao.com/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>搜索结果</title></head><body></body></html>'
    }));
    await page.route('https://item.taobao.com/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>详情</title></head><body></body></html>'
    }));
    await page.route('https://img.alicdn.com/**', route => route.abort());

    await page.goto('https://s.taobao.com/search?q=fixture');
    await page.setContent(`<!doctype html><html><head><title>搜索结果</title></head><body>
      <article class="product-card"><a href="https://item.taobao.com/item.htm?id=11" title="红色商品"><img alt="红色商品" width="320" height="320" style="width:320px;height:320px" src="https://img.alicdn.com/duplicate.jpg"></a><span>月销 1.2万+</span></article>
      <article class="product-card"><a href="https://item.taobao.com/item.htm?id=12" title="蓝色商品"><img alt="蓝色商品" width="320" height="320" style="width:320px;height:320px" src="https://img.alicdn.com/blue.jpg"></a><span>已售 328 件</span></article>
      <article class="product-card"><a href="https://item.taobao.com/item.htm?id=13" title="重复图商品"><img alt="重复图商品" width="320" height="320" style="width:320px;height:320px" src="https://img.alicdn.com/duplicate.jpg"></a><span>月销 900</span></article>
      <div class="doubleCardAdapt--fixture"><a class="doubleCardWrapperAdapt--mEcC7olq" href="https://mclick.simba.taobao.com/cc_im?id=987654321"><img class="mainImg--sPh_U37m" width="320" height="320" style="width:320px;height:320px" src="https://img.alicdn.com/taobao-tracked.jpg"><div class="title--fixture">复古通勤女包</div><span>6000+人付款</span><span>旗舰店</span></a></div>
      <span>推荐区 月销 88万+</span>
    </body></html>`);
    await page.evaluate(() => {
      for (const image of document.querySelectorAll('img')) {
        Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 320 });
        Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 320 });
      }
      window.chrome = { runtime: { sendMessage(message, callback) { window.__imagegrabMessage = message; callback?.({ ok: true }); } } };
    });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/sales.js') });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/content.js') });
    await page.locator('#imagegrab-floating-button').click();
    await page.waitForFunction(() => Boolean(window.__imagegrabMessage));

    const searchRows = await page.evaluate(() => window.__imagegrabMessage.images.map(item => ({ url: item.url, product: item.product })));
    const blue = searchRows.find(row => row.url.endsWith('/blue.jpg'));
    assert.ok(blue, `blue candidate missing: ${JSON.stringify({ url: await page.url(), images: await page.locator('img').evaluateAll(items => items.map(img => ({ src: img.src, currentSrc: img.currentSrc, width: img.width, height: img.height }))), payload: searchRows })}`);
    const duplicate = searchRows.find(row => row.url.endsWith('/duplicate.jpg'));
    assert.equal(blue.product.title, '蓝色商品');
    assert.equal(blue.product.productUrl, 'https://item.taobao.com/item.htm?id=12');
    assert.equal(blue.product.salesText, '已售 328 件');
    assert.equal(duplicate.product.ambiguous, true);
    const tracked = searchRows.find(row => row.url.endsWith('/taobao-tracked.jpg'));
    assert.equal(tracked.product.title, '复古通勤女包');
    assert.equal(tracked.product.productUrl, 'https://mclick.simba.taobao.com/cc_im?id=987654321');
    assert.equal(tracked.product.salesText, '6000+人付款');
    assert.equal(searchRows.some(row => row.product?.salesText === '月销 88万+'), false);

    await page.goto('https://item.taobao.com/item.htm?id=21');
    await page.setContent(`<!doctype html><html><head><title>商品详情</title></head><body>
      <main class="item-info"><h1>详情页商品标题</h1><div class="metrics">月销 5.6千+</div><img alt="详情主图" width="320" height="320" style="width:320px;height:320px" src="https://img.alicdn.com/detail.jpg"></main>
      <aside>推荐商品 已售 7.8万件</aside>
    </body></html>`);
    await page.evaluate(() => {
      window.__imagegrabMessage = null;
      for (const image of document.querySelectorAll('img')) {
        Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 320 });
        Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 320 });
      }
      window.chrome = { runtime: { sendMessage(message, callback) { window.__imagegrabMessage = message; callback?.({ ok: true }); } } };
    });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/sales.js') });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/content.js') });
    await page.locator('#imagegrab-floating-button').click();
    await page.waitForFunction(() => Boolean(window.__imagegrabMessage));
    const detail = await page.evaluate(() => window.__imagegrabMessage.images.find(item => item.url.endsWith('/detail.jpg')).product);
    assert.equal(detail.title, '详情页商品标题');
    assert.equal(detail.productUrl, 'https://item.taobao.com/item.htm?id=21');
    assert.equal(detail.salesText, '月销 5.6千+');

    await page.setContent(`<!doctype html><html><body>
      <header><span id="source-meta"></span><span id="selected-count"></span></header>
      <button id="select-all"></button><button id="invert-selection"></button><button id="download-selected"></button>
      <div id="status"></div><section id="gallery"></section>
      <template id="image-card-template"><article class="image-card"><label><input class="image-check" type="checkbox"></label><img class="preview"><span class="image-index"></span><span class="image-size"></span><p class="product-title"></p><p class="product-sales"></p><a class="product-link" hidden></a><button class="single-download"></button></article></template>
    </body></html>`);
    await page.evaluate(product => {
      window.chrome = {
        storage: { local: { get: async () => ({ imagegrabGalleryState: { images: [{ url: 'https://img.alicdn.com/a.jpg', product }], pageTitle: 'fixture', sourceUrl: 'https://s.taobao.com/search?q=fixture' } }) } },
        downloads: { download: async () => 1 }, runtime: { sendMessage: async () => ({ ok: true }) }
      };
    }, blue.product);
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/gallery.js') });
    await page.locator('.product-title').waitFor();
    assert.equal(await page.locator('.product-title').textContent(), '蓝色商品');
    assert.equal(await page.locator('.product-sales').textContent(), '已售 328 件');
    assert.equal(await page.locator('.product-link').getAttribute('href'), 'https://item.taobao.com/item.htm?id=12');
  } finally {
    await browser.close();
  }
});
