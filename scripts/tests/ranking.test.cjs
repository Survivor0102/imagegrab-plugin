const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const backgroundSource = fs.readFileSync(path.join(root, 'imagegrab-extension/background.js'), 'utf8');
const rankingUrl = 'https://air.1688.com/kapp/1688-global/sales/ranking?fixture=1';

async function fixture() {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  await page.route('https://**/*', route => route.fulfill({ body: '<!doctype html><html><body></body></html>' }));
  await page.goto(rankingUrl);
  await page.setContent('<div class="cgf-sale-list-container" style="height:180px;overflow-y:auto"></div>');
  await page.evaluate(() => {
    window.__store = {};
    window.__messages = [];
    window.__scriptCalls = [];
    window.__opened = [];
    window.chrome = {
      runtime: {
        onMessage: { addListener: fn => { window.__backgroundListener = fn; } },
        onInstalled: { addListener() {} }, getURL: name => `chrome-extension://fixture/${name}`,
        sendMessage(message, callback) {
          window.__messages.push(message);
          window.__backgroundListener(message, { tab: { id: 7, url: location.href }, url: location.href, frameId: 0 }, callback || (() => {}));
        }
      },
      storage: { local: {
        get: async key => ({ [key]: window.__store[key] }),
        set: async values => Object.assign(window.__store, structuredClone(values))
      } },
      scripting: { executeScript: async options => {
        window.__scriptCalls.push({ world: options.world, target: options.target });
        return [{ result: options.func() }];
      } },
      tabs: { create: async value => { window.__opened.push(value); return { id: 9 }; } },
      action: { onClicked: { addListener() {} } }
    };
    window.__addCard = (id, sales = '1.2M', title = `测试商品 ${id}`) => {
      const card = document.createElement('div');
      card.className = 'cgf-product-card';
      card.style.height = '200px';
      card.innerHTML = `<div class="cgf-card-title">${title}</div><div class="cgf-card-price">¥<br>0<br>.<br>01</div><div class="card-meta-item"><span class="card-meta-value">${sales}</span><span class="card-meta-label">月销量</span></div><img src="https://img.fixture.test/${id}.jpg">`;
      card.__reactFiber$fixture = { return: { memoizedProps: { data: { id, title, image: `https://img.fixture.test/${id}-original.jpg`, price: { formatPrice: '¥0.01' } } } } };
      document.querySelector('.cgf-sale-list-container').appendChild(card);
    };
    window.__addCard('678400004650');
  });
  await page.addScriptTag({ content: backgroundSource });
  await page.addScriptTag({ path: path.join(root, 'imagegrab-extension/research-capture.js') });
  return { page, browser };
}

test('ranking capture uses the real background collector for anchorless React cards and preserves visible metrics', { timeout: 30000 }, async () => {
  const { browser, page } = await fixture();
  try {
    await page.evaluate(() => window.__addCard('javascript:bad'));
    await page.locator('#imagegrab-research-button').click();
    await page.waitForFunction(() => window.__store.imagegrabResearchCapture);
    const result = await page.evaluate(() => ({ capture: window.__store.imagegrabResearchCapture, calls: window.__scriptCalls, opened: window.__opened }));
    assert.equal(result.capture.products.length, 1);
    const row = result.capture.products[0];
    assert.equal(row.url, 'https://detail.1688.com/offer/678400004650.html');
    assert.equal(row.priceText, '¥0.01');
    assert.equal(row.salesText, '1.2M 月销量');
    assert.equal(row.rank, '');
    assert.equal(row.supplierName, '');
    assert.equal(row.images[0], 'https://img.fixture.test/678400004650-original.jpg');
    assert.deepEqual(result.calls, [{ world: 'MAIN', target: { tabId: 7, frameIds: [0] } }]);
    assert.equal(result.opened.length, 1);
  } finally { await browser.close(); }
});

test('ranking auto capture scrolls its nested list, deduplicates accumulated cards and stops when loading stalls', { timeout: 30000 }, async () => {
  const { browser, page } = await fixture();
  try {
    await page.evaluate(() => {
      let batch = 1;
      document.querySelector('.cgf-sale-list-container').addEventListener('scroll', () => {
        if (batch < 3) { batch++; window.__addCard(String(678400004650 + batch)); }
      });
    });
    await page.locator('#imagegrab-research-auto-button').click();
    await page.waitForFunction(() => window.__store.imagegrabResearchAutoJob?.running === false, null, { timeout: 20000 });
    const job = await page.evaluate(() => window.__store.imagegrabResearchAutoJob);
    assert.equal(job.products.length, 3);
    assert.equal(job.pageCount, 3);
    assert.equal(job.finishReason, '列表滚动后未检测到新增商品（已停止）');
    assert.equal(new Set(job.products.map(row => row.url)).size, 3);
    assert.ok(await page.locator('.cgf-sale-list-container').evaluate(el => el.scrollTop > 0));
  } finally { await browser.close(); }
});

test('a different tab cannot resume another tab\'s auto job and a stopped job remains stopped', { timeout: 30000 }, async () => {
  const { browser, page } = await fixture();
  try {
    await page.evaluate(() => {
      document.querySelector('#imagegrab-research-controls').remove();
      window.__store.imagegrabResearchAutoJob = { running: true, ownerTabToken: 'different-tab', products: [], processedPages: [] };
    });
    // The mutation observer reinstalls controls but must not start the other tab's job.
    await page.locator('#imagegrab-research-auto-button').waitFor();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__scriptCalls.length), 0);
    await page.evaluate(() => { window.__store.imagegrabResearchAutoJob.running = false; });
    // A separate fixture verifies the real stop handler while waiting for new cards.
  } finally { await browser.close(); }
  const second = await fixture();
  try {
    await second.page.locator('#imagegrab-research-auto-button').click();
    await second.page.waitForFunction(() => window.__store.imagegrabResearchAutoJob?.products.length === 1);
    await second.page.locator('#imagegrab-research-stop-button').click();
    await second.page.waitForFunction(() => window.__store.imagegrabResearchAutoJob?.running === false);
    const job = await second.page.evaluate(() => window.__store.imagegrabResearchAutoJob);
    assert.equal(job.finishReason, '用户停止');
    assert.equal(job.products.length, 1);
  } finally { await second.browser.close(); }
});

test('background rejects ranking reads from unrelated URLs and child frames', () => {
  let listener;
  const context = { chrome: {
    runtime: { onMessage: { addListener: fn => { listener = fn; } }, onInstalled: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    scripting: { executeScript() { throw Error('Must not execute'); } }
  } };
  vm.runInNewContext(backgroundSource, context);
  for (const sender of [
    { tab: { id: 7 }, url: 'https://unrelated.test/', frameId: 0 },
    { tab: { id: 7 }, url: `${rankingUrl}`, frameId: 2 }
  ]) {
    let result;
    assert.equal(listener({ type: 'READ_RANKING_CARDS' }, sender, value => { result = value; }), false);
    assert.equal(result.ok, false);
  }
});
