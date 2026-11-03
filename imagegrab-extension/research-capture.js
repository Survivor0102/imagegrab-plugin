(() => {
  'use strict';
  const BUTTON_ID = 'imagegrab-research-button';
  const AUTO_BUTTON_ID = 'imagegrab-research-auto-button';
  const STOP_BUTTON_ID = 'imagegrab-research-stop-button';
  const AUTO_KEY = 'imagegrabResearchAutoJob';
  const AUTO_LIMIT = 1000;
  const TAB_TOKEN_KEY = 'imagegrabResearchTabToken';
  const tabToken = sessionStorage.getItem(TAB_TOKEN_KEY) || crypto.randomUUID();
  sessionStorage.setItem(TAB_TOKEN_KEY, tabToken);
  const OFFER_URL = /(?:detail\.1688\.com\/offer\/|offer\.1688\.com\/offer\/|1688\.com\/offer\/)/i;
  const RANKING_URL = /air\.1688\.com\/kapp\/1688-global\/sales\/ranking/i;
  const PRICE = /(?:¥|￥)\s*[\d,.]+(?:\s*[-~至]\s*(?:¥|￥)?\s*[\d,.]+)?/;
  const SALES = /(?:成交\s*[\d,.]+\s*(?:笔|件)?|\d[\d,.]*(?:万|千|K|M)?\+?\s*(?:人付款|人已付款|笔成交|件成交|件已售|人收货|月销量))/i;
  const MOQ = /(?:起批|起订|\d+\s*(?:件|个|套|箱)起批)/;
  const RANK = /(?:第\s*(\d{1,4})\s*名|(?:^|\s)#\s*(\d{1,4})|TOP\s*(\d{1,4}))/i;

  function text(node) { return (node?.innerText || '').replace(/\s+/g, ' ').trim(); }
  function imageUrls(node) {
    return [...node.querySelectorAll('img')].map(img => img.currentSrc || img.src || img.dataset.src || img.dataset.original)
      .filter(src => src && /^https?:/i.test(src) && !/(icon|logo|avatar|sprite|loading|placeholder)/i.test(src))
      .filter((src, i, all) => all.indexOf(src) === i).slice(0, 8);
  }
  function supplierFrom(node) {
    const link = [...node.querySelectorAll('a[href]')].find(a => /(?:shop|company|dianpu|wangpu).*1688\.com|\.1688\.com\/page\//i.test(a.href));
    return { name: text(link), url: link?.href || '' };
  }

  function rankingPage() { return RANKING_URL.test(location.href); }

  function collectRankingCards() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'READ_RANKING_CARDS' }, result => {
        const error = chrome.runtime.lastError;
        if (error) { reject(new Error(error.message)); return; }
        if (!result?.ok) { reject(new Error(result?.error || '榜单卡片读取失败')); return; }
        resolve(Array.isArray(result.products) ? result.products : []);
      });
    });
  }
  function parseCard(anchor) {
    let card = anchor;
    for (let i = 0; card.parentElement && i < 6; i++) {
      if (imageUrls(card).length && text(card).length > text(anchor).length) {
        const candidate = card;
        if (candidate.querySelectorAll('a[href*="/offer/"]').length > 0) break;
      }
      if (card.parentElement.querySelectorAll('a[href*="/offer/"]').length > 1) break;
      card = card.parentElement;
    }
    const body = text(card);
    const lines = (card.innerText || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
    const title = anchor.getAttribute('title') || anchor.getAttribute('aria-label') || lines.find(line => line.length > 8 && !PRICE.test(line) && !SALES.test(line) && !MOQ.test(line)) || text(anchor);
    const priceText = body.match(PRICE)?.[0] || '';
    const salesText = body.match(SALES)?.[0] || '';
    const moqText = body.match(MOQ)?.[0] || '';
    const supplier = supplierFrom(card);
    const rankMatch = body.match(RANK);
    return { title: title.slice(0, 180), url: anchor.href, images: imageUrls(card), priceText, salesText, moqText, rank: rankMatch?.[1] || rankMatch?.[2] || rankMatch?.[3] || '', supplierName: supplier.name, supplierUrl: supplier.url, visibleText: body.slice(0, 900) };
  }
  async function collect() {
    if (rankingPage()) return collectRankingCards();
    const detail = location.pathname.includes('/offer/') && OFFER_URL.test(location.href);
    const links = [...document.querySelectorAll('a[href]')].filter(a => OFFER_URL.test(a.href));
    const rows = new Map();
    for (const anchor of links) {
      const row = parseCard(anchor);
      if (!row.images.length && !row.title) continue;
      if (!rows.has(row.url)) rows.set(row.url, row);
    }
    if (detail && !rows.has(location.href)) {
      const h1 = document.querySelector('h1');
      const body = text(document.body);
      rows.set(location.href, { title: text(h1) || document.title, url: location.href, images: imageUrls(document), priceText: body.match(PRICE)?.[0] || '', salesText: body.match(SALES)?.[0] || '', moqText: body.match(MOQ)?.[0] || '', ...supplierFrom(document), visibleText: body.slice(0, 4000) });
    }
    return [...rows.values()].slice(0, 100);
  }
  function pageSignature() {
    const urls = [...document.querySelectorAll('a[href]')].filter(a => OFFER_URL.test(a.href)).map(a => a.href);
    const rankingTitles = rankingPage() ? [...document.querySelectorAll('.cgf-card-title')].map(node => text(node)) : [];
    return `${location.href}|${urls.slice(0, 3).join(',')}|${urls.slice(-3).join(',')}|${rankingTitles.slice(0, 3).join(',')}|${rankingTitles.slice(-3).join(',')}`;
  }
  function scrollRankingList() {
    let container = document.querySelector('.cgf-product-card')?.parentElement;
    while (container && container !== document.body && container !== document.documentElement) {
      if (container.scrollHeight > container.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(container).overflowY)) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
        return;
      }
      container = container.parentElement;
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  }
  function visible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  }
  function disabled(element) {
    return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true' || /disabled|disable|不可用/i.test(element.className?.baseVal || element.className || '');
  }
  function findNextPage() {
    const containers = [...document.querySelectorAll('[class*="pagination" i], [class*="pager" i], [class*="Pagination"], [class*="Pager"], nav[aria-label*="页"]')];
    const controls = [...document.querySelectorAll('a[href],button,[role="button"]')].filter(el => visible(el) && !disabled(el));
    const explicit = controls.find(el => /下一页|下页|后页|next\s*page|^next$/i.test(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${text(el)}`));
    if (explicit) return explicit;
    for (const container of containers) {
      const candidates = [...container.querySelectorAll('a[href],button,[role="button"]')].filter(el => visible(el) && !disabled(el));
      const current = container.querySelector('[aria-current="page"],.active,.current,[class*="current" i],[class*="active" i]');
      const currentNumber = Number(text(current));
      if (!current || !Number.isFinite(currentNumber)) continue;
      const nextNumber = candidates.find(el => text(el) === String(currentNumber + 1));
      if (nextNumber) return nextNumber;
      const glyph = candidates.find(el => /^(?:>|»|›|→)$/.test(text(el)));
      if (glyph) return glyph;
    }
    return null;
  }
  function challengeVisible() {
    const textBody = `${document.title} ${text(document.body)}`.slice(0, 6000);
    return /安全验证|滑动验证|访问异常|请完成验证|验证码|captcha|security check|verify you are human/i.test(textBody);
  }
  async function readJob() { return (await chrome.storage.local.get(AUTO_KEY))[AUTO_KEY] || null; }
  async function saveJob(job) { await chrome.storage.local.set({ [AUTO_KEY]: job }); }
  function updateButtons(job) {
    const autoButton = document.getElementById(AUTO_BUTTON_ID);
    const stopButton = document.getElementById(STOP_BUTTON_ID);
    if (!autoButton || !stopButton) return;
    const running = job?.running && job.ownerTabToken === tabToken;
    autoButton.textContent = running ? `采集中 ${job.products?.length || 0}/${AUTO_LIMIT}` : '自动采集榜单';
    autoButton.disabled = Boolean(job?.running);
    stopButton.hidden = !running;
  }
  function waitForPageChange(previous, timeoutMs = 20000) {
    return new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(async () => {
        const job = await readJob();
        if (!job?.running || job.ownerTabToken !== tabToken || job.stopRequested) { clearInterval(timer); resolve('stopped'); return; }
        if (challengeVisible()) { clearInterval(timer); resolve('challenge'); return; }
        if (pageSignature() !== previous) { clearInterval(timer); resolve('changed'); return; }
        if (Date.now() - started >= timeoutMs) { clearInterval(timer); resolve('timeout'); }
      }, 500);
    });
  }
  async function finishAuto(job, reason) {
    job.running = false; job.stopRequested = false; job.finishedAt = Date.now(); job.finishReason = reason;
    await saveJob(job); updateButtons(job);
    chrome.runtime.sendMessage({ type: 'FINISH_RESEARCH_AUTO' }, () => {});
  }
  let autoRunnerActive = false;
  async function runAutoCapture() {
    if (autoRunnerActive) return;
    autoRunnerActive = true;
    try {
      while (true) {
        const job = await readJob();
        if (!job?.running || job.ownerTabToken !== tabToken) { updateButtons(job); return; }
        if (job.stopRequested) { await finishAuto(job, '用户停止'); return; }
        if (challengeVisible()) { await finishAuto(job, '页面要求登录或安全验证'); return; }
        if (job.products.length >= AUTO_LIMIT) { await finishAuto(job, `达到 ${AUTO_LIMIT} 条上限`); return; }
        const signature = pageSignature();
        if (job.processedPages.includes(signature)) { await finishAuto(job, '检测到重复页面，已停止'); return; }
        const rows = await collect();
        if (!rows.length) { await finishAuto(job, '当前页面未读取到受支持的商品卡片'); return; }
        const latest = await readJob();
        if (!latest?.running || latest.ownerTabToken !== tabToken) return;
        if (latest.stopRequested) { await finishAuto(latest, '用户停止'); return; }
        const products = new Map(job.products.map(item => [item.url, item]));
        for (const row of rows) {
          if (!row.url || !/^https?:/i.test(row.url)) continue;
          if (products.has(row.url)) {
            const existing = products.get(row.url);
            existing.images = [...new Set([...(existing.images || []), ...row.images])].slice(0, 8);
            for (const key of ['title', 'priceText', 'salesText', 'moqText', 'rank', 'supplierName', 'supplierUrl', 'visibleText']) if (!existing[key] && row[key]) existing[key] = row[key];
          } else if (products.size < AUTO_LIMIT) products.set(row.url, row);
        }
        job.products = [...products.values()];
        job.processedPages.push(signature);
        job.pageCount = job.processedPages.length;
        job.updatedAt = Date.now();
        await saveJob(job); updateButtons(job);
        if (job.products.length >= AUTO_LIMIT) { await finishAuto(job, `达到 ${AUTO_LIMIT} 条上限`); return; }
        if (rankingPage()) {
          const previous = pageSignature();
          scrollRankingList();
          const result = await waitForPageChange(previous, 8000);
          if (result === 'changed') { await new Promise(resolve => window.setTimeout(resolve, 1200)); continue; }
          await finishAuto(await readJob(), result === 'stopped' ? '用户停止' : result === 'challenge' ? '页面要求登录或安全验证' : '列表滚动后未检测到新增商品（已停止）');
          return;
        }
        const next = findNextPage();
        if (!next) { await finishAuto(job, '未找到可用的下一页控件'); return; }
        const previous = pageSignature();
        next.click();
        const result = await waitForPageChange(previous);
        if (result === 'timeout') { await finishAuto(await readJob(), '点击下一页后页面未变化'); return; }
        if (result === 'stopped') { await finishAuto(await readJob(), '用户停止'); return; }
        if (result === 'challenge') { await finishAuto(await readJob(), '页面要求登录或安全验证'); return; }
        await new Promise(resolve => window.setTimeout(resolve, 1500));
      }
    } catch (error) {
      const job = await readJob();
      if (job?.running) await finishAuto(job, `采集出错：${error.message}`);
    } finally { autoRunnerActive = false; }
  }
  function addButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const controls = document.createElement('div');
    controls.id = 'imagegrab-research-controls';
    const button = document.createElement('button');
    button.id = BUTTON_ID; button.type = 'button'; button.textContent = '加入选品研究';
    button.title = '整理当前页面可见的 1688 商品资料到本地研究台';
    button.addEventListener('click', async () => {
      button.disabled = true; button.textContent = '正在整理…';
      let products = [];
      try {
        products = await collect();
        if (!products.length) throw new Error('未读取到受支持的商品卡片');
      } catch (error) {
        button.disabled = false; button.textContent = '整理失败';
        window.setTimeout(() => { button.textContent = '加入选品研究'; }, 2500);
        return;
      }
      chrome.runtime.sendMessage({ type: 'OPEN_RESEARCH', products, sourceUrl: location.href, pageTitle: document.title }, result => {
        button.disabled = false; button.textContent = result?.ok ? `已整理 ${products.length} 条` : '整理失败';
        window.setTimeout(() => { button.textContent = '加入选品研究'; }, 2500);
      });
    });
    const autoButton = document.createElement('button');
    autoButton.id = AUTO_BUTTON_ID; autoButton.type = 'button'; autoButton.textContent = '自动采集榜单';
    autoButton.title = `从当前页开始逐页采集，最多 ${AUTO_LIMIT} 条；遇到验证、分页异常或重复页会停止`;
    autoButton.addEventListener('click', async () => {
      if ((await readJob())?.running) return;
      const job = { running: true, ownerTabToken: tabToken, stopRequested: false, products: [], processedPages: [], pageCount: 0, startedAt: Date.now(), sourceUrl: location.href, pageTitle: document.title };
      await saveJob(job); updateButtons(job); runAutoCapture();
    });
    const stopButton = document.createElement('button');
    stopButton.id = STOP_BUTTON_ID; stopButton.type = 'button'; stopButton.textContent = '停止'; stopButton.hidden = true;
    stopButton.title = '停止自动采集并保留已收集的商品';
    stopButton.addEventListener('click', async () => { const job = await readJob(); if (job?.running) { job.stopRequested = true; await saveJob(job); updateButtons(job); } });
    controls.append(button, autoButton, stopButton);
    document.documentElement.appendChild(controls);
    readJob().then(job => { updateButtons(job); if (job?.running && job.ownerTabToken === tabToken) runAutoCapture(); });
  }
  addButton();
  new MutationObserver(addButton).observe(document.documentElement, { childList: true, subtree: true });
})();
