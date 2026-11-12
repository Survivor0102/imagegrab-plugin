const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const sample = JSON.parse(fs.readFileSync(path.join(root, 'evidence/2026-11-04/wood-beads-detail-1.4.0.json'), 'utf8'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGQUAAAAASUVORK5CYII=', 'base64');

test('supplier detail page migrates real sample, isolates offers, exports SKUs and tracks image download results', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    const product = structuredClone(sample.product), first = structuredClone(sample.offers[0]);
    const second = { id: 'second-supplier', productId: product.id, supplierName: '第二家工厂', url: 'https://detail.1688.com/offer/987654321.html', shipFrom: '广东广州', priceText: '¥9.99' };
    const store = { imagegrabResearchData: { products: [product], offers: [first, second], certificates: [] } };
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'fixture.test') {
        const file = path.join(root, 'imagegrab-extension', url.pathname.replace(/^\/+/, ''));
        const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
        return route.fulfill({ contentType: type, body: fs.readFileSync(file) });
      }
      return route.fulfill({ contentType: 'image/png', body: png });
    });
    await page.addInitScript(initial => {
      if (!localStorage.getItem('testStore')) localStorage.setItem('testStore', JSON.stringify(initial));
      let downloads = [], seq = 0;
      window.chrome = {
        storage: { local: {
          get: async keys => { const data = JSON.parse(localStorage.getItem('testStore')); return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])); },
          set: async values => localStorage.setItem('testStore', JSON.stringify({ ...JSON.parse(localStorage.getItem('testStore')), ...values })),
          remove: async key => { const data = JSON.parse(localStorage.getItem('testStore')); delete data[key]; localStorage.setItem('testStore', JSON.stringify(data)); }
        } },
        downloads: {
          download: async options => { if (window.__forceFail) throw new Error('fixture network failure'); const id = ++seq; downloads.push({ id, ...options, state: 'complete' }); window.__downloadCalls = downloads; return id; },
          search: async query => downloads.filter(d => d.id === query.id)
        }
      };
    }, store);
    await page.goto('https://fixture.test/research.html#offers');
    await page.locator('tbody tr').first().waitFor();
    assert.equal(await page.locator('tbody tr').count(), 2);
    await page.locator(`[data-offer-details="${first.id}"]`).click();
    await page.locator('.sku-table tbody tr').first().waitFor();
    assert.match(page.url(), /offer\.html\?id=/);
    assert.equal(await page.locator('.sku-table tbody tr').count(), 15);
    assert.match(await page.locator('.offer-meta').innerText(), /天台乐铭工艺品厂/);
    assert.match(await page.locator('.offer-meta').innerText(), /浙江台州/);
    assert.equal(await page.locator('.sku-table tbody tr').first().locator('img').getAttribute('src'), product.skus[0].imageUrl);
    assert.match(await page.locator('.sku-table tbody tr').first().innerText(), /6mm2颗（孔2mm）/);
    assert.match(await page.locator('.sku-table tbody tr').first().innerText(), /¥0.01/);
    assert.match(await page.locator('.sku-table tbody tr').first().innerText(), /共享选项图/);
    assert.equal(await page.locator('.media-grid figure').count(), 18);
    const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('testStore')).imagegrabResearchData);
    assert.equal(migrated.offers[0].details.skus.length, 15);
    assert.equal(migrated.offers[1].details, undefined);

    const csvPromise = page.waitForEvent('download');
    await page.locator('#export-skus').click();
    let csv = ''; for await (const chunk of await (await csvPromise).createReadStream()) csv += chunk.toString('utf8');
    assert.match(csv, /6mm2颗（孔2mm）/);
    assert.match(csv, /¥0.01/);
    assert.match(csv, /共享选项图/);
    assert.match(csv, /O1CN01Op4vyb2DACGTymJTT/);
    const jsonPromise = page.waitForEvent('download');
    await page.locator('#export-offer').click();
    let json = ''; for await (const chunk of await (await jsonPromise).createReadStream()) json += chunk.toString('utf8');
    assert.equal(JSON.parse(json).offer.details.skus.length, 15);

    await page.locator('[data-download-image]').first().click();
    await page.waitForFunction(() => document.querySelector('#download-status').textContent.includes('已完成 1'));
    const calls = await page.evaluate(() => window.__downloadCalls);
    assert.equal(calls.length, 1);
    assert.match(calls[0].filename, /^ImageGrab\/货源-[^/]+\/images\/001-主图\.webp$/);
    assert.equal(calls[0].url, product.media.find(m => m.role === 'main').url);
    await page.evaluate(() => { window.__forceFail = true; });
    await page.locator('[data-download-image]').nth(1).click();
    await page.waitForFunction(() => document.querySelector('#download-status').textContent.includes('失败 1'));
    assert.match(await page.locator('#download-status').innerText(), /fixture network failure/);

    await page.locator('.app-header a').last().click();
    await page.locator('[data-offer-details="second-supplier"]').click();
    await page.locator('.empty-notice').waitFor();
    assert.equal(await page.locator('.sku-table').count(), 0);
    assert.equal(await page.locator('.media-grid img').count(), 0);
    assert.match(await page.locator('.offer-meta').innerText(), /第二家工厂/);
    assert.equal(await page.locator('#export-skus').isDisabled(), true);

    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('testStore'));
      stored.imagegrabResearchData.offers[1].details = { title: '另一家规格', sourceUrl: 'https://detail.1688.com/offer/987654321.html', capturedAt: Date.now(), skus: [{ group: '尺寸', value: '99mm', priceText: '¥9.99', stockText: '库存42个', imageUrl: 'https://img.test/second.jpg', imageAssociation: 'sku' }], media: [{ role: 'sku-option', url: 'https://img.test/second.jpg' }] };
      localStorage.setItem('testStore', JSON.stringify(stored));
    });
    await page.reload();
    await page.locator('.sku-table tbody tr').waitFor();
    assert.equal(await page.locator('.sku-table tbody tr').count(), 1);
    assert.match(await page.locator('.sku-table tbody').innerText(), /99mm/);
    assert.doesNotMatch(await page.locator('.sku-table tbody').innerText(), /6mm2颗/);
    assert.equal(await page.locator('.sku-table img').getAttribute('src'), 'https://img.test/second.jpg');
    await page.goto('https://fixture.test/offer.html?id=missing');
    await page.getByRole('heading', { name: '未找到这条货源' }).waitFor();
  } finally { await browser.close(); }
});
