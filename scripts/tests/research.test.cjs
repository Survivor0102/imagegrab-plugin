const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

test('research workbench imports captured offers and manages product dossier data', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const store = {
      imagegrabResearchCapture: {
        sourceUrl: 'https://s.1688.com/selloffer/offer_search.htm?keywords=面霜',
        products: [{ title: '测试面霜', url: 'https://detail.1688.com/offer/123.html', images: ['https://example.test/a.jpg'], priceText: '¥12.50', salesText: '100件成交', moqText: '2件起批', supplierName: '测试工厂', supplierUrl: 'https://shop.1688.com/page/index.htm', visibleText: '测试面霜 100件成交' }]
      }
    };
    await page.setContent(fs.readFileSync(path.join(root, 'imagegrab-extension/research.html'), 'utf8').replace(/<link[^>]+>/, '').replace('<script src="research.js"></script>', ''));
    await page.evaluate(storeValue => { window.__store = storeValue; }, store);
    await page.evaluate(() => {
      window.chrome = {
        storage: { local: { get: async key => ({ [key]: window.__store[key] }), set: async values => Object.assign(window.__store, values), remove: async key => { delete window.__store[key]; } } },
        tabs: { create: async () => ({ id: 1 }) }
      };
    });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/research.js') });
    await page.locator('.product-row').waitFor();
    assert.equal(await page.locator('.product-row').count(), 1);
    assert.match(await page.locator('.product-row').innerText(), /测试面霜/);
    assert.match(await page.locator('.product-row').innerText(), /¥12\.50/);
    assert.match(await page.locator('.product-row').innerText(), /1 家/);

    await page.locator('[data-add-offer]').click();
    await page.locator('#offer-form [name="supplierName"]').fill('第二供应商');
    await page.locator('#offer-form [name="supplierUrl"]').fill('https://shop.1688.com/page/second.htm');
    await page.locator('#offer-form [name="url"]').fill('https://detail.1688.com/offer/456.html');
    await page.locator('#offer-form [name="priceText"]').fill('¥10.80');
    await page.locator('#offer-form button[value="save"]').click();
    assert.match(await page.locator('.detail-panel').innerText(), /第二供应商/);
    assert.match(await page.locator('#offer-count').innerText(), /2/);
    assert.equal((await page.evaluate(() => window.__store.imagegrabResearchData.offers[0])).supplierUrl, 'https://shop.1688.com/page/second.htm');

    await page.locator('[data-add-cert]').click();
    await page.locator('#certificate-form [name="type"]').fill('CCC');
    await page.locator('#certificate-form [name="number"]').fill('CN-TEST-001');
    await page.locator('#certificate-form button[value="save"]').click();
    await page.locator('[data-view="certificates"]').click();
    assert.match(await page.locator('tbody').innerText(), /CN-TEST-001/);
    assert.match(await page.locator('tbody').innerText(), /待核验/);

    page.on('dialog', dialog => dialog.accept());
    await page.locator('[data-view="products"]').click();
    await page.locator('#new-product').click();
    await page.locator('#product-form [name="title"]').fill('同款候选面霜');
    await page.locator('#product-form [name="sourceUrl"]').fill('https://detail.1688.com/offer/789.html');
    await page.locator('#product-form button[value="save"]').click();
    await page.locator('[data-add-offer]').click();
    await page.locator('#offer-form [name="supplierName"]').fill('候选工厂');
    await page.locator('#offer-form [name="url"]').fill('https://detail.1688.com/offer/789.html');
    await page.locator('#offer-form button[value="save"]').click();
    await page.locator('.product-row').filter({ hasText: '测试面霜' }).click();
    await page.locator('[data-merge-into]').click();
    assert.equal(await page.locator('.product-row').count(), 1);
    assert.match(await page.locator('.detail-panel').innerText(), /候选工厂/);
    const saved = await page.evaluate(() => window.__store.imagegrabResearchData);
    assert.equal(saved.products.length, 1);
    assert.equal(saved.offers.length, 3);
    assert.equal(saved.certificates[0].status, 'unverified');
  } finally {
    await browser.close();
  }
});

test('1688 page capture reads visible listing fields and opens the local research workflow', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <article><a href="https://detail.1688.com/offer/123.html"><img src="https://img.example.test/item.jpg" width="300" height="300"><span style="display:block">玻尿酸保湿面霜</span><span style="display:block">¥12.50</span><span style="display:block">2件起批</span><span style="display:block">100件成交</span></a><a href="https://shop.1688.com/page/index.htm">广州测试工厂</a></article>
      <article><a href="https://detail.1688.com/offer/456.html"><img src="https://img.example.test/item2.jpg" width="300" height="300"><span style="display:block">婴儿湿巾</span><span style="display:block">¥8</span></a><a href="https://shop.1688.com/page/second.htm">第二工厂</a></article>
    </main>`);
    await page.evaluate(() => { window.__capture = null; window.chrome = { runtime: { sendMessage(message, callback) { window.__capture = message; callback({ ok: true }); } } }; });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/research-capture.js') });
    await page.locator('#imagegrab-research-button').click();
    const result = await page.evaluate(() => window.__capture);
    assert.equal(result.type, 'OPEN_RESEARCH');
    assert.equal(result.products.length, 2);
    assert.equal(result.products[0].url, 'https://detail.1688.com/offer/123.html');
    assert.match(result.products[0].title, /玻尿酸保湿面霜/);
    assert.equal(result.products[0].priceText, '¥12.50');
    assert.equal(result.products[0].salesText, '100件成交');
    assert.equal(result.products[0].moqText, '2件起批');
    assert.equal(result.products[0].supplierName, '广州测试工厂');
    assert.equal(result.products[0].images[0], 'https://img.example.test/item.jpg');
  } finally {
    await browser.close();
  }
});

test('automatic capture follows visible pagination, deduplicates products, and stops at the end', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const store = {};
    await page.setContent(`<main><section id="listing"></section><nav class="pagination"><button id="previous" disabled>上一页</button><span id="current" aria-current="page">1</span><button id="next">下一页</button></nav></main>`);
    await page.evaluate(() => {
      window.__page = 1;
      const render = () => {
        const id = window.__page;
        const duplicate = window.__page === 2 ? '<article><a href="https://detail.1688.com/offer/1.html"><img src="https://img.example.test/1.jpg"><span style="display:block">测试商品 1</span></a></article>' : '';
        document.querySelector('#listing').innerHTML = `${duplicate}<article><a href="https://detail.1688.com/offer/${id}.html"><img src="https://img.example.test/${id}.jpg"><span style="display:block">测试商品 ${id}</span><span style="display:block">¥12.50</span></a></article>`;
        document.querySelector('#current').textContent = String(window.__page);
        document.querySelector('#previous').disabled = window.__page === 1;
        document.querySelector('#next').disabled = window.__page === 3;
      };
      document.querySelector('#next').addEventListener('click', () => { window.__page++; render(); });
      render();
    });
    await page.evaluate(storeValue => {
      window.__store = storeValue;
      window.chrome = {
        storage: { local: { get: async key => ({ [key]: window.__store[key] }), set: async values => Object.assign(window.__store, values), remove: async key => { delete window.__store[key]; } } },
        runtime: { sendMessage(message, callback) { window.__messages ||= []; window.__messages.push(message); callback?.({ ok: true }); } },
        tabs: { create: async () => ({ id: 1 }) }
      };
    }, store);
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/research-capture.js') });
    await page.locator('#imagegrab-research-auto-button').click();
    await page.waitForFunction(() => window.__store.imagegrabResearchAutoJob?.running === false, null, { timeout: 12000 });
    const job = await page.evaluate(() => window.__store.imagegrabResearchAutoJob);
    assert.equal(job.pageCount, 3);
    assert.equal(job.products.length, 3);
    assert.equal(job.finishReason, '未找到可用的下一页控件');
    assert.equal((await page.evaluate(() => window.__messages)).at(-1).type, 'FINISH_RESEARCH_AUTO');
  } finally {
    await browser.close();
  }
});

test('CSV export neutralizes spreadsheet formulas in captured product text', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const store = {
      imagegrabResearchData: {
        products: [{ id: 'formula-test', title: '=HYPERLINK("https://example.test")', sourceType: 'manual', images: [] }],
        offers: [],
        certificates: [],
        selectedId: 'formula-test'
      }
    };
    await page.setContent(fs.readFileSync(path.join(root, 'imagegrab-extension/research.html'), 'utf8').replace(/<link[^>]+>/, '').replace('<script src="research.js"></script>', ''));
    await page.evaluate(storeValue => { window.__store = storeValue; }, store);
    await page.evaluate(() => {
      window.chrome = {
        storage: { local: { get: async key => ({ [key]: window.__store[key] }), set: async values => Object.assign(window.__store, values), remove: async key => { delete window.__store[key]; } } },
        tabs: { create: async () => ({ id: 1 }) }
      };
    });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/research.js') });
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#csv-button').click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let csv = '';
    for await (const chunk of stream) csv += chunk.toString('utf8');
    assert.match(csv, /"'=HYPERLINK/);
  } finally {
    await browser.close();
  }
});
