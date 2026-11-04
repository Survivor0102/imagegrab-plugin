// Historical browser-side batch for the authorized 19 offers.
// Evaluate inside the actual installed extension research page.
// Requires current detail-capture.js (1.5.2); does not launch Chrome or acquire its lease.
// Uses actual rendered options, expands sold-out rows, and reuses completed image URLs.
(() => {
  const KEY = 'imagegrabRemaining19Job', DATA = 'imagegrabResearchData', DOWN = 'imagegrabOfferDownloads';
  if (globalThis.__remaining19Running) return { started: false, reason: 'already-running' };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const cleanName = value => String(value || '商品').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 48);
  let job, taskTab;
  const save = async () => { job.updatedAt = new Date().toISOString(); await chrome.storage.local.set({ [KEY]: job }); };
  async function page(func, args = []) {
    const results = await chrome.scripting.executeScript({ target: { tabId: taskTab.id, frameIds: [0] }, func, args });
    return results?.[0]?.result;
  }
  async function waitReady() {
    for (let i = 0; i < 32; i++) {
      await sleep(1000);
      try {
        const status = await page(() => ({
          url: location.href, title: document.title,
          productTitle: document.querySelector('#productTitle .title-content h1')?.innerText || '',
          attrs: document.querySelectorAll('#productAttributes .cpv-attr-item,#productAttributes th.ant-descriptions-item-label').length,
          challenge: /captcha|punish|login\.1688|login\.taobao|security/i.test(location.href) || /安全验证|访问验证|请完成验证|验证码|滑动验证|访问异常/.test(document.title)
        }));
        if (status.challenge) throw Object.assign(new Error('商品页面要求登录或安全验证'), { challenge: true });
        if (status.productTitle && status.attrs) return status;
      } catch (error) { if (error.challenge) throw error; }
    }
    throw new Error('等待商品参数加载超时，未采集');
  }
  async function collectOptions() {
    await chrome.scripting.executeScript({ target: { tabId: taskTab.id, frameIds: [0] }, files: ['detail-capture.js'] });
    await page(() => { document.querySelector('#description')?.scrollIntoView({ block: 'start' }); });
    await sleep(2500);
    return page(async () => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const groups = [...document.querySelectorAll('#skuSelection .feature-item')].map((g, index) => ({
        index, name: g.querySelector('h3')?.innerText || '',
        options: [...g.querySelectorAll('.sku-filter-button')].map((b, optionIndex) => ({ optionIndex, value: b.querySelector('.label-name')?.innerText || b.innerText, disabled: b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('disabled') || /(?:^|\s)disabled(?:\s|$)/.test(b.className) }))
      })).filter(g => g.options.length);
      let combinations = [[]];
      for (const group of groups) combinations = combinations.flatMap(combo => group.options.filter(o => !o.disabled).map(o => [...combo, { groupIndex: group.index, group: group.name, ...o }]));
      if (combinations.length > 600) throw new Error(`页面有${combinations.length}个选项组合，需分批确认采集范围`);
      const combined = globalThis.ImageGrabDetail.collect();
      combined.skus = []; combined.media = []; combined.images = [];
      combined.optionCollection = { includeSoldOut: true, groups, expectedCombinations: combinations.length, collected: [], skipped: [], method: 'Rendered option buttons selected sequentially; no cart, quantity or purchase actions' };
      const skuKeys = new Set(), mediaKeys = new Set();
      for (const combo of combinations) {
        for (const choice of combo) {
          const g = document.querySelectorAll('#skuSelection .feature-item')[choice.groupIndex];
          const button = [...g.querySelectorAll('.sku-filter-button')].find(b => (b.querySelector('.label-name')?.innerText || b.innerText) === choice.value);
          if (!button || button.getAttribute('aria-disabled') === 'true' || /(?:^|\s)disabled(?:\s|$)/.test(button.className)) continue;
          if (!button.classList.contains('active')) { button.click(); await sleep(1400); }
        }
        await sleep(400);
        const selectedCorrect = combo.every(choice => {
          const g = document.querySelectorAll('#skuSelection .feature-item')[choice.groupIndex];
          return [...g.querySelectorAll('.sku-filter-button.active')].some(b => (b.querySelector('.label-name')?.innerText || b.innerText) === choice.value);
        });
        if (!selectedCorrect) { combined.optionCollection.skipped.push({ options: combo.map(c => `${c.group}:${c.value}`), reason: '选项未激活或组合不可选' }); continue; }
        const expander = document.querySelector('#skuSelection .show-soldout-info a');
        if (expander && /展开/.test(expander.innerText)) { expander.click(); await sleep(650); }
        const snapshot = globalThis.ImageGrabDetail.collect();
        combined.optionCollection.collected.push({ options: combo.map(c => ({ group: c.group, value: c.value })), skuRows: snapshot.skus.length });
        for (const sku of snapshot.skus) {
          const key = JSON.stringify([sku.group, sku.value, sku.selectedOptions]);
          if (!skuKeys.has(key)) { skuKeys.add(key); combined.skus.push(sku); }
        }
        // Some templates use option buttons only, with no separate dimension rows.
        if (!snapshot.skus.length && snapshot.selectedOptions.length && snapshot.priceText) {
          const sku = { group: snapshot.selectedOptions.map(o => o.group).join(' / '), value: snapshot.selectedOptions.map(o => o.value).join(' / '), priceText: '', pageReferencePrice: snapshot.priceText, stockText: '页面未显示规格报价', selectedOptions: snapshot.selectedOptions, imageUrl: snapshot.selectedOptions.find(o => o.imageUrl)?.imageUrl || '', imageAssociation: snapshot.selectedOptions.some(o => o.imageUrl) ? 'selected-option-shared' : 'not-found', priceScope: 'not-displayed-for-selected-options' };
          const key = JSON.stringify([sku.group, sku.value, sku.selectedOptions]);
          if (!skuKeys.has(key)) { skuKeys.add(key); combined.skus.push(sku); }
        }
        for (const item of snapshot.media) {
          const key = `${item.role}|${item.url}`;
          if (!mediaKeys.has(key)) { mediaKeys.add(key); combined.media.push(item); }
        }
        combined.videoUrls = [...new Set([...(combined.videoUrls || []), ...snapshot.videoUrls])];
      }
      combined.images = [...new Set(combined.media.map(m => m.url))];
      combined.capturedAt = Date.now();
      return combined;
    });
  }
  async function importCapture(capture) {
    const before = new Set((await chrome.tabs.query({ url: chrome.runtime.getURL('research.html') + '*' })).map(t => t.id));
    const response = await chrome.runtime.sendMessage({ type: 'OPEN_RESEARCH', products: [capture], sourceUrl: capture.url, pageTitle: capture.title });
    if (!response?.ok) throw new Error(response?.error || '详情导入失败');
    let offer;
    for (let attempt = 0; attempt < 24; attempt++) {
      await sleep(700);
      const data = (await chrome.storage.local.get(DATA))[DATA];
      offer = data?.offers?.find(o => ImageGrabOfferData.canonical(o.url) === capture.url && o.details?.capturedAt === capture.capturedAt);
      if (offer) break;
    }
    if (!offer) throw new Error('研究台没有确认保存该详情');
    // Preserve batch coverage metadata next to the actual per-offer saved detail.
    const data = (await chrome.storage.local.get(DATA))[DATA];
    offer = data.offers.find(o => o.id === offer.id);
    offer.details.optionCollection = capture.optionCollection;
    await chrome.storage.local.set({ [DATA]: data });
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('research.html') + '*' });
    for (const tab of tabs) if (!before.has(tab.id)) await chrome.tabs.remove(tab.id);
    return offer;
  }
  async function queueDownload(url, filename) {
    try { const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: /\.(?:csv|json)$/.test(filename) ? 'overwrite' : 'uniquify' }); return { id, url, filename, state: 'in_progress', startedAt: Date.now() }; }
    catch (error) { return { url, filename, state: 'interrupted', error: error.message }; }
  }
  async function waitDownloads(records, timeout = 40000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      let running = false;
      for (const record of records.filter(r => Number.isInteger(r.id) && r.state === 'in_progress')) {
        const [d] = await chrome.downloads.search({ id: record.id });
        if (!d) { record.state = 'interrupted'; record.error = '下载记录不存在'; continue; }
        Object.assign(record, { state: d.state, absolutePath: d.filename, bytes: d.fileSize, mime: d.mime, error: d.error || '' });
        if (d.state === 'in_progress') running = true;
      }
      if (!running) break;
      await sleep(1000);
    }
    return records;
  }
  async function downloadOffer(offer, index, capture) {
    const folder = `ImageGrab/remaining19-20261104/${String(index + 1).padStart(2, '0')}-${capture.offerId}-${cleanName(capture.title)}`;
    const entries = ImageGrabOfferData.imageEntries(offer.details);
    const previous = job.items.find(item => item.url === capture.url);
    const records = (previous?.images || []).filter(r => r.state === 'complete' && entries.some(e => e.url === r.url));
    const missing = entries.filter(e => !records.some(r => r.url === e.url));
    for (let offset = 0; offset < missing.length; offset += 4) {
      const group = await Promise.all(missing.slice(offset, offset + 4).map(async (item, j) => {
        const n = entries.findIndex(e => e.url === item.url);
        const ext = new URL(item.url).pathname.match(/\.(webp|png|jpe?g|gif|avif)(?:_sum\.(?:jpe?g))?$/i)?.[1]?.toLowerCase() || 'img';
        return queueDownload(item.url, `${folder}/images/${String(n + 1).padStart(3, '0')}-${item.role}.${ext}`);
      }));
      await waitDownloads(group); records.push(...group);
      job.current.downloadedImages = records.filter(r => r.state === 'complete').length;
      job.current.totalImages = entries.length; await save();
    }
    const all = (await chrome.storage.local.get(DOWN))[DOWN] || {};
    all[offer.id] = records; await chrome.storage.local.set({ [DOWN]: all });
    const details = offer.details;
    const csv = ImageGrabOfferData.csv([['供应商','货源链接','发货地','规格类别','规格','选项','售价','价格说明','库存文字','对应图片链接','图片关联','价格口径','采集时间'], ...(details.skus || []).map(s => [offer.supplierName,offer.url,offer.shipFrom,s.group,s.value,(s.selectedOptions || []).map(o => `${o.group}：${o.value}`).join(' / '),s.priceText,offer.priceContext,s.stockText,s.imageUrl,s.imageAssociation,s.priceScope || 'sku-displayed-price',new Date(details.capturedAt).toISOString()])]);
    const json = JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(), offer, optionCollection: capture.optionCollection, imageDownloads: records }, null, 2);
    const dataUrl = (content, mime) => `data:${mime};base64,${btoa(unescape(encodeURIComponent(content)))}`;
    const exports = await Promise.all([
      queueDownload(dataUrl(csv,'text/csv;charset=utf-8'),`${folder}/规格报价.csv`),
      queueDownload(dataUrl(json,'application/json;charset=utf-8'),`${folder}/货源资料.json`)
    ]);
    await waitDownloads(exports);
    for (const item of exports) delete item.url;
    return { folder, images: records, exports };
  }
  globalThis.__remaining19Running = true;
  globalThis.__remaining19Promise = (async () => {
    const saved = (await chrome.storage.local.get(KEY))[KEY];
    const data = (await chrome.storage.local.get(DATA))[DATA];
    const targets = data.products.filter(p => !p.sourceUrl.includes('/678400004650.html')).map(p => ({ productId: p.id, title: p.title, url: ImageGrabOfferData.canonical(p.sourceUrl) }));
    if (targets.length !== 19) throw new Error(`本次商品数量为${targets.length}，与授权的其余19件不符`);
    job = saved?.version === 1 ? saved : { version: 1, startedAt: new Date().toISOString(), status: 'running', targets, items: [] };
    job.status = 'running'; job.coverageStartedAt = new Date().toISOString(); await save();
    taskTab = await chrome.tabs.create({ url: 'https://detail.1688.com/offer/737248976524.html', active: false });
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (job.items.some(item => item.url === target.url && item.status === 'complete' && item.coverage === 'all-rendered-including-soldout')) continue;
      job.current = { index: i + 1, title: target.title, url: target.url, stage: 'opening' }; await save();
      try {
        await chrome.tabs.update(taskTab.id, { url: target.url });
        await waitReady();
        job.current.stage = 'collecting-options'; await save();
        const capture = await collectOptions();
        const existing = (await chrome.storage.local.get(DATA))[DATA].offers.find(o => ImageGrabOfferData.canonical(o.url) === target.url)?.details;
        if (existing) {
          capture.media = [...(existing.media || []), ...capture.media].filter((m, i, list) => list.findIndex(x => x.role === m.role && x.url === m.url) === i);
          capture.images = [...new Set(capture.media.map(m => m.url))];
        }
        if (capture.url !== target.url) throw new Error('页面商品URL不匹配，拒绝归档');
        if (!capture.media.length) throw new Error('没有采到当前商品图片');
        job.current.stage = 'saving'; job.current.skus = capture.skus.length; job.current.combinations = capture.optionCollection.collected.length; await save();
        const offer = await importCapture(capture);
        job.current.stage = 'downloading'; await save();
        const result = await downloadOffer(offer, i, capture);
        const complete = result.images.every(d => d.state === 'complete') && result.exports.every(d => d.state === 'complete');
        const item = { index: i + 1, productId: target.productId, url: target.url, title: capture.title, supplierName: offer.supplierName, shipFrom: offer.shipFrom, status: complete ? 'complete' : 'partial', skuCount: capture.skus.length, attributes: capture.attributes.length, optionGroups: capture.optionCollection.groups.map(g => ({ name:g.name, count:g.options.length })), expectedCombinations: capture.optionCollection.expectedCombinations, collectedCombinations: capture.optionCollection.collected.length, skippedCombinations: capture.optionCollection.skipped, coverage: 'all-rendered-including-soldout', scope: 'All selectable rendered option combinations, including expanded sold-out rows; absent data remains missing', ...result };
        job.items = job.items.filter(item => item.url !== target.url); job.items.push(item); await save();
      } catch (error) {
        const item = { ...job.items.find(item => item.url === target.url), index: i + 1, ...target, status: error.challenge ? 'needs-verification' : 'failed', error: error.message };
        job.items = job.items.filter(item => item.url !== target.url); job.items.push(item); await save();
        if (error.challenge) { job.status = 'needs-verification'; return; }
      }
      await sleep(3500);
    }
    job.status = job.items.every(i => i.status === 'complete') ? 'complete' : 'finished-with-gaps';
    job.finishedAt = new Date().toISOString(); job.current = null; await save();
    await chrome.tabs.remove(taskTab.id); taskTab = null;
  })().catch(async error => { if (job) { job.status = 'error'; job.error = error.message; await save(); } globalThis.__remaining19Error = error.message; }).finally(() => { globalThis.__remaining19Running = false; });
  return { started: true, storageKey: KEY };
})();
