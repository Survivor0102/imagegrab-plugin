const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const source = path.resolve(__dirname, '../../imagegrab-extension/detail-capture.js');

test('customer service comes from the current seller context without executing page scripts', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto('https://detail.1688.com/offer/123.html');
    const context = (id = 123, loginId = '禾锦文化用品厂') => ({ result: {
      hierarchy: { root: 'Root' },
      data: { Root: { fields: { dataJson: { offerBaseInfo: { offerId: id, sellerLoginId: '后端供货厂' }, frontSellerMemberModel: { frontOfferId: id, frontSellerLoginId: loginId, frontSellerMemberId: 'b2b-front-seller' } } } } },
      global: { globalData: { model: { sellerModel: { loginId: '后端供货厂', memberId: 'b2b-backend' }, offerDetail: { offerId: id } } } }
    } });
    async function capture(value, extra = '') {
      await page.setContent('<div id="productTitle"><div class="title-content"><h1>当前商品</h1></div></div>' + extra);
      await page.evaluate(value => {
        if (value !== null) {
          const s = document.createElement('script');
          s.type = 'application/x-fixture';
          s.textContent = typeof value === 'string' ? value : 'window.context=(function(b,d){return d})(window.contextPath,' + JSON.stringify(value) + ');';
          document.body.appendChild(s);
        }
      }, value);
      await page.addScriptTag({ path: source });
      return page.evaluate(() => ImageGrabDetail.collect());
    }
    await t.test('uses the front seller targeted by the actual customer button', async () => {
      const row = await capture(context());
      assert.equal(row.customerService.loginId, '禾锦文化用品厂');
      assert.equal(row.customerService.memberId, 'b2b-front-seller');
      assert.equal(row.customerService.sourceUrl, row.url);
      const url = new URL(row.customerService.url);
      assert.equal(url.hostname, 'air.1688.com');
      assert.equal(url.searchParams.get('touid'), 'cnalichn禾锦文化用品厂');
      assert.equal(url.searchParams.get('siteid'), 'cnalichn');
      assert.equal(url.searchParams.get('offerId'), '123');
      assert.equal(await page.evaluate(() => typeof window.context), 'undefined');
    });
    await t.test('different shops have different receivers, and URL encoding round trips', async () => {
      const first = await capture(context());
      const second = await capture(context(123, '另一工厂 & A/+?#'));
      assert.notEqual(first.customerService.url, second.customerService.url);
      assert.equal(new URL(second.customerService.url).searchParams.get('touid'), 'cnalichn另一工厂 & A/+?#');
    });
    await t.test('uses sellerModel when the root data has no front seller', async () => {
      const data = context(); delete data.result.data.Root.fields.dataJson.frontSellerMemberModel;
      delete data.result.data.Root.fields.dataJson.offerBaseInfo.sellerLoginId;
      assert.equal((await capture(data)).customerService.loginId, '后端供货厂');
    });
    await t.test('rejects stale context belonging to a different offer', async () => {
      assert.equal((await capture(context(456))).customerService.status, 'not-found');
      const data = context(); data.result.data.Root.fields.dataJson.frontSellerMemberModel.frontOfferId = 456;
      assert.equal((await capture(data)).customerService.url, '');
    });
    await t.test('real JavaScript numeric keys elsewhere do not invalidate seller JSON fragments', async () => {
      const raw = 'window.context=(function(b,d){return d})(window.contextPath,' + JSON.stringify(context()).replace('"offerBaseInfo":', '"skuWeight":{5747735697348:0.0200},"offerBaseInfo":') + ');';
      const row = await capture(raw);
      assert.equal(row.customerService.loginId, '禾锦文化用品厂');
      const withDecoy = context();
      withDecoy.result.description = JSON.stringify({ frontSellerMemberModel: { frontSellerLoginId: '错误客服', frontOfferId: 123 } });
      assert.equal((await capture(withDecoy)).customerService.loginId, '禾锦文化用品厂');
    });
    await t.test('missing or malformed context does not infer a seller from recommendations', async () => {
      const row = await capture(null, '<aside><a href="https://shop-other.1688.com/">推荐店铺客服</a></aside>');
      assert.equal(row.customerService.status, 'not-found');
      assert.equal(row.customerService.url, '');
      assert.equal(row.title, '当前商品');
      assert.equal((await capture('window.context=(function(b,d){return d})(window.contextPath,{broken});')).customerService.url, '');
    });
  } finally { await browser.close(); }
});
