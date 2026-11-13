const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

test('ranking scope filters the product list and constrain the current-filtered detail queue', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const products = [
      { id: 'trend-toys', title: '近期趋势玩具', sourceType: 'ranking', scope: { rankingKey: 'trend', rankingLabel: '近期趋势', categoryKey: 'toys', categoryName: '玩具', countryName: '中国' }, images: [] },
      { id: 'hot-toys', title: '人气热销玩具', sourceType: 'ranking', scope: { rankingKey: 'hot', rankingLabel: '人气热销', categoryKey: 'toys', categoryName: '玩具', countryName: '中国' }, images: [] },
      { id: 'trend-home', title: '近期趋势日用品', sourceType: 'ranking', scope: { rankingKey: 'trend', rankingLabel: '近期趋势', categoryKey: 'home', categoryName: '居家日用品', countryName: '中国' }, images: [] },
      { id: 'similar', title: '同款寻源商品', sourceType: 'similar', images: [] },
      { id: 'manual', title: '手动商品', sourceType: 'manual', images: [] }
    ];
    const store = {
      imagegrabResearchData: {
        products,
        offers: products.map(product => ({ id: `offer-${product.id}`, productId: product.id, url: `https://detail.1688.com/offer/${product.id === 'trend-toys' ? '101' : product.id === 'hot-toys' ? '102' : product.id === 'trend-home' ? '103' : product.id === 'similar' ? '104' : '105'}.html` })),
        certificates: [], selectedId: 'trend-toys'
      },
      imagegrabResearchScope: { rankingKey: 'hot', categoryKey: 'home' }
    };
    await page.setContent(fs.readFileSync(path.join(root, 'imagegrab-extension/research.html'), 'utf8').replace(/<link[^>]+>/, '').replace('<script src="research.js"></script>', ''));
    await page.evaluate(value => { window.__store = value; window.__messages = []; }, store);
    await page.evaluate(() => {
      window.chrome = {
        storage: {
          local: {
            get: async key => ({ [key]: window.__store[key] }),
            set: async values => Object.assign(window.__store, values),
            remove: async key => { delete window.__store[key]; }
          }
        },
        runtime: {
          sendMessage: async message => {
            window.__messages.push(message);
            if (message.type === 'DETAIL_JOB_STATUS') return { ok: true, supported: true };
            if (message.type === 'DETAIL_JOB_START') {
              window.__store.imagegrabDetailJob = { status: 'running', items: message.productIds.map(productId => ({ productId, status: 'pending', title: productId })) };
              return { ok: true };
            }
            return { ok: true };
          }
        }
      };
    });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/offer-data.js') });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/ranking-scope.js') });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/research.js') });
    await page.locator('.product-row').first().waitFor();

    await page.locator('#filter-ranking').selectOption('trend');
    await page.locator('#filter-category').selectOption('toys');

    assert.equal(await page.locator('.product-row').count(), 1);
    assert.match(await page.locator('.product-row').innerText(), /近期趋势玩具/);
    assert.match(await page.locator('#ranking-filter-summary').innerText(), /近期趋势 · 玩具 · 中国 · 1 件/);
    assert.equal(await page.locator('#detail-job-scope').inputValue(), 'filtered');
    await page.locator('#detail-job-start').click();
    await page.waitForFunction(() => window.__messages.some(message => message.type === 'DETAIL_JOB_START'));
    const started = await page.evaluate(() => window.__messages.find(message => message.type === 'DETAIL_JOB_START'));
    assert.deepEqual(Array.from(started.productIds), ['trend-toys']);

    await page.locator('[data-filter="manual"]').click();
    assert.equal(await page.locator('#ranking-filter-controls').isVisible(), false);
    assert.equal(await page.locator('.product-row').count(), 1);
    assert.match(await page.locator('.product-row').innerText(), /手动商品/);
  } finally {
    await browser.close();
  }
});

test('offer comparison inherits product source and scope filters and adds detail completeness filters', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const products = [
      { id: 'hot-home', title: '榜单日用品', sourceType: 'ranking', scope: { rankingKey: 'hot', rankingLabel: '人气热销', categoryKey: 'home', categoryName: '居家日用品', countryName: '中国' }, images: [] },
      { id: 'trend-toys', title: '趋势玩具', sourceType: 'ranking', scope: { rankingKey: 'trend', rankingLabel: '近期趋势', categoryKey: 'toys', categoryName: '玩具', countryName: '中国' }, images: [] },
      { id: 'similar', title: '同款候选', sourceType: 'similar', images: [] },
      { id: 'manual', title: '手动候选', sourceType: 'manual', images: [] }
    ];
    const offers = [
      { id: 'offer-hot', productId: 'hot-home', supplierName: '榜单工厂', detailCapturedAt: Date.now(), shipFrom: '浙江义乌', customerService: { url: 'https://amos.alicdn.com/getcid.aw?v=2&groupid=1&site=cnalichn&s=1&charset=utf-8' } },
      { id: 'offer-trend', productId: 'trend-toys', supplierName: '趋势工厂' },
      { id: 'offer-similar', productId: 'similar', supplierName: '同款工厂', detailCapturedAt: Date.now(), shipFrom: '广东广州' },
      { id: 'offer-manual', productId: 'manual', supplierName: '手动工厂', shipFrom: '江苏南通' }
    ];
    const store = { imagegrabResearchData: { products, offers, certificates: [], selectedId: 'hot-home' } };
    await page.setContent(fs.readFileSync(path.join(root, 'imagegrab-extension/research.html'), 'utf8').replace(/<link[^>]+>/, '').replace('<script src="research.js"></script>', ''));
    await page.evaluate(value => { window.__store = value; }, store);
    await page.evaluate(() => {
      window.chrome = { storage: { local: { get: async key => ({ [key]: window.__store[key] }), set: async values => Object.assign(window.__store, values), remove: async key => { delete window.__store[key]; } } }, runtime: { sendMessage: async () => ({ ok: true }) } };
    });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/offer-data.js') });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/ranking-scope.js') });
    await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/research.js') });
    await page.locator('.product-row').first().waitFor();

    await page.locator('[data-view="offers"]').click();
    assert.equal(await page.locator('#offer-filter-controls').isVisible(), true);
    assert.equal(await page.locator('#product-rows tr').count(), 4);

    await page.locator('[data-offer-filter="ranking"]').click();
    assert.equal(await page.locator('#product-rows tr').count(), 2);
    await page.locator('#offer-filter-ranking').selectOption('hot');
    assert.equal(await page.locator('#product-rows tr').count(), 1);
    assert.match(await page.locator('#product-rows').innerText(), /榜单工厂/);

    await page.locator('#offer-filter-detail').selectOption('complete');
    await page.locator('#offer-filter-customer').selectOption('known');
    assert.equal(await page.locator('#product-rows tr').count(), 1);
    await page.locator('#offer-filter-customer').selectOption('missing');
    assert.equal(await page.locator('#product-rows tr').count(), 0);
  } finally {
    await browser.close();
  }
});
