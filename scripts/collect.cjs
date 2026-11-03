// Standalone runner added after the historical run. Does not modify ImageGrab 1.0.0.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { validateConfig, usable, checkPng, parseDownloadPath } = require('./runner-utils.cjs');
const repoRoot = path.resolve(__dirname, '..');

async function guardPage(page) {
  if (/login\.|passport\.|punish|verify/i.test(new URL(page.url()).hostname + new URL(page.url()).pathname)) {
    throw new Error('Login or verification page: complete it manually, then rerun');
  }
  const body = await page.locator('body').innerText();
  if (/请完成.{0,8}验证|拖动.{0,8}滑块|访问过于频繁|异常流量|安全验证|扫码登录|密码登录/.test(body)) {
    throw new Error('Page requests login/verification or reports traffic restriction; stopped');
  }
}

async function inspect(context, config) {
  const versionPage = await context.newPage();
  try {
    await versionPage.goto('chrome://version/', { timeout: config.pageTimeoutMs });
    return await versionPage.evaluate(() => {
      const value = id => document.getElementById(id)?.textContent?.trim() || null;
      return { browser: value('version'), profile: value('profile_path'), executable: value('executable_path') };
    });
  } finally { await versionPage.close(); }
}

async function listDownloads(page) {
  return page.evaluate(() => [...document.querySelector('downloads-manager')?.shadowRoot
    ?.querySelectorAll('downloads-item') || []].map(item => {
    const shadow = item.shadowRoot;
    const icon = shadow?.querySelector('#fileIcon');
    const link = shadow?.querySelector('#fileLink');
    return { path: icon?.src || '', title: link?.getAttribute('title') || '',
      text: shadow?.innerText || '' };
  }));
}

async function loadAllDownloads(page) {
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const root = document.querySelector('downloads-manager')?.shadowRoot;
      const list = root?.querySelector('#mainContainer');
      if (list) list.scrollTop = list.scrollHeight;
    });
    await page.waitForTimeout(150);
  }
  return listDownloads(page);
}

async function runBatch(context, page, batch, config, runDir, report, progress) {
  const source = `https://s.taobao.com/search?page=${batch.page}&q=${encodeURIComponent(batch.keyword)}`;
  await page.goto(source, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
  await page.waitForTimeout(config.navigationDelayMs);
  await guardPage(page);
  const button = page.locator('#imagegrab-floating-button');
  if (!await button.count()) throw new Error('ImageGrab button missing: load the extension into this browser and retry');
  const created = context.waitForEvent('page', { timeout: config.pageTimeoutMs });
  await button.click();
  const gallery = await created;
  try {
    await gallery.waitForURL('chrome-extension://*/gallery.html', { timeout: config.pageTimeoutMs });
    await gallery.locator('img.preview').first().waitFor({ state: 'attached', timeout: config.pageTimeoutMs });
    // Wait for all preview cards to be created, then progressively reveal lazy images.
    await gallery.waitForTimeout(1500);
    for (let i = 0; i < 80; i++) {
      await gallery.evaluate(() => window.scrollBy(0, Math.max(innerHeight * 0.85, 600)));
      await gallery.waitForTimeout(160);
    }
    await gallery.waitForTimeout(1800);
    const metas = await gallery.locator('img.preview').evaluateAll(es => es.map((e, index) => ({
      index, complete: e.complete, width: e.naturalWidth, height: e.naturalHeight, url: e.currentSrc || e.src
    })));
    const selected = metas.filter(usable).slice(0, batch.count);
    const result = { ...batch, candidates: metas.length, usable: metas.filter(usable).length, saved: 0 };
    report.batches.push(result);
    await progress();
    if (!selected.length) throw new Error(`No usable candidates for ${batch.keyword}`);
    for (const image of selected) await gallery.locator('.image-check').nth(image.index).check();

    const downloadsPage = await context.newPage();
    await downloadsPage.goto('chrome://downloads/', { timeout: config.pageTimeoutMs });
    const baseline = new Set((await loadAllDownloads(downloadsPage)).map(x => parseDownloadPath(x.path)).filter(Boolean));
    result.startNumber = report.files.filter(x => x.keyword === batch.keyword).length + 1;
    try {
      await gallery.getByRole('button', { name: '下载选中', exact: true }).click();
      await gallery.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('处理完成'),
        null, { timeout: config.downloadTimeoutMs });
      result.pluginStatus = await gallery.locator('#status').innerText();
      let fresh = [];
      for (let i = 0; i < config.downloadTimeoutMs / 1000; i++) {
        const items = await loadAllDownloads(downloadsPage);
        fresh = items.filter(x => {
          const filePath = parseDownloadPath(x.path);
          return filePath && !baseline.has(filePath);
        });
        const pending = fresh.some(x => /正在下载|正在打开|Starting|In progress/i.test(x.text));
        if (fresh.length >= selected.length && !pending) break;
        await downloadsPage.waitForTimeout(1000);
      }
      if (fresh.length !== selected.length) {
        throw new Error(`Browser download history shows ${fresh.length}/${selected.length} new files`);
      }
      fresh.reverse();
      for (let i = 0; i < fresh.length; i++) {
        const sourcePath = parseDownloadPath(fresh[i].path);
        const relative = `${batch.keyword}/${batch.keyword}_${String(result.startNumber + i).padStart(3, '0')}.png`;
        const file = path.join(runDir, relative);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.copyFile(sourcePath, file);
        const checks = checkPng(await fs.readFile(file));
        const candidate = selected[i];
        report.files.push({ keyword: batch.keyword, searchPage: batch.page, sourcePage: source,
          imageUrl: candidate.url, galleryIndex: candidate.index + 1, file: relative, ...checks });
        result.saved++;
        await progress();
      }
    } finally { await downloadsPage.close(); }
    if (result.saved !== batch.count) throw new Error(`Saved ${result.saved}/${batch.count} verified PNG files`);
    await progress();
    console.log(JSON.stringify(result));
  } finally { await gallery.close().catch(() => {}); }
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--check', '--smoke']);
  if (args.some(x => !known.has(x))) throw new Error('Usage: node scripts/collect.cjs [--check | --smoke]');
  const config = validateConfig(JSON.parse(await fs.readFile(path.join(repoRoot, 'collection.config.json'), 'utf8')));
  const browser = await chromium.connectOverCDP(config.endpoint, { timeout: config.pageTimeoutMs });
  const contexts = browser.contexts();
  if (contexts.length !== 1) throw new Error('Expected one unambiguous browser profile/context');
  const context = contexts[0];
  const environment = await inspect(context, config);
  console.log(JSON.stringify({ environment, playwright: require('playwright/package.json').version,
    node: process.version, mode: args.includes('--check') ? 'check' : args.includes('--smoke') ? 'smoke' : 'full' }));
  const page = await context.newPage();
  let runDir, report;
  let writeChain = Promise.resolve();
  const progress = () => {
    const data = JSON.stringify(report, null, 2) + '\n';
    writeChain = writeChain.then(() => fs.writeFile(path.join(runDir, 'run.json'), data));
    return writeChain;
  };
  try {
    if (args.includes('--check')) {
      await page.goto('https://www.taobao.com/', { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
      await page.waitForTimeout(config.navigationDelayMs);
      await guardPage(page);
      if (!await page.locator('#imagegrab-floating-button').count()) {
        throw new Error('ImageGrab content script not present. Load imagegrab-extension/ in chrome://extensions and reload Taobao.');
      }
      console.log('CHECK PASS: page readable and extension button present. Does not prove download success or authenticated account.');
      return;
    }
    const batches = args.includes('--smoke') ? [{ keyword: '运动鞋', page: 1, count: 3 }] : config.batches;
    await fs.mkdir(config.outputDirectory, { recursive: true });
    runDir = path.join(config.outputDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
    await fs.mkdir(runDir); // Never reuse or overwrite a previous collection.
    report = { startedAt: new Date().toISOString(), mode: args.includes('--smoke') ? 'smoke' : 'full',
      environment, extensionVersion: '1.0.0', node: process.version,
      playwright: require('playwright/package.json').version, requested: batches.reduce((s, x) => s + x.count, 0),
      state: 'running', batches: [], files: [] };
    await progress();
    for (const batch of batches) await runBatch(context, page, batch, config, runDir, report, progress);
    report.state = 'passed';
    report.finishedAt = new Date().toISOString();
    await progress();
    console.log(JSON.stringify({ state: report.state, verifiedFiles: report.files.length, output: runDir }));
  } catch (error) {
    if (report) { report.state = 'failed'; report.error = error.message; await progress(); }
    throw error;
  } finally {
    await page.close().catch(() => {});
    // Deliberately do not call browser.close()/context.close() on the shared browser.
  }
}

if (require.main === module) {
  main().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
}
module.exports = { runBatch, guardPage };
