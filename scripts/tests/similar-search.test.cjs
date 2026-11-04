const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const extensionSearch = path.join(root, 'imagegrab-extension', 'similar-search.js');
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function makePage(browser, html) {
  const page = await browser.newPage();
  await page.setContent(html);
  const isolated = vm.createContext({});
  vm.runInContext(fs.readFileSync(extensionSearch, 'utf8'), isolated);
  // executeScript transfers only this function; worker helpers are unavailable.
  await page.addScriptTag({ content: `window.fill1688Search = ${isolated.fill1688Search.toString()};` });
  return page;
}

test('production search injector preserves Chinese and submits the rendered form', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await makePage(browser, `
      <style>#hidden { display:none }</style>
      <form id="search-form" action="/search" method="get">
        <input id="hidden" name="wrong" value="错误候选">
        <input id="q" name="keywords" placeholder="搜索商品">
        <button type="submit">搜索</button>
      </form>
    `);
    await page.evaluate(() => {
      window.__submitted = '';
      document.querySelector('#search-form').addEventListener('submit', event => {
        event.preventDefault();
        window.__submitted = document.querySelector('#q').value;
      });
    });
    const keyword = '腋下吸汗贴出汗贴夏季腋窝吸汗垫腋毛防汗贴超薄隐形出汗止汗神器';
    const result = await page.evaluate(value => fill1688Search(value), keyword);
    assert.deepEqual(result, { ok: true, keyword, submitted: true });
    assert.equal(await page.locator('#q').inputValue(), keyword);
    assert.equal(await page.evaluate(() => window.__submitted), keyword);
  } finally {
    await browser.close();
  }
});

test('production search injector uses the 1688 div search control and dispatches input', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await makePage(browser, `<input placeholder="邮箱"><div class="ali-search-box">
      <div class="input-button"><span>搜 索</span></div>
      <div class="ali-search-keywords"><input id="alisearch-input" name="keywords"></div></div>`);
    await page.evaluate(() => {
      window.events = [];
      document.querySelector('#alisearch-input').addEventListener('input', event => window.events.push(event.target.value));
      document.querySelector('.input-button').onclick = () => window.submitted = document.querySelector('#alisearch-input').value;
    });
    const keyword = '木珠6-50mm 原木 DIY & 配件';
    assert.equal((await page.evaluate(value => fill1688Search(value), keyword)).ok, true);
    assert.equal(await page.evaluate(() => window.submitted), keyword);
    assert.deepEqual(await page.evaluate(() => window.events), [keyword]);
    assert.equal(await page.locator('input[placeholder="邮箱"]').inputValue(), '');
    await page.setContent('<input name="keywords"><button>了解搜索</button>');
    assert.equal((await page.evaluate(() => fill1688Search('木珠'))).ok, false);
    assert.equal((await page.evaluate(() => fill1688Search('   '))).ok, false);
  } finally { await browser.close(); }
});

test('production search injector rejects a page without a usable search control', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await makePage(browser, '<input disabled value="不可用"><input type="hidden" value="也不可用">');
    const result = await page.evaluate(() => fill1688Search('珠链'));
    assert.equal(result.ok, false);
    assert.match(result.error, /没有找到/);
  } finally {
    await browser.close();
  }
});
