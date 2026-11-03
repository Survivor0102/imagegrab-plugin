(() => {
  'use strict';
  const BUTTON_ID = 'imagegrab-floating-button';
  const MIN_SIZE = 100;
  const BAD_WORDS = /(^|[-_/.])(icon|logo|avatar|sprite|placeholder|loading|default|blank|emoji|qr)([-_.\/]|$)/i;

  function absoluteUrl(value) {
    if (!value || typeof value !== 'string') return null;
    const cleaned = value.trim().replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
    if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('blob:')) return null;
    try { return new URL(cleaned, location.href).href; } catch { return null; }
  }
  function addCandidate(map, raw, width = 0, height = 0, source = 'unknown') {
    const url = absoluteUrl(raw);
    if (!url || BAD_WORDS.test(url)) return;
    const w = Number(width) || 0, h = Number(height) || 0;
    if (w > 0 && h > 0 && (w < MIN_SIZE || h < MIN_SIZE)) return;
    const key = url.split('#')[0];
    if (!map.has(key)) map.set(key, { url: key, width: w, height: h, source });
  }
  const PRODUCT_URL = /(?:item\.taobao\.com\/item\.htm|detail\.tmall\.com\/item\.htm|(?:mclick|click)\.simba\.taobao\.com\/cc_im|item\.jd\.com\/\d+\.html|detail\.jd\.com\/item\.htm|yangkeduo\.com\/goods\.html)/i;
  function visibleText(element) {
    if (!element) return '';
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    return (element.innerText || '').replace(/\s+/g, ' ').trim();
  }
  function linkInfo(container, image) {
    const anchors = [...container.querySelectorAll('a[href]')];
    const anchor = anchors.find(item => PRODUCT_URL.test(item.href) && item.contains(image))
      || anchors.find(item => PRODUCT_URL.test(item.href) && item.querySelector('img'));
    if (!anchor) return { title: '', url: '' };
    const imageAlt = anchor.querySelector('img')?.alt || '';
    const titleNode = anchor.querySelector('[class*="title--"], [class*="descWrapper--"]');
    const title = visibleText(titleNode) || anchor.getAttribute('title') || anchor.getAttribute('aria-label') || imageAlt || visibleText(anchor);
    return { title: title.slice(0, 180), url: anchor.href };
  }
  function cardProductContext(image) {
    let node = image.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
      const text = visibleText(node);
      const salesText = ImageGrabSales.extractSalesText(text);
      if (!salesText) continue;
      const link = linkInfo(node, image);
      if (link.url) return { ...link, salesText };
    }
    return null;
  }
  function detailPageProductContext() {
    const url = new URL(location.href);
    const isSupportedHost = /(?:^|\.)(?:taobao\.com|tmall\.com)$/i.test(url.hostname);
    const isDetail = /\/item\.htm$|\/detail\.htm$/i.test(url.pathname) && isSupportedHost;
    if (!isDetail) return null;
    const heading = document.querySelector('h1');
    let salesText = '';
    for (let node = heading, depth = 0; node && node !== document.body && depth < 8; node = node.parentElement, depth++) {
      salesText = ImageGrabSales.extractSalesText(visibleText(node));
      if (salesText) break;
    }
    const title = visibleText(heading) || document.title;
    return { title: title.slice(0, 180), url: location.href, salesText };
  }
  function mergeContext(previous, next) {
    if (!previous) return next || {};
    if (!next) return previous;
    return {
      title: previous.title || next.title || '',
      productUrl: previous.productUrl || next.productUrl || '',
      salesText: previous.salesText || next.salesText || ''
    };
  }
  function collectImages() {
    const map = new Map();
    const detailContext = detailPageProductContext();
    function addFromElement(el, raw, width, height, source) {
      addCandidate(map, raw, width, height, source);
      const key = absoluteUrl(raw)?.split('#')[0];
      if (!key || !map.has(key)) return;
      const image = el instanceof HTMLImageElement ? el : null;
      const context = (image && cardProductContext(image)) || detailContext;
      const product = context && {
        title: context.title || '', productUrl: context.url || '', salesText: context.salesText || ''
      };
      const existing = map.get(key);
      if (existing.product?.ambiguous) return;
      if (existing.product?.productUrl && product?.productUrl && existing.product.productUrl !== product.productUrl) {
        existing.product = { title: '', productUrl: '', salesText: '', ambiguous: true };
      } else if (!existing.product || (!existing.product.salesText && product?.salesText)) {
        existing.product = mergeContext(existing.product, product);
      }
    }
    document.querySelectorAll('img').forEach(img => {
      const w = img.naturalWidth || img.width || img.getAttribute('width');
      const h = img.naturalHeight || img.height || img.getAttribute('height');
      [img.currentSrc, img.src, img.getAttribute('data-src'), img.getAttribute('data-lazy-src'), img.getAttribute('data-original'), img.getAttribute('data-img')]
        .forEach(url => addFromElement(img, url, w, h, 'img'));
      [img.getAttribute('srcset'), img.getAttribute('data-srcset')].forEach(value => {
        if (!value) return;
        value.split(',').forEach(part => {
          const [url, descriptor] = part.trim().split(/\s+/);
          const size = descriptor?.endsWith('w') ? Number.parseInt(descriptor, 10) : 0;
          addFromElement(img, url, size, size, 'srcset');
        });
      });
    });
    document.querySelectorAll('*').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        for (const match of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) addFromElement(el, match[1], el.clientWidth, el.clientHeight, 'background');
      }
    });
    return [...map.values()].slice(0, 500);
  }
  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID; button.type = 'button'; button.textContent = '获取图片';
    button.title = '扫描当前详情页中的商品图片';
    button.addEventListener('click', () => {
      button.setAttribute('aria-busy', 'true'); button.textContent = '正在扫描…';
      const images = collectImages();
      chrome.runtime.sendMessage({ type: 'OPEN_GALLERY', images, pageTitle: document.title, sourceUrl: location.href }, () => {
        button.removeAttribute('aria-busy'); button.textContent = images.length ? `已提取 ${images.length} 张` : '未找到大图';
        window.setTimeout(() => { button.textContent = '获取图片'; }, 2200);
      });
    });
    document.documentElement.appendChild(button);
  }
  ensureButton();
  const observer = new MutationObserver(() => ensureButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 15000);
})();
