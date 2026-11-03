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
  function parseSrcset(value, map) {
    if (!value) return;
    value.split(',').forEach(part => {
      const [url, descriptor] = part.trim().split(/\s+/);
      const size = descriptor?.endsWith('w') ? Number.parseInt(descriptor, 10) : 0;
      addCandidate(map, url, size, size, 'srcset');
    });
  }
  function collectImages() {
    const map = new Map();
    document.querySelectorAll('img').forEach(img => {
      const w = img.naturalWidth || img.width || img.getAttribute('width');
      const h = img.naturalHeight || img.height || img.getAttribute('height');
      [img.currentSrc, img.src, img.getAttribute('data-src'), img.getAttribute('data-lazy-src'), img.getAttribute('data-original'), img.getAttribute('data-img')]
        .forEach(url => addCandidate(map, url, w, h, 'img'));
      parseSrcset(img.getAttribute('srcset'), map);
      parseSrcset(img.getAttribute('data-srcset'), map);
    });
    document.querySelectorAll('*').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        for (const match of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) addCandidate(map, match[1], el.clientWidth, el.clientHeight, 'background');
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
