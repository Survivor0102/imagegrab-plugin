// Run this function through Runtime.evaluate on the current product page.
// It reads public product sections independently of the extension collector.
function auditDetail(sample) {
  const p = sample.product, offer = sample.offers[0];
  const text = el => (el?.innerText || '').replace(/\s+/g, ' ').trim();
  const rows = [...document.querySelectorAll('#skuSelection .expand-view-item')].map(el => ({
    value: el.querySelector('.item-label')?.getAttribute('title') || text(el.querySelector('.item-label')),
    cells: [...el.querySelectorAll('.item-price-stock')].map(text)
  }));
  const attributes = [...document.querySelectorAll('#productAttributes .cpv-attr-item')].map(el => ({ name: text(el.querySelector('.cpv-attr-label')), value: text(el.querySelector('.cpv-attr-value')) }));
  for (const label of document.querySelectorAll('#productAttributes th.ant-descriptions-item-label')) attributes.push({ name: text(label), value: text(label.nextElementSibling) });
  const roots = [];
  function visit(root) { if (!root) return; roots.push(root); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot); }
  visit(document.querySelector('#description'));
  const main = [...document.querySelectorAll('#gallery img.preview-img')].map(i => i.currentSrc || i.src);
  const description = roots.flatMap(root => [...root.querySelectorAll('img')].map(i => i.currentSrc || i.src));
  const checks = {
    correctProductTitle: p.title === text(document.querySelector('#productTitle .title-content h1')),
    correctSupplier: offer.supplierName === text(document.querySelector('#shopNavigation a.shop-company-name')),
    correctPrice: offer.priceText === text(document.querySelector('#mainPrice .price-info')).replace(/\s+/g, ''),
    allParametersMatch: p.attributes.length > 0 && attributes.every(a => p.attributes.some(x => x.name === a.name && x.value === a.value)) && p.attributes.every(a => attributes.some(x => x.name === a.name && x.value === a.value)),
    allSkuPricesAndStocksMatch: rows.length === p.skus.length && rows.every((row, i) => row.value === p.skus[i].value && row.cells.includes(p.skus[i].priceText) && row.cells.includes(p.skus[i].stockText)),
    mainImagesMatch: main.length === p.media.filter(m => m.role === 'main').length && main.every(src => p.media.some(m => m.role === 'main' && m.url === src)),
    descriptionImagesMatch: description.length === p.media.filter(m => m.role === 'description').length && description.every(src => p.media.some(m => m.role === 'description' && m.url === src)),
    originNotInferredFromShipping: p.origin === '' && offer.shipFrom === text(document.querySelector('#shippingServices .location')),
    preservesDifferentSalesMetrics: offer.salesObservations.some(o => o.metric === 'ranking-displayed-sales') && offer.salesObservations.some(o => o.metric === 'detail-displayed-sales'),
    stillOneExistingProductAndOffer: sample.productCount === 20 && sample.offerCount === 20 && sample.offers.length === 1
  };
  return { auditedAt: new Date().toISOString(), sourceUrl: location.href, method: 'Independent live DOM read compared with actual extension storage', checks, passed: Object.values(checks).every(Boolean), counts: { attributes: p.attributes.length, skus: rows.length, mainImages: main.length, descriptionImages: description.length } };
}
module.exports = auditDetail;
