(() => {
  'use strict';
  const model = globalThis.ImageGrabOfferData;
  const STORAGE_KEY = 'imagegrabResearchData', DOWNLOAD_KEY = 'imagegrabOfferDownloads';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = selector => document.querySelector(selector);
  const roleName = role => ({ main: '主图', description: '详情图', 'sku-option': '规格选项图' }[role] || '商品图');
  let offer, product, details, imageList = [], downloadRecords = [], pollTimer, writing = Promise.resolve(), enqueuing = false;
  const filenamePart = value => String(value || '货源').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 60) || '货源';
  const folder = () => `ImageGrab/货源-${filenamePart(offer.id)}`;
  const date = value => value ? new Date(value).toLocaleString('zh-CN') : '未采集';
  function imageExtension(url) {
    const path = new URL(url).pathname;
    return path.match(/\.(webp|png|jpe?g|gif|avif)(?:_sum\.(?:jpe?g))?$/i)?.[1].toLowerCase() || 'img';
  }
  function downloadText(filename, content, type) {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([content], { type }));
    a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function persistDownloads() {
    writing = writing.catch(() => {}).then(async () => {
      const saved = (await chrome.storage.local.get(DOWNLOAD_KEY))[DOWNLOAD_KEY] || {};
      saved[offer.id] = downloadRecords;
      await chrome.storage.local.set({ [DOWNLOAD_KEY]: saved });
    });
    return writing;
  }
  function downloadStatus() {
    if (!downloadRecords.length) return;
    const completed = downloadRecords.filter(r => r.state === 'complete').length;
    const interrupted = downloadRecords.filter(r => r.state === 'interrupted').length;
    const active = downloadRecords.filter(r => r.state === 'in_progress').length;
    $('#download-status').textContent = `图片下载：已完成 ${completed}，进行中 ${active}，失败 ${interrupted}。\n文件位置：浏览器下载目录 / ${folder()}/images${interrupted ? '\n失败项：' + downloadRecords.filter(r => r.state === 'interrupted').map(r => `${r.filename}（${r.error || '下载中断'}）`).join('；') : ''}`;
    $('#download-status').classList.toggle('download-error', interrupted > 0);
  }
  async function refreshDownloads() {
    let changed = false;
    for (const record of downloadRecords.filter(r => Number.isInteger(r.id) && r.state === 'in_progress')) {
      const [item] = await chrome.downloads.search({ id: record.id });
      if (!item) { record.state = 'interrupted'; record.error = '下载记录不存在'; changed = true; }
      else if (item.state !== record.state) { record.state = item.state; record.error = item.error || ''; record.updatedAt = Date.now(); changed = true; }
    }
    if (changed) await persistDownloads();
    downloadStatus();
    clearTimeout(pollTimer);
    if (downloadRecords.some(r => r.state === 'in_progress')) pollTimer = setTimeout(() => refreshDownloads().catch(showError), 2000);
  }
  async function downloadImages(indices) {
    if (enqueuing) return;
    enqueuing = true;
    document.querySelectorAll('[data-download-image],#download-images').forEach(b => { b.disabled = true; });
    try {
      for (const index of indices) {
        const item = imageList[index];
        if (!item) continue;
        const filename = `${folder()}/images/${String(index + 1).padStart(3, '0')}-${roleName(item.role)}.${imageExtension(item.url)}`;
        const record = { url: item.url, filename, state: 'in_progress', startedAt: Date.now() };
        try { record.id = await chrome.downloads.download({ url: item.url, filename, saveAs: false, conflictAction: 'uniquify' }); }
        catch (error) { record.state = 'interrupted'; record.error = error.message; }
        downloadRecords.push(record);
        await persistDownloads(); downloadStatus();
      }
      await refreshDownloads();
    } finally {
      enqueuing = false;
      document.querySelectorAll('[data-download-image],#download-images').forEach(b => { b.disabled = false; });
    }
  }
  function showError(error) { $('#download-status').textContent = `操作未完成：${error.message}`; $('#download-status').classList.add('download-error'); }
  function render() {
    const skus = details?.skus || [];
    imageList = model.imageEntries(details);
    const source = model.http(offer.url), supplierUrl = model.http(offer.supplierUrl);
    document.title = `${offer.supplierName || '货源'} · 规格与图片 · ImageGrab`;
    const table = skus.length ? `<div class="sku-table-wrap"><table class="sku-table"><thead><tr><th>展示图片</th><th>规格</th><th>已选选项</th><th>售价</th><th>页面库存</th></tr></thead><tbody>${skus.map(sku => {
      const url = model.http(sku.imageUrl);
      return `<tr><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(sku.value)}对应选项图" loading="lazy"></a><small>${sku.imageAssociation === 'selected-option-shared' ? '共享选项图' : '规格关联图'}</small>` : '<span>未采到对应图片</span>'}</td><td><strong>${esc(sku.value)}</strong><small>${esc(sku.group)}</small></td><td>${esc((sku.selectedOptions || details.selectedOptions || []).map(o => `${o.group}：${o.value}`).join(' / ') || '未记录')}</td><td class="price">${esc(sku.priceText || '未显示')}</td><td>${esc(sku.stockText || '未显示')}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty-notice">这条货源还没有保存规格。打开货源详情，等待规格和商品详情加载后，点击“加入选品研究”。</div>';
    const gallery = ['main', 'sku-option', 'description'].map(role => {
      const items = imageList.map((item, index) => ({ ...item, index })).filter(item => item.role === role);
      if (!items.length) return '';
      return `<section class="offer-section"><h2>${roleName(role)} · ${items.length}</h2><div class="media-grid">${items.map(item => `<figure><a href="${esc(item.url)}" target="_blank" rel="noopener"><img src="${esc(item.url)}" alt="${roleName(role)}" loading="lazy"></a><figcaption><span>${roleName(role)} ${item.index + 1}</span><button class="small-action" data-download-image="${item.index}">下载图片</button></figcaption></figure>`).join('')}</div></section>`;
    }).join('');
    $('#offer-content').innerHTML = `<div class="offer-heading"><h1>${esc(details?.title || product.title)}</h1><div class="offer-meta"><span>供应商：${supplierUrl ? `<a class="table-link" href="${esc(supplierUrl)}" target="_blank" rel="noopener">${esc(offer.supplierName || '供应商主页')}</a>` : esc(offer.supplierName || '未记录')}</span><span>发货地：${esc(offer.shipFrom || '未记录')}</span><span>参考价：${esc(offer.priceText || '未记录')}</span><span>起批：${esc(offer.moqText || '未记录')}</span><span>采集时间：${esc(date(details?.capturedAt))}</span></div></div><div class="offer-toolbar">${source ? `<a class="button secondary" href="${esc(source)}" target="_blank" rel="noopener">打开货源 ↗</a>` : ''}<button id="export-skus" class="button primary" ${skus.length ? '' : 'disabled'}>下载规格表 CSV</button><button id="export-offer" class="button secondary">下载资料 JSON</button><button id="download-images" class="button secondary" ${imageList.length ? '' : 'disabled'}>下载全部图片（${imageList.length}）</button></div><section class="offer-section"><h2>规格与售价 · ${skus.length}</h2>${offer.priceContext ? `<p>价格说明：${esc(offer.priceContext)}</p>` : ''}${table}${skus.length ? '<p class="download-help">展示已采集选项下的规格；售价与库存为采集时页面值。标记“共享选项图”的规格使用同一张选项图。</p>' : ''}<p class="download-help">图片预览使用已保存链接。点击下载后保存图片文件；下方显示实际下载完成或失败状态。</p></section>${gallery}${details?.attributes?.length ? `<section class="offer-section"><h2>商品参数</h2><dl class="parameters">${details.attributes.map(a => `<dt>${esc(a.name)}</dt><dd>${esc(a.value)}</dd>`).join('')}</dl></section>` : ''}`;
    $('#export-skus').addEventListener('click', () => {
      const rows = [['供应商', '货源链接', '发货地', '规格类别', '规格', '选项', '售价', '价格说明', '库存文字', '对应图片链接', '图片关联', '采集时间'], ...skus.map(s => [offer.supplierName, offer.url, offer.shipFrom, s.group, s.value, (s.selectedOptions || details.selectedOptions || []).map(o => `${o.group}：${o.value}`).join(' / '), s.priceText, offer.priceContext, s.stockText, model.http(s.imageUrl), s.imageAssociation === 'selected-option-shared' ? '共享选项图' : s.imageAssociation, date(details.capturedAt)])];
      downloadText(`${filenamePart(offer.supplierName)}-规格报价.csv`, model.csv(rows), 'text/csv;charset=utf-8');
    });
    $('#export-offer').addEventListener('click', () => downloadText(`${filenamePart(offer.supplierName)}-货源资料.json`, JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(), productId: product.id, productTitle: product.title, offer: { ...offer, details }, imageDownloads: downloadRecords }, null, 2), 'application/json'));
    $('#download-images').addEventListener('click', () => downloadImages(imageList.map((_, index) => index)).catch(showError));
  }
  document.addEventListener('click', event => { const button = event.target.closest('[data-download-image]'); if (button) downloadImages([Number(button.dataset.downloadImage)]).catch(showError); });
  chrome.storage.local.get([STORAGE_KEY, DOWNLOAD_KEY]).then(async stored => {
    const data = stored[STORAGE_KEY] || { products: [], offers: [] };
    const migrated = model.migrate(data);
    if (migrated) await chrome.storage.local.set({ [STORAGE_KEY]: data });
    const id = new URLSearchParams(location.search).get('id');
    offer = data.offers?.find(o => o.id === id); product = data.products?.find(p => p.id === offer?.productId);
    if (!offer || !product) { $('#offer-content').innerHTML = '<div class="load-error"><h1>未找到这条货源</h1><p>记录可能已删除，请返回货源比较重新打开。</p><a class="table-link" href="research.html#offers">返回货源比较</a></div>'; return; }
    details = offer.details;
    downloadRecords = stored[DOWNLOAD_KEY]?.[offer.id] || [];
    render();
    if (downloadRecords.some(r => r.state === 'in_progress')) await refreshDownloads(); else downloadStatus();
  }).catch(error => { $('#offer-content').innerHTML = `<div class="load-error"><h1>资料读取失败</h1><p>${esc(error.message)}</p></div>`; });
})();
