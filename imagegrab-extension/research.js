(() => {
  'use strict';
  const STORAGE_KEY = 'imagegrabResearchData';
  const CAPTURE_KEY = 'imagegrabResearchCapture';
  const state = { products: [], offers: [], certificates: [], view: 'products', filter: 'all', selectedId: '', query: '' };
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const date = value => value ? new Date(value).toLocaleDateString('zh-CN') : '—';
  const toast = message => { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2400); };
  const save = () => chrome.storage.local.set({ [STORAGE_KEY]: { products: state.products, offers: state.offers, certificates: state.certificates, selectedId: state.selectedId } });

  function capturedSourceType(url, pageTitle) { return /rank|top1000|top-1000|排行榜|榜单|排行/i.test(`${url} ${pageTitle}`) ? 'ranking' : 'similar'; }
  function makeOffer(row, sourceUrl, sourceType) {
    return { id: id(), productId: '', supplierName: row.supplierName || '', supplierUrl: safeUrl(row.supplierUrl), location: '', url: safeUrl(row.url), priceText: row.priceText || '', moqText: row.moqText || '', salesText: row.salesText || '', qualification: '', sourceUrl: safeUrl(sourceUrl), sourceType, visibleText: row.visibleText || '', capturedAt: Date.now() };
  }
  async function importCapture() {
    const stored = await chrome.storage.local.get(CAPTURE_KEY);
    const capture = stored[CAPTURE_KEY];
    if (!capture || !Array.isArray(capture.products) || !capture.products.length) return;
    const sourceType = capturedSourceType(capture.sourceUrl || '', capture.pageTitle || '');
    let added = 0;
    for (const row of capture.products.slice(0, 100)) {
      const normalizedUrl = safeUrl(row.url) || safeUrl(capture.sourceUrl);
      let product = state.products.find(x => normalizedUrl && x.sourceUrl === normalizedUrl);
      if (!product) {
        product = { id: id(), title: row.title || '待补全商品名', brand: '', category: '', sourceType, rank: row.rank || '', sourceUrl: normalizedUrl, images: Array.isArray(row.images) ? row.images.map(safeUrl).filter(Boolean).slice(0, 16) : [], specs: row.visibleText || '', origin: '', notes: '', createdAt: Date.now(), updatedAt: Date.now() };
        state.products.unshift(product); added++;
      } else {
        product.images = [...new Set([...(product.images || []), ...(Array.isArray(row.images) ? row.images.map(safeUrl).filter(Boolean) : [])])].slice(0, 24);
        product.specs ||= row.visibleText || '';
      }
      const offer = makeOffer(row, capture.sourceUrl || '', sourceType);
      offer.productId = product.id;
      if (offer.url && !state.offers.some(x => x.productId === product.id && x.url === offer.url)) state.offers.unshift(offer);
      if (!state.selectedId) state.selectedId = product.id;
    }
    await save();
    await chrome.storage.local.remove(CAPTURE_KEY);
    toast(`已导入 ${added} 条新商品，货源已归档`);
  }

  function filteredProducts() {
    const query = state.query.toLocaleLowerCase();
    return state.products.filter(p => (state.filter === 'all' || p.sourceType === state.filter) && (!query || [p.title, p.brand, p.category, p.origin, ...state.offers.filter(o => o.productId === p.id).map(o => o.supplierName)].join(' ').toLocaleLowerCase().includes(query)));
  }
  function completeness(product) {
    const missing = ['brand', 'category', 'origin'].filter(key => !product[key]);
    if (!product.specs) missing.push('规格');
    return missing.length ? `待补 ${missing.length} 项` : '基础资料齐全';
  }
  function productRow(product) {
    const offers = state.offers.filter(x => x.productId === product.id);
    const price = offers.find(x => x.priceText)?.priceText || '未记录';
    const source = { ranking: '榜单', similar: '同款寻源', manual: '手动' }[product.sourceType] || '手动';
    const thumb = safeUrl(product.images?.[0]);
    const action = state.selectedId && state.selectedId !== product.id
      ? `<button class="row-more" data-merge-into="${esc(product.id)}" title="将此候选并入当前商品的货源">⇢</button>`
      : `<button class="row-more" data-open="${esc(product.id)}" title="查看档案">›</button>`;
    return `<tr class="product-row ${state.selectedId === product.id ? 'selected' : ''}" data-product="${esc(product.id)}"><td><div class="product-cell">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : '<span class="thumb-placeholder">▧</span>'}<div><strong>${esc(product.title || '未命名商品')}</strong><span>${esc(product.brand || product.category || '品牌/类目待补')}</span></div></div></td><td><span class="source-tag ${esc(product.sourceType)}">${source}</span>${product.rank ? `<small>排名 ${esc(product.rank)}</small>` : ''}</td><td>${esc(price)}<small>${offers.find(x => x.moqText)?.moqText ? `起订 ${esc(offers.find(x => x.moqText).moqText)}` : '起订量待核'}</small></td><td>${offers.length} 家</td><td><span class="status-text ${completeness(product).startsWith('待') ? 'pending' : 'done'}">${completeness(product)}</span></td><td>${action}</td></tr>`;
  }
  function offerRows() {
    return state.offers.filter(o => !state.query || [o.supplierName, o.priceText, o.location, o.visibleText, state.products.find(p => p.id === o.productId)?.title].join(' ').toLocaleLowerCase().includes(state.query.toLocaleLowerCase())).map(o => {
      const p = state.products.find(x => x.id === o.productId);
      const url = safeUrl(o.url);
      const supplierUrl = safeUrl(o.supplierUrl);
      return `<tr><td><strong>${esc(p?.title || '商品已删除')}</strong></td><td>${supplierUrl ? `<a class="table-link" href="${esc(supplierUrl)}" target="_blank" rel="noopener">${esc(o.supplierName || '供应商主页 ↗')}</a>` : esc(o.supplierName || '供应商待识别')}<small>${esc(o.location || '地区待补')}</small></td><td>${esc(o.priceText || '未记录')}<small>${esc(o.moqText || '起订量未记录')}</small></td><td>${esc(o.salesText || '未显示')}</td><td>${url ? `<a class="table-link" href="${esc(url)}" target="_blank" rel="noopener">打开货源 ↗</a>` : '链接不可用'}</td><td><button class="delete-offer" data-delete-offer="${esc(o.id)}" title="删除货源">×</button></td></tr>`;
    }).join('');
  }
  function renderCertificates() {
    const records = state.certificates.filter(c => !state.query || [c.type, c.number, c.issuer, c.status, state.products.find(p => p.id === c.productId)?.title].join(' ').toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
    return records.map(c => { const evidence = safeUrl(c.evidenceUrl); return `<tr><td><strong>${esc(state.products.find(p => p.id === c.productId)?.title || '商品已删除')}</strong></td><td>${esc(c.type || '认证类型未填')}<small>${esc(c.number || '无证书编号')}</small></td><td>${esc(c.issuer || '机构待核')}</td><td><span class="cert-status ${esc(c.status)}">${{unverified:'待核验',verified:'已核验',invalid:'未通过'}[c.status] || '待核验'}</span></td><td>${evidence ? `<a class="table-link" href="${esc(evidence)}" target="_blank" rel="noopener">查看证据 ↗</a>` : '未附证据'}</td><td><button class="delete-cert" data-delete-cert="${esc(c.id)}" title="删除记录">×</button></td></tr>`; }).join('');
  }

  function renderDetail() {
    const panel = $('#detail-panel'), product = state.products.find(x => x.id === state.selectedId);
    if (!product || state.view !== 'products') { panel.hidden = true; return; }
    panel.hidden = false;
    const offers = state.offers.filter(x => x.productId === product.id);
    const certificates = state.certificates.filter(x => x.productId === product.id);
    const sourceUrl = safeUrl(product.sourceUrl);
    panel.innerHTML = `<div class="detail-top"><span class="eyebrow">PRODUCT DOSSIER</span><div class="detail-actions"><button class="icon-button" data-edit-product="${esc(product.id)}" title="编辑商品" aria-label="编辑商品">✎</button><button class="icon-button danger" data-delete-product="${esc(product.id)}" title="删除商品" aria-label="删除商品">×</button></div></div><h2>${esc(product.title)}</h2><p class="detail-subtitle">${esc(product.brand || '品牌待核')} · ${esc(product.category || '类目待补')} · ${esc(product.origin || '产地待核')}</p><div class="detail-link-row">${sourceUrl ? `<a class="table-link" href="${esc(sourceUrl)}" target="_blank" rel="noopener">打开来源商品 ↗</a>` : '<span>暂无商品链接</span>'}<button class="text-action" data-search-similar="${esc(product.id)}">在 1688 搜同名货源 ↗</button></div>${product.images?.length ? `<div class="image-strip">${product.images.slice(0,8).map(src => { const url = safeUrl(src); return url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="商品图片" loading="lazy"></a>` : ''; }).join('')}</div>` : ''}<section class="detail-section"><div class="section-heading"><h3>货源与报价 <span>${offers.length}</span></h3><button class="small-action" data-add-offer="${esc(product.id)}">＋ 添加货源</button></div>${offers.length ? offers.map(o => { const url = safeUrl(o.url); return `<article class="offer-card"><div><strong>${esc(o.supplierName || '供应商待补')}</strong><span>${esc(o.priceText || '价格待询')} · 起订 ${esc(o.moqText || '待询')}</span><small>${esc(o.salesText || '')} ${esc(o.location || '')}</small></div>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="打开货源">↗</a>` : ''}</article>`; }).join('') : '<p class="subtle-empty">从搜索结果捕获货源，或手动添加候选供应商。</p>'}</section><section class="detail-section"><div class="section-heading"><h3>参数与资料</h3><button class="small-action" data-edit-product="${esc(product.id)}">编辑</button></div><p class="spec-text">${esc(product.specs || '尚未补充规格参数。')}</p></section><section class="detail-section"><div class="section-heading"><h3>认证核验 <span>${certificates.length}</span></h3><button class="small-action" data-add-cert="${esc(product.id)}">＋ 添加记录</button></div>${certificates.length ? certificates.map(c => `<div class="certificate-line"><span class="cert-status ${esc(c.status)}">${{unverified:'待核验',verified:'已核验',invalid:'未通过'}[c.status] || '待核验'}</span><span>${esc(c.type)} ${esc(c.number)}</span></div>`).join('') : '<p class="subtle-empty">记录证书编号和官方核验结果；商品页自述不自动标记为已核验。</p>'}</section><section class="detail-section notes-section"><span>内部备注</span><p>${esc(product.notes || '—')}</p></section><footer class="detail-footer">创建于 ${date(product.createdAt)} · ${product.images?.length || 0} 个图片链接</footer>`;
  }

  function render() {
    const names = { products: ['商品池', '从榜单和搜索结果收集候选商品，再补全采购与上架资料。'], offers: ['货源比较', '按候选商品横向比较供应商、价格、起订量和页面可见销量。'], certificates: ['认证核验', '集中检查待核验的证书记录与证据来源。'] };
    $('#view-title').textContent = names[state.view][0]; $('#view-description').textContent = names[state.view][1];
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === state.view));
    document.querySelectorAll('.segment').forEach(el => el.classList.toggle('active', el.dataset.filter === state.filter));
    $('#product-count').textContent = state.products.length; $('#offer-count').textContent = state.offers.length;
    $('#metric-products').textContent = state.products.length; $('#metric-offers').textContent = state.offers.length;
    $('#metric-incomplete').textContent = state.products.filter(p => completeness(p).startsWith('待')).length;
    $('#metric-certificates').textContent = state.certificates.filter(c => c.status === 'unverified').length;
    const isProducts = state.view === 'products';
    document.querySelector('.segmented').hidden = !isProducts;
    const table = document.querySelector('table');
    table.innerHTML = state.view === 'products'
      ? '<thead><tr><th>商品</th><th>来源</th><th>参考价 / 起订</th><th>货源数</th><th>资料状态</th><th></th></tr></thead><tbody id="product-rows"></tbody>'
      : state.view === 'offers'
        ? '<thead><tr><th>商品</th><th>供应商</th><th>价格 / 起订</th><th>页面可见销量</th><th>链接</th><th></th></tr></thead><tbody id="product-rows"></tbody>'
        : '<thead><tr><th>商品</th><th>证书</th><th>机构</th><th>核验状态</th><th>证据</th><th></th></tr></thead><tbody id="product-rows"></tbody>';
    const rows = $('#product-rows');
    if (isProducts) rows.innerHTML = filteredProducts().map(productRow).join('');
    else if (state.view === 'offers') rows.innerHTML = offerRows();
    else rows.innerHTML = renderCertificates();
    const hasRows = rows.children.length > 0;
    $('#empty-state').hidden = hasRows;
    $('#result-count').textContent = `${rows.children.length} 条记录`;
    $('#detail-panel').hidden = true;
    if (isProducts) renderDetail();
  }

  function openProduct(product) {
    const form = $('#product-form'); form.reset();
    $('#dialog-title').textContent = product ? '编辑商品档案' : '新建商品';
    for (const [key, value] of Object.entries(product || {})) if (form.elements[key]) form.elements[key].value = Array.isArray(value) ? value.join('\n') : value;
    if (!product) form.elements.sourceType.value = 'manual';
    $('#product-dialog').showModal();
  }
  function openOffer(productId) { const form = $('#offer-form'); form.reset(); form.elements.productId.value = productId; $('#offer-dialog').showModal(); }
  function openCertificate(productId) { const form = $('#certificate-form'); form.reset(); form.elements.productId.value = productId; $('#certificate-dialog').showModal(); }
  function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

  $('#product-form').addEventListener('submit', async event => {
    event.preventDefault(); const data = formData(event.currentTarget), productId = data.productId || id();
    const old = state.products.find(p => p.id === productId);
    const product = { ...old, id: productId, title: data.title.trim(), brand: data.brand.trim(), category: data.category.trim(), sourceType: data.sourceType, rank: data.rank, sourceUrl: safeUrl(data.sourceUrl), images: data.images.split(/\n+/).map(safeUrl).filter(Boolean).slice(0,24), specs: data.specs.trim(), origin: data.origin.trim(), notes: data.notes.trim(), createdAt: old?.createdAt || Date.now(), updatedAt: Date.now() };
    if (old) Object.assign(old, product); else state.products.unshift(product);
    state.selectedId = productId; await save(); event.currentTarget.closest('dialog').close(); render();
  });
  $('#offer-form').addEventListener('submit', async event => {
    event.preventDefault(); const d = formData(event.currentTarget);
    state.offers.unshift({ id: id(), productId: d.productId, supplierName: d.supplierName.trim(), supplierUrl: safeUrl(d.supplierUrl), location: d.location.trim(), url: safeUrl(d.url), priceText: d.priceText.trim(), moqText: d.moqText.trim(), salesText: d.salesText.trim(), qualification: d.qualification.trim(), capturedAt: Date.now() });
    await save(); event.currentTarget.closest('dialog').close(); render(); toast('货源已添加');
  });
  $('#certificate-form').addEventListener('submit', async event => {
    event.preventDefault(); const d = formData(event.currentTarget);
    const evidenceUrl = safeUrl(d.evidenceUrl);
    if (d.status === 'verified' && !evidenceUrl) { toast('标记已核验前，请填写有效的 HTTP(S) 核验来源或证据链接'); return; }
    state.certificates.unshift({ id: id(), productId: d.productId, type: d.type.trim(), number: d.number.trim(), issuer: d.issuer.trim(), status: d.status, evidenceUrl, notes: d.notes.trim(), updatedAt: Date.now() });
    await save(); event.currentTarget.closest('dialog').close(); render(); toast('认证记录已保存');
  });

  document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-view]'); if (nav) { state.view = nav.dataset.view; render(); return; }
    const filter = event.target.closest('[data-filter]'); if (filter) { state.filter = filter.dataset.filter; render(); return; }
    const close = event.target.closest('[data-close]'); if (close) { close.closest('dialog').close(); return; }
    const row = event.target.closest('[data-product]'); if (row && !event.target.closest('button')) { state.selectedId = row.dataset.product; await save(); render(); return; }
    const action = event.target.closest('button'); if (!action) return;
    if (action.id === 'new-product' || action.id === 'empty-create') { openProduct(); return; }
    if (action.dataset.open) { state.selectedId = action.dataset.open; render(); return; }
    if (action.dataset.editProduct) { openProduct(state.products.find(p => p.id === action.dataset.editProduct)); return; }
    if (action.dataset.addOffer) { openOffer(action.dataset.addOffer); return; }
    if (action.dataset.addCert) { openCertificate(action.dataset.addCert); return; }
    if (action.dataset.searchSimilar) { const p = state.products.find(x => x.id === action.dataset.searchSimilar); if (p) chrome.tabs.create({ url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(p.title)}` }); return; }
    if (action.dataset.mergeInto) {
      const sourceId = action.dataset.mergeInto;
      const source = state.products.find(p => p.id === sourceId);
      const target = state.products.find(p => p.id === state.selectedId);
      if (!source || !target || !window.confirm(`将“${source.title}”作为“${target.title}”的候选货源？请先确认是同款或可比款。`)) return;
      for (const offer of state.offers) if (offer.productId === sourceId) offer.productId = target.id;
      for (const cert of state.certificates) if (cert.productId === sourceId) cert.productId = target.id;
      target.images = [...new Set([...(target.images || []), ...(source.images || [])])].slice(0, 24);
      target.specs ||= source.specs; target.brand ||= source.brand; target.category ||= source.category;
      state.products = state.products.filter(p => p.id !== sourceId);
      await save(); render(); toast('候选货源已并入当前商品'); return;
    }
    if (action.dataset.deleteProduct) { const target = action.dataset.deleteProduct; state.products = state.products.filter(x => x.id !== target); state.offers = state.offers.filter(x => x.productId !== target); state.certificates = state.certificates.filter(x => x.productId !== target); state.selectedId = state.products[0]?.id || ''; await save(); render(); return; }
    if (action.dataset.deleteOffer) { state.offers = state.offers.filter(x => x.id !== action.dataset.deleteOffer); await save(); render(); return; }
    if (action.dataset.deleteCert) { state.certificates = state.certificates.filter(x => x.id !== action.dataset.deleteCert); await save(); render(); return; }
  });
  $('#search').addEventListener('input', event => { state.query = event.target.value; render(); });
  $('#export-button').addEventListener('click', () => download('imagegrab-research-backup.json', JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), products: state.products, offers: state.offers, certificates: state.certificates }, null, 2), 'application/json'));
  $('#csv-button').addEventListener('click', () => {
    const headers = ['商品名','品牌','类目','来源','排名','商品链接','图片链接','规格参数','产地','供应商','供应商主页','货源链接','价格','起订量','页面销量','供应商地区','认证类型','证书编号','核验状态','核验来源'];
    const rows = state.products.flatMap(p => { const offers = state.offers.filter(o => o.productId === p.id); const certs = state.certificates.filter(c => c.productId === p.id); return (offers.length ? offers : [{}]).flatMap(o => (certs.length ? certs : [{}]).map(c => [p.title,p.brand,p.category,p.sourceType,p.rank,p.sourceUrl,(p.images||[]).join(' '),p.specs,p.origin,o.supplierName,o.supplierUrl,o.url,o.priceText,o.moqText,o.salesText,o.location,c.type,c.number,c.status,c.evidenceUrl])); });
    const csv = [headers, ...rows].map(row => row.map(v => { const value = String(v ?? '').replace(/^[\u0000-\u0020]*(?=[=+@-])/, "'"); return `"${value.replace(/"/g,'""')}"`; }).join(',')).join('\r\n'); download('imagegrab-research-export.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
  });
  function download(filename, content, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  $('#import-button').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try { const data = JSON.parse(await file.text()); if (!Array.isArray(data.products) || !Array.isArray(data.offers) || !Array.isArray(data.certificates)) throw new Error('JSON 结构不匹配'); state.products = data.products; state.offers = data.offers; state.certificates = data.certificates; await save(); render(); toast('备份已导入'); }
    catch (error) { toast(`导入失败：${error.message}`); }
    event.target.value = '';
  });

  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog')?.close()));
  chrome.storage.local.get(STORAGE_KEY).then(async result => {
    const saved = result[STORAGE_KEY] || {};
    state.products = Array.isArray(saved.products) ? saved.products : [];
    state.offers = Array.isArray(saved.offers) ? saved.offers : [];
    state.certificates = Array.isArray(saved.certificates) ? saved.certificates : [];
    state.selectedId = state.products.some(p => p.id === saved.selectedId) ? saved.selectedId : '';
    const capturePage = await chrome.storage.local.get(CAPTURE_KEY);
    if (capturePage[CAPTURE_KEY]?.products?.length) await importCapture();
    if (!state.selectedId) state.selectedId = state.products[0]?.id || '';
    render();
  }).catch(error => toast(`读取本地档案失败：${error.message}`));
})();
