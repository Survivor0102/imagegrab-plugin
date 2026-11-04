(() => {
  'use strict';
  const fields = ['title', 'attributes', 'skus', 'selectedOptions', 'media', 'images', 'videoUrls', 'services', 'packaging', 'promotionText', 'certificateEvidence', 'specs', 'optionCollection'];
  const http = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  function canonical(value) { const url = http(value); const match = url.match(/(?:detail|offer)\.1688\.com\/offer\/(\d+)\.html/); return match ? `https://detail.1688.com/offer/${match[1]}.html` : url; }
  function fromCapture(row) {
    return { ...Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]])), sourceUrl: canonical(row.url), capturedAt: row.capturedAt || Date.now() };
  }
  function migrate(data) {
    let changed = false;
    for (const offer of data.offers || []) {
      if (offer.details) continue;
      const product = (data.products || []).find(p => p.id === offer.productId);
      if (!product?.detailSourceUrl || !canonical(offer.url) || canonical(product.detailSourceUrl) !== canonical(offer.url)) continue;
      offer.details = fromCapture({ ...product, url: product.detailSourceUrl, capturedAt: product.detailCapturedAt });
      changed = true;
    }
    return changed;
  }
  function csv(rows) {
    return '\ufeff' + rows.map(row => row.map(value => {
      let s = String(value ?? '');
      if (/^[\u0000-\u0020]*[=+@-]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    }).join(',')).join('\r\n');
  }
  function imageEntries(details) {
    const media = [...(details?.media || []), ...(details?.skus || []).filter(s => s.imageUrl).map(s => ({ url: s.imageUrl, role: 'sku-option' }))];
    const entries = new Map();
    for (const item of media) { const url = http(item.url); if (url && !entries.has(url)) entries.set(url, { url, role: item.role || 'image' }); }
    return [...entries.values()];
  }
  globalThis.ImageGrabOfferData = { http, canonical, fromCapture, migrate, csv, imageEntries };
})();
