(() => {
  'use strict';
  const BUTTON_ID = 'imagegrab-research-button';
  const OFFER_URL = /(?:detail\.1688\.com\/offer\/|offer\.1688\.com\/offer\/|1688\.com\/offer\/)/i;
  const PRICE = /(?:¥|￥)\s*[\d,.]+(?:\s*[-~至]\s*(?:¥|￥)?\s*[\d,.]+)?/;
  const SALES = /(?:成交\s*[\d,.]+\s*(?:笔|件)?|\d[\d,.]*(?:万|千)?\+?\s*(?:人付款|人已付款|笔成交|件成交|件已售|人收货))/i;
  const MOQ = /(?:起批|起订|\d+\s*(?:件|个|套|箱)起批)/;
  const RANK = /(?:第\s*(\d{1,4})\s*名|(?:^|\s)#\s*(\d{1,4})|TOP\s*(\d{1,4}))/i;

  function text(node) { return (node?.innerText || '').replace(/\s+/g, ' ').trim(); }
  function imageUrls(node) {
    return [...node.querySelectorAll('img')].map(img => img.currentSrc || img.src || img.dataset.src || img.dataset.original)
      .filter(src => src && /^https?:/i.test(src) && !/(icon|logo|avatar|sprite|loading|placeholder)/i.test(src))
      .filter((src, i, all) => all.indexOf(src) === i).slice(0, 16);
  }
  function supplierFrom(node) {
    const link = [...node.querySelectorAll('a[href]')].find(a => /(?:shop|company|dianpu|wangpu).*1688\.com|\.1688\.com\/page\//i.test(a.href));
    return { name: text(link), url: link?.href || '' };
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
    return { title: title.slice(0, 180), url: anchor.href, images: imageUrls(card), priceText, salesText, moqText, rank: rankMatch?.[1] || rankMatch?.[2] || rankMatch?.[3] || '', supplierName: supplier.name, supplierUrl: supplier.url, visibleText: body.slice(0, 1600) };
  }
  function collect() {
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
  function addButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID; button.type = 'button'; button.textContent = '加入选品研究';
    button.title = '整理当前页面可见的 1688 商品资料到本地研究台';
    button.addEventListener('click', () => {
      button.disabled = true; button.textContent = '正在整理…';
      const products = collect();
      chrome.runtime.sendMessage({ type: 'OPEN_RESEARCH', products, sourceUrl: location.href, pageTitle: document.title }, result => {
        button.disabled = false; button.textContent = result?.ok ? `已整理 ${products.length} 条` : '整理失败';
        window.setTimeout(() => { button.textContent = '加入选品研究'; }, 2500);
      });
    });
    document.documentElement.appendChild(button);
  }
  addButton();
  new MutationObserver(addButton).observe(document.documentElement, { childList: true, subtree: true });
})();
