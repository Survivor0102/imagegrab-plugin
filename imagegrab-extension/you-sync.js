/* User-triggered server sync; use the website's own login without exporting its token. */
(() => {
  'use strict';
  const CLIENT_KEY = 'imagegrabYouSyncClient';
  const STATUS_KEY = 'imagegrabYouSyncStatus';
  const ALLOWED = ['http://47.94.215.192:8000', 'https://shopserve.xin', 'https://www.shopserve.xin'];

  function batches(data, clientId, job, maxBytes = 650000) {
    const products = Array.isArray(data?.products) ? data.products : [];
    const offers = Array.isArray(data?.offers) ? data.offers : [];
    const certs = Array.isArray(data?.certificates) ? data.certificates : [];
    const encoder = new TextEncoder();
    const result = [];
    function push(batch) {
      if (encoder.encode(JSON.stringify(batch)).length > maxBytes) throw Error('有一条货源资料过大，请先导出 JSON 保留，再联系维护者调整同步批次');
      result.push(batch);
    }
    const base = () => ({ client_id: clientId, products: [], offers: [], certificates: [] });
    let parents = base();
    for (const product of products) {
      if (!product?.id) throw Error('商品缺少稳定 id，无法同步');
      const certificates = certs.filter(cert => cert.productId === product.id);
      if (certificates.length > 500) throw Error('单个商品的认证记录超过同步上限');
      // Only product-level fields live on the parent; full captures remain on each offer.
      const { skus, media, attributes, packaging, selectedOptions, optionCollection, ...parent } = product;
      const trial = { ...parents, products: [...parents.products, parent], certificates: [...parents.certificates, ...certificates] };
      if (parents.products.length && (trial.products.length > 20 || trial.certificates.length > 500 || encoder.encode(JSON.stringify(trial)).length > maxBytes)) {
        push(parents); parents = base();
      }
      parents.products.push(parent); parents.certificates.push(...certificates);
    }
    if (parents.products.length) push(parents);
    let batch = base();
    for (const offer of offers) {
      const trial = { ...batch, offers: [...batch.offers, offer] };
      if (batch.offers.length && (trial.offers.length > 20 || encoder.encode(JSON.stringify(trial)).length > maxBytes)) {
        push(batch); batch = base();
      }
      batch.offers.push(offer);
    }
    if (batch.offers.length) push(batch);
    const ids = new Set(products.map(product => product.id));
    if (offers.some(offer => !ids.has(offer.productId))) throw Error('存在没有所属商品的货源，请先在研究台核对档案');
    const sourcing = data.sourcingSync || globalThis.ImageGrabSourcingRequests?.collect(data);
    if (sourcing) {
      for (const request of sourcing.requests) push({ ...base(), requests: [request] });
      let links = [];
      for (const link of sourcing.links) {
        const trial = { ...base(), links: [...links, link] };
        if (links.length && (links.length >= 20 || encoder.encode(JSON.stringify(trial)).length > maxBytes)) {
          push({ ...base(), links }); links = [];
        }
        links.push(link);
      }
      if (links.length) push({ ...base(), links });
      let candidates = [];
      for (const candidate of sourcing.candidates || []) {
        const trial = { ...base(), candidates: [...candidates, candidate] };
        if (candidates.length && (candidates.length >= 20 || encoder.encode(JSON.stringify(trial)).length > maxBytes)) {
          push({ ...base(), candidates }); candidates = [];
        }
        candidates.push(candidate);
      }
      if (candidates.length) push({ ...base(), candidates });
    }
    if (job) push({ ...base(), job: { ...job, run_id: String(job.id || job.runId || 'detail-job') } });
    return result;
  }

  // Executed in the already logged-in Shop page. No credentials leave this function.
  async function sendFromWebsite(batch, expectedOrigin) {
    if (location.origin !== expectedOrigin) return { ok: false, error: '网站地址已变化，请重新打开展示台' };
    let token = localStorage.getItem('access_token');
    if (!token) return { ok: false, error: '请先在网站登录管理员账号，再点击同步' };
    const send = () => fetch('/api/goods/imagegrab-you/', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(batch),
    });
    try {
      let response = await send();
      if (response.status === 401) {
        const refresh = await fetch('/api/user/account/refresh_token/', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!refresh.ok) return { ok: false, error: '网站登录已过期，请重新登录管理员账号' };
        token = (await refresh.json()).access;
        if (!token) return { ok: false, error: '刷新网站登录失败' };
        localStorage.setItem('access_token', token);
        response = await send();
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: body.message || body.detail || (response.status === 403 ? '当前网站账号没有管理员权限' : `同步请求失败（${response.status}）`) };
      return { ok: body.result === 'success', data: body, error: body.result === 'success' ? '' : '服务器没有确认保存成功' };
    } catch (error) { return { ok: false, error: error.message || '无法连接服务器' }; }
  }

  globalThis.ImageGrabYouSync = { batches, sendFromWebsite };
  if (typeof document === 'undefined') return;
  const open = document.querySelector('#you-sync-open'), dialog = document.querySelector('#you-sync-dialog');
  if (!open || !dialog) return;
  const status = document.querySelector('#you-sync-status'), button = document.querySelector('#you-sync-start');
  const originInput = document.querySelector('#you-sync-origin');
  function show(value) { status.textContent = value; }
  open.addEventListener('click', async () => {
    dialog.showModal();
    const saved = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY];
    if (ALLOWED.includes(saved?.origin)) originInput.value = saved.origin;
    show(saved?.finishedAt ? `上次同步：${new Date(saved.finishedAt).toLocaleString('zh-CN')}，${saved.products} 个商品、${saved.offers} 条货源。` : '在所选网站登录管理员账号，再点击开始同步。网站密码不会保存到插件。');
  });
  document.querySelector('#you-sync-website').addEventListener('click', () => chrome.tabs.create({ url: `${originInput.value}/static/frontend/goods/ImageGrabYou` }));
  button.addEventListener('click', async () => {
    const origin = originInput.value;
    if (!ALLOWED.includes(origin)) { show('服务器地址不受支持'); return; }
    button.disabled = true;
    try {
      // Static server permission is used for the maintained server. Optional domains
      // still request access once, but an already granted permission must not trigger
      // a second user-gesture-only request.
      const pattern = `${origin}/*`;
      if (!await chrome.permissions.contains({ origins: [pattern] }) && !await chrome.permissions.request({ origins: [pattern] })) throw Error('尚未允许访问所选网站');
      const tabs = await chrome.tabs.query({ url: pattern });
      const tab = tabs.find(tab => tab.url?.includes('/goods/ImageGrabYou')) || tabs[0];
      if (!tab?.id) { await chrome.tabs.create({ url: `${origin}/static/frontend/goods/ImageGrabYou` }); throw Error('已打开网站，请先登录管理员账号，然后再点击同步'); }
      const stored = await chrome.storage.local.get(['imagegrabResearchData', 'imagegrabDetailJob', CLIENT_KEY, ...ImageGrabSourcingRequests.POOL_KEYS]);
      const data = stored.imagegrabResearchData || {};
      const clientId = stored[CLIENT_KEY] || crypto.randomUUID();
      await chrome.storage.local.set({ [CLIENT_KEY]: clientId });
      // Only the web preview is resized; the local original input stays untouched.
      const sourcing = globalThis.ImageGrabSourcingRequests.collect(data, stored);
      if (!data.products?.length && !sourcing.candidates.length) throw Error('商品池和寻源候选池暂时没有可同步的数据');
      for (const request of sourcing.requests) {
        const image = request.reference?.image || request.reference?.original;
        if (image) {
          const bitmap = await createImageBitmap(await (await fetch(image)).blob());
          try {
            const canvas = document.createElement('canvas'), scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
            canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            request.reference = { image: canvas.toDataURL('image/jpeg', 0.82), crop: request.reference.crop || null };
          } finally { bitmap.close(); }
        }
      }
      const chunks = batches({ ...data, sourcingSync: sourcing }, clientId, stored.imagegrabDetailJob);
      const counts = { created_products: 0, updated_products: 0, created_offers: 0, updated_offers: 0 };
      for (let index = 0; index < chunks.length; index++) {
        show(`正在同步 ${index + 1} / ${chunks.length} 批…`);
        const replies = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: sendFromWebsite, args: [chunks[index], origin] });
        const result = replies[0]?.result;
        if (!result?.ok) throw Error(result?.error || '网站没有返回同步结果');
        for (const key of Object.keys(counts)) counts[key] += result.data[key] || 0;
      }
      await chrome.storage.local.set({ [STATUS_KEY]: { origin, finishedAt: Date.now(), products: data.products?.length || 0, offers: data.offers?.length || 0, candidates: sourcing.candidates.length, counts } });
      show(`同步完成：${data.products?.length || 0} 个商品、${data.offers?.length || 0} 条入池货源、${sourcing.candidates.length} 条独立寻源候选关联。打开网站的 1688_you 后点击刷新即可查看。`);
    } catch (error) { show(`同步停止：${error.message}。本地资料仍然保留；已成功批次可以在网站查看，再次同步会更新原记录。`); }
    finally { button.disabled = false; }
  });
})();
