const STORAGE_KEY = 'imagegrabGalleryState';
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      .then(() => chrome.tabs.create({ url: chrome.runtime.getURL('research.html') }))
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.set({ imagegrabVersion: '1.2.0' }));
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('research.html') }));
