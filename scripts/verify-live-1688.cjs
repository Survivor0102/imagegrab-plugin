const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const extensionPath = path.join(root, 'imagegrab-extension');
const runtimeRoot = path.join(root, 'runtime');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profilePath = fs.mkdtempSync(path.join(runtimeRoot, 'live-1688-'));
const captureSource = fs.readFileSync(path.join(extensionPath, 'research-capture.js'), 'utf8');

async function main() {
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: chromePath,
    headless: true,
    viewport: { width: 1440, height: 1000 }
  });
  try {
    const page = await context.newPage();
    const bootstrap = `(() => {
      const KEY = '__imagegrab_live_test_store__';
      const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
      const save = value => localStorage.setItem(KEY, JSON.stringify(value));
      window.__store = load();
      window.chrome = window.chrome || {};
      window.chrome.storage = { local: {
        get: async key => ({ [key]: load()[key] }),
        set: async values => { const next = { ...load(), ...values }; save(next); window.__store = next; },
        remove: async key => { const next = load(); delete next[key]; save(next); window.__store = next; }
      }};
      window.chrome.runtime = { sendMessage(message, callback) {
        const data = load();
        if (message.type === 'FINISH_RESEARCH_AUTO') {
          const job = data.imagegrabResearchAutoJob || {};
          data.imagegrabResearchCapture = { products: (job.products || []).slice(0, 1000), capturedAt: Date.now(), sourceUrl: job.sourceUrl || '', pageTitle: job.pageTitle || '', pageCount: job.pageCount || 0, finishReason: job.finishReason || '已结束' };
          save(data); window.__store = data;
        }
        callback?.({ ok: true });
      }};
    })();\n${captureSource}`;
    await context.addInitScript({ content: bootstrap });
    await page.goto('https://s.1688.com/selloffer/offer_search.htm?keywords=%E9%9D%A2%E9%9C%9C', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);
    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      url: `${location.origin}${location.pathname}`,
      loginRedirect: /(^|\.)login\.(taobao|1688)\.com$/i.test(location.hostname),
      hasChallenge: /安全验证|滑动验证|访问异常|请完成验证|captcha|security check/i.test(`${document.title} ${document.body.innerText.slice(0, 4000)}`),
      offerLinks: [...document.querySelectorAll('a[href]')].filter(a => /(?:detail\.1688\.com\/offer\/|offer\.1688\.com\/offer\/)/i.test(a.href)).length,
      hasAutoButton: Boolean(document.querySelector('#imagegrab-research-auto-button')),
      paginationText: [...document.querySelectorAll('[class*="pagination" i],[class*="pager" i],nav[aria-label*="页"]')].map(el => el.innerText.trim()).filter(Boolean).slice(0, 3)
    }));
    if (pageInfo.loginRedirect) {
      console.log(JSON.stringify({ status: 'login-required', note: '未登录隔离 Profile 被重定向到登录页；没有尝试登录或继续访问。', page: pageInfo }, null, 2));
      return;
    }
    if (!pageInfo.hasAutoButton) throw new Error(`Extension control not injected: ${JSON.stringify(pageInfo)}`);
    if (pageInfo.hasChallenge) throw new Error(`1688 presented a login/security challenge; stopped without interacting: ${JSON.stringify(pageInfo)}`);
    await page.locator('#imagegrab-research-auto-button').click();
    const deadline = Date.now() + 35000;
    let job;
    while (Date.now() < deadline) {
      job = await page.evaluate(() => window.__store.imagegrabResearchAutoJob || null);
      if (job?.pageCount >= 2 || !job?.running) break;
      await page.waitForTimeout(500);
    }
    if (job?.running) {
      await page.locator('#imagegrab-research-stop-button').click();
      const stopDeadline = Date.now() + 5000;
      while (Date.now() < stopDeadline) {
        job = await page.evaluate(() => window.__store.imagegrabResearchAutoJob || null);
        if (!job?.running) break;
        await page.waitForTimeout(200);
      }
    }
    const result = await page.evaluate(() => ({ job: window.__store.imagegrabResearchAutoJob, capture: window.__store.imagegrabResearchCapture }));
    const report = { mode: 'live 1688 DOM with isolated browser and mocked extension storage/message channel', page: pageInfo, result: { pages: result.job?.pageCount || 0, uniqueProducts: result.job?.products?.length || 0, finishReason: result.job?.finishReason || '采集仍在进行或未生成完成状态', persistedCapture: Boolean(result.capture?.products?.length) } };
    console.log(JSON.stringify(report, null, 2));
    if (!result.job) throw new Error('Live run did not persist a job record');
  } finally {
    await context.close();
  }
}

main()
  .catch(error => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    const resolvedRoot = path.resolve(runtimeRoot) + path.sep;
    const resolvedProfile = path.resolve(profilePath);
    if (!resolvedProfile.startsWith(resolvedRoot)) throw new Error('Refusing to remove a profile outside the project runtime directory');
    fs.rmSync(resolvedProfile, { recursive: true, force: true });
  });
