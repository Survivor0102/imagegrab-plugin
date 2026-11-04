(() => {
  'use strict';
  const text = node => (node?.innerText || '').replace(/\s+/g, ' ').trim();
  const all = (root, selector) => root ? [...root.querySelectorAll(selector)] : [];
  const unique = values => [...new Set(values.filter(Boolean))];
  function http(value) { if (!value) return ''; try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } }
  function canonical(value) { const match = String(value || '').match(/(?:detail|offer)\.1688\.com\/offer\/(\d+)\.html/); return match ? `https://detail.1688.com/offer/${match[1]}.html` : http(value); }
  function imageKey(value) { return value.replace(/\.(jpg|png|jpeg)(?:_[^/?]*)?(?:\?[^#]*)?$/i, '.$1'); }
  function images(root, selector, role) {
    const seen = new Set();
    return all(root, selector).flatMap(img => {
      const link = img.closest('a[href]');
      if (link && /\/offer\/\d+/.test(link.href) && canonical(link.href) !== canonical(location.href)) return [];
      const url = http(img.currentSrc || img.getAttribute('src') || img.dataset.src || img.dataset.original || '');
      if (!url || /(?:placeholder|loading|sprite|avatar|logo)/i.test(url) || seen.has(imageKey(url))) return [];
      seen.add(imageKey(url)); return [{ url, role, sourceUrl: canonical(location.href) }];
    });
  }
  function shadowRoots(root) {
    if (!root) return [];
    return [root, ...all(root, '*').filter(el => el.shadowRoot).flatMap(el => shadowRoots(el.shadowRoot))];
  }
  function collect() {
    const title = text(document.querySelector('#productTitle .title-content h1'));
    if (!title) throw new Error('未识别当前商品详情模板；请等待商品标题加载');
    const url = canonical(location.href), capturedAt = Date.now();
    const attributes = [], seen = new Set();
    const add = (name, value) => { if (name && value && !seen.has(`${name}\0${value}`)) { seen.add(`${name}\0${value}`); attributes.push({ name, value }); } };
    all(document, '#productAttributes .cpv-attr-item').forEach(el => add(text(el.querySelector('.cpv-attr-label')), text(el.querySelector('.cpv-attr-value'))));
    all(document, '#productAttributes th.ant-descriptions-item-label').forEach(el => add(text(el), text(el.nextElementSibling)));
    const attr = label => attributes.find(a => a.name === label)?.value || '';
    const supplier = document.querySelector('#shopNavigation a.shop-company-name');
    const mainImages = images(document.querySelector('#gallery'), 'img.preview-img', 'main');
    const descriptionImages = shadowRoots(document.querySelector('#description')).flatMap(root => images(root, 'img', 'description'));
    const optionImages = images(document.querySelector('#skuSelection'), '.sku-filter-button img', 'sku-option');
    const media = [...mainImages, ...descriptionImages, ...optionImages].filter((item, i, list) => list.findIndex(x => x.url === item.url && x.role === item.role) === i);
    const groups = all(document, '#skuSelection .feature-item');
    const selectedOptions = groups.flatMap(group => all(group, '.sku-filter-button.active').map(button => ({ group: text(group.querySelector('h3')), value: text(button.querySelector('.label-name')) || text(button), imageUrl: images(button, 'img', 'sku-option')[0]?.url || '' })));
    const skus = groups.flatMap(group => all(group, '.expand-view-item').map(row => ({
      group: text(group.querySelector('h3')), value: row.querySelector('.item-label')?.getAttribute('title') || text(row.querySelector('.item-label')),
      priceText: all(row, '.item-price-stock').map(text).find(v => /[¥￥]/.test(v)) || '',
      stockText: all(row, '.item-price-stock').map(text).find(v => /库存/.test(v)) || '',
      selectedOptions, imageUrl: selectedOptions.find(o => o.imageUrl)?.imageUrl || '', imageAssociation: selectedOptions.some(o => o.imageUrl) ? 'selected-option-shared' : 'not-found'
    })).filter(row => row.value));
    const salesObservations = unique(all(document, '#mainPrice .sold-count .slick-slide:not(.slick-cloned)').map(text)).map(value => ({ text: value, metric: 'detail-displayed-sales', sourceUrl: url, capturedAt }));
    const priceText = text(document.querySelector('#mainPrice .price-info')).replace(/\s+/g, '');
    const priceContext = text(document.querySelector('#mainPrice .old-customer-tag'));
    const moqText = text(document.querySelector('#mainPrice .price-component p')).match(/\d[\d,.]*\s*(?:件|个|套|箱|包|米|千克|公斤)\s*起批/)?.[0] || '';
    const supplierMetrics = all(document, '#shopNavigation .shop-data-item').map(el => ({ name: text(el.querySelector('.shop-data-item-label')), value: text(el.querySelector('.shop-data-item-value')) })).filter(x => x.name && x.value);
    const packaging = all(document, '#productPackInfo table').map(table => ({ headers: all(table, 'th').map(text), rows: all(table, 'tbody tr').map(row => all(row, 'td').map(text)) }));
    return {
      captureKind: 'detail', offerId: url.match(/\/offer\/(\d+)/)?.[1] || '', title, url,
      brand: attr('品牌'), category: attr('类别'), origin: attr('产地'), attributes,
      supplierName: text(supplier), supplierUrl: http(supplier?.href || ''), supplierMetrics,
      supplierYears: text(document.querySelector('#shopNavigation .shop-tp-year')),
      supplierCategory: text(document.querySelector('#shopNavigation .shop-category-name')), supplierRating: text(document.querySelector('#shopNavigation .shop-star-text')),
      shipFrom: text(document.querySelector('#shippingServices .location')),
      priceText, priceContext, moqText, salesText: salesObservations[0]?.text || '', salesObservations,
      skus, selectedOptions, media, packaging, promotionText: text(document.querySelector('#productPromotion')), images: unique(media.map(item => item.url)),
      videoUrls: unique(shadowRoots(document.querySelector('#description')).concat(document.querySelector('#gallery')).flatMap(root => all(root, 'video').map(v => http(v.currentSrc || v.src || '')))),
      services: unique(all(document, '#mainServices .service-item-link').map(text)),
      specs: attributes.map(a => `${a.name}：${a.value}`).join('\n'),
      certificateEvidence: { status: 'not-verified', note: '仅记录页面参数；未进行官方认证核验' },
      visibleText: attributes.map(a => `${a.name}：${a.value}`).join('；'), capturedAt
    };
  }
  globalThis.ImageGrabDetail = { collect, canonical };
})();
