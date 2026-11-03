const STORAGE_KEY = 'imagegrabGalleryState';

function readRankingCards() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const imageUrl = value => /^https?:/i.test(String(value || '')) && !/(icon|logo|avatar|sprite|loading|placeholder)/i.test(String(value || ''));
  const cards = [...document.querySelectorAll('.cgf-product-card')];
  return cards.map(card => {
    let fiber = null;
    const fiberKey = Object.keys(card).find(key => key.startsWith('__reactFiber$'));
    if (fiberKey) fiber = card[fiberKey];
    let data = null;
    for (let depth = 0; fiber && depth < 8; depth += 1, fiber = fiber.return) {
      const candidate = fiber.memoizedProps?.data;
      if (candidate?.id && candidate?.title) { data = candidate; break; }
    }
    const body = clean(card.innerText);
    const title = clean(card.querySelector('.cgf-card-title')?.innerText) || clean(data?.title);
    const id = String(data?.id || '').trim();
    if (!/^\d{5,20}$/.test(id) || !title) return null;
    const images = [data?.image, ...[...card.querySelectorAll('img')].map(img => img.currentSrc || img.src || img.dataset.src)]
      .filter(imageUrl).filter((url, index, all) => all.indexOf(url) === index).slice(0, 8);
    const priceText = (clean(card.querySelector('.cgf-card-price')?.innerText) || clean(data?.price?.formatPrice)).replace(/\s+/g, '');
    let salesText = '';
    for (const item of card.querySelectorAll('.card-meta-item')) {
      const label = clean(item.querySelector('.card-meta-label')?.innerText);
      if (/月销量/.test(label)) {
        const value = clean(item.querySelector('.card-meta-value')?.innerText);
        salesText = [value, label].filter(Boolean).join(' ');
        break;
      }
    }
    return {
      title: title.slice(0, 180),
      url: `https://detail.1688.com/offer/${encodeURIComponent(id)}.html`,
      images,
      priceText: priceText.slice(0, 80),
      salesText: salesText.slice(0, 80),
      moqText: '', rank: '', supplierName: '', supplierUrl: '',
      visibleText: body.slice(0, 1200), sourceType: 'ranking'
    };
  }).filter(Boolean);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'READ_RANKING_CARDS') {
    const url = sender.url || '';
    if (!sender.tab?.id || sender.frameId !== 0 || !/^https:\/\/air\.1688\.com\/kapp\/1688-global\/sales\/ranking(?:[/?#]|$)/i.test(url)) {
      sendResponse({ ok: false, error: '当前页面不是受支持的 1688 榜单页面' });
      return false;
    }
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
      world: 'MAIN', func: readRankingCards
    }).then(results => sendResponse({ ok: true, products: results?.[0]?.result || [] }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'OPEN_GALLERY') {
    chrome.storage.local.set({ [STORAGE_KEY]: {
      images: Array.isArray(message.images) ? message.images : [],
      pageTitle: message.pageTitle || '商品图片', sourceUrl: message.sourceUrl || '', createdAt: Date.now()
    }}).then(() => chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') }))
      .then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'DOWNLOAD_ORIGINAL') {
    chrome.downloads.download({ url: message.url, filename: message.filename || '商品图.png', saveAs: false, conflictAction: 'uniquify' })
      .then(id => sendResponse({ ok: true, id })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'OPEN_RESEARCH') {
    const state = { products: Array.isArray(message.products) ? message.products : [], capturedAt: Date.now(), sourceUrl: message.sourceUrl || '', pageTitle: message.pageTitle || '' };
    chrome.storage.local.set({ imagegrabResearchCapture: state })
      .then(() => chrome.tabs.create({ url: chrome.runtime.getURL('research.html'), active: false }))
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'FINISH_RESEARCH_AUTO') {
    chrome.storage.local.get('imagegrabResearchAutoJob')
      .then(result => {
        const job = result.imagegrabResearchAutoJob || {};
        return chrome.storage.local.set({ imagegrabResearchCapture: {
          products: Array.isArray(job.products) ? job.products.slice(0, 1000) : [],
          capturedAt: Date.now(), sourceUrl: job.sourceUrl || '', pageTitle: job.pageTitle || '',
          pageCount: job.pageCount || 0, finishReason: job.finishReason || '已结束'
        }});
      })
      .then(() => chrome.tabs.create({ url: chrome.runtime.getURL('research.html'), active: false }))
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.set({ imagegrabVersion: '1.3.1' }));
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('research.html') }));
