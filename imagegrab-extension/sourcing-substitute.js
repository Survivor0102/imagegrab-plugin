(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const match = globalThis.ImageGrabSourcingMatch;
  let state = { criteria: { substitute: true, matchMode: 'exact', limit: 20 }, candidates: [], selected: [], reference: null };
  let report = null;
  let busy = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const clean = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const send = async (type, extra = {}) => {
    const reply = await chrome.runtime.sendMessage({ type, ...extra });
    if (!reply?.ok) throw Error(reply?.error || '后台未加载规格替代寻源功能，请重载扩展');
    return reply;
  };
  const status = text => { $('#substitute-status').textContent = text; };
  const intakeStatus = text => { $('#substitute-intake-status').textContent = text; };
  const criteria = () => ({
    substitute: true,
    name: $('#substitute-name').value.trim(),
    brand: $('#substitute-brand').value.trim(),
    category: $('#substitute-category').value.trim(),
    specs: $('#substitute-specs').value.trim(),
    matchMode: $('#substitute-match-mode').value,
    limit: Math.min(50, Math.max(1, Number($('#substitute-limit').value) || 20)),
    mode: 'alternative'
  });
  const persist = patch => send('SOURCING_SUBSTITUTE_UPDATE', { patch });
  function poolStatus() { $('#substitute-pool-status').textContent = `独立候选池：${state.candidates.length} 件（不会覆盖图片 / 名称筛选和截图自动寻源）`; }
  function sourceTags(row) { return [...new Set((row.sources || []).map(s => ({ image:'图片搜索', name:'名称搜索', pool:'商品池' }[s.channel] || '页面采集')))].join(' + '); }
  function numberSpecs(text) {
    const out = [];
    for (const m of clean(text).matchAll(/(\d+(?:\.\d+)?)\s*(mah|mm|cm|ml|kg|mg|gb|tb|w|v|g|l|毫米|厘米|毫升|千克|公斤|毫克|克|瓦|伏|升)/g)) out.push({ value: Number(m[1]), unit: m[2] });
    return out;
  }
  function annotate(row, c) {
    const text = clean([row.title, row.brand, row.model, row.category, row.visibleText].join(' '));
    const brand = clean(c.brand);
    const brandRelation = !brand ? 'unknown' : text.includes(brand) ? 'same' : 'different';
    const expectedNumbers = numberSpecs(c.specs), actualNumbers = numberSpecs(text);
    const expectedWords = clean(c.specs).replace(/\d+(?:\.\d+)?\s*(mah|mm|cm|ml|kg|mg|gb|tb|w|v|g|l|毫米|厘米|毫升|千克|公斤|毫克|克|瓦|伏|升)/g, ' ').split(/[\s,，;；、/]+/).filter(x => x.length > 1);
    const exact = expectedNumbers.every(e => actualNumbers.some(a => a.unit === e.unit && Math.abs(a.value - e.value) < 0.01));
    const unitPresent = expectedNumbers.every(e => actualNumbers.some(a => a.unit === e.unit));
    const wordsPresent = expectedWords.every(word => text.includes(word));
    let targetSpecStatus = 'unknown', specDifference = '';
    if (expectedNumbers.length || expectedWords.length) {
      if (exact && wordsPresent) targetSpecStatus = 'included';
      else if (c.matchMode === 'allow-difference' && unitPresent && wordsPresent) {
        targetSpecStatus = 'included';
        specDifference = '同单位存在，但数值与目标规格存在差异';
      } else if (expectedNumbers.some(e => actualNumbers.some(a => a.unit === e.unit && Math.abs(a.value - e.value) >= 0.01))) {
        targetSpecStatus = 'excluded';
        specDifference = '页面可见规格与目标规格冲突';
      }
    }
    const reasons = [...(row.reasons || [])];
    reasons.push(brandRelation === 'same' ? '标题或可见资料命中品牌' : brandRelation === 'different' ? '未命中目标品牌，作为替代品牌保留' : '品牌关系待详情页核对');
    reasons.push(targetSpecStatus === 'included' ? (specDifference || '候选包含目标规格线索') : targetSpecStatus === 'excluded' ? specDifference : '搜索结果页规格不足，详情页后再核对');
    return { ...row, substitute: true, brandRelation, targetSpecStatus, specDifference, reasons };
  }
  function annotateReport(raw, c) {
    const groups = ['shortlist', 'review', 'remaining', 'excluded'];
    const mapped = { shortlist: [], review: [], remaining: [], excluded: [] };
    for (const group of groups) for (const original of raw[group] || []) {
      const row = annotate(original, c);
      const targetGroup = row.targetSpecStatus === 'excluded' ? 'excluded' : row.targetSpecStatus === 'unknown' && group === 'shortlist' ? 'review' : group;
      mapped[targetGroup].push(row);
    }
    const all = groups.flatMap(group => mapped[group]);
    const byUrl = new Map(all.map(row => [row.url, row]));
    return { ...raw, ...mapped, total: all.length, all: [...byUrl.values()] };
  }
  function render() {
    if (!report) return;
    $('#substitute-result-count').textContent = `优先 ${report.shortlist.length} · 待核对 ${report.review.length} · 其余 ${report.remaining.length} · 排除 ${report.excluded.length} · 共 ${report.total}`;
    const rows = report[$('#substitute-result-view').value] || [];
    $('#substitute-results').innerHTML = rows.length ? ImageGrabSourcingResults.cards(rows, state.selected) : '<p class="muted">当前分组没有候选。</p>';
  }
  async function load() {
    const reply = await send('SOURCING_SUBSTITUTE_GET');
    state = reply.state || state;
    state.criteria ||= { substitute: true, matchMode: 'exact', limit: 20 };
    $('#substitute-name').value = state.criteria.name || '';
    $('#substitute-brand').value = state.criteria.brand || '';
    $('#substitute-category').value = state.criteria.category || '';
    $('#substitute-specs').value = state.criteria.specs || '';
    $('#substitute-match-mode').value = state.criteria.matchMode || 'exact';
    $('#substitute-limit').value = state.criteria.limit || 20;
    poolStatus();
    if (state.reference?.images?.length) showPreview();
    if (state.candidates.length && (state.criteria.name || state.criteria.category || state.criteria.specs)) {
      const raw = match.screen(state.candidates, { ...state.criteria, specs: '', mode: 'alternative', hasImage: false, hasReference: false });
      report = annotateReport(raw, state.criteria);
      render();
    }
  }
  async function tabs() {
    const selected = $('#substitute-source-tab').value;
    const reply = await send('SOURCING_SUBSTITUTE_TABS');
    $('#substitute-source-tab').innerHTML = reply.tabs.length ? reply.tabs.map(t => `<option value="${Number(t.id)}">${esc(t.title || t.url)}</option>`).join('') : '<option value="">请先打开1688搜索结果页</option>';
    if (reply.tabs.some(t => String(t.id) === selected)) $('#substitute-source-tab').value = selected;
  }
  async function toDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); }
  function showPreview() {
    const list = state.reference?.images || [];
    $('#substitute-preview').innerHTML = list.map(src => `<img src="${esc(src)}" alt="目标商品参考图">`).join('');
  }
  async function upload(event) {
    const files = [...(event.target.files || [])].slice(0, 2);
    if (!files.length) return;
    if (files.some(file => !/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024)) throw Error('请使用不超过12MB的PNG/JPEG/WebP图片');
    state.reference = { images: await Promise.all(files.map(toDataUrl)) };
    state.reference.image = state.reference.images[0];
    await persist({ reference: state.reference, selected: [] });
    showPreview();
    intakeStatus(`已保存 ${files.length} 张目标商品图；可用于1688图片搜索。`);
  }
  async function extract() {
    if (!state.reference?.images?.[0]) throw Error('请先选择商品图片');
    if (!globalThis.Tesseract) return intakeStatus('当前版本未加载 OCR；请直接修正名称和规格字段后搜索。');
    intakeStatus('正在本机提取图片文字……');
    const result = await Tesseract.recognize(state.reference.images[0], 'chi_sim+eng');
    const text = result?.data?.text?.replace(/\s+/g, ' ').trim() || '';
    if (!$('#substitute-name').value.trim()) $('#substitute-name').value = text.slice(0, 120);
    const specs = [...text.matchAll(/\d+(?:\.\d+)?\s*(?:W|V|mm|cm|mm|g|kg|ml|L|K)/gi)].map(x => x[0]);
    if (specs.length && !$('#substitute-specs').value.trim()) $('#substitute-specs').value = [...new Set(specs)].join(' ');
    await persist({ criteria: criteria(), selected: [] });
    intakeStatus(text ? `已提取文字线索：${text.slice(0, 100)}` : '没有识别到稳定文字，请手动填写目标名称和规格。');
  }
  async function searchName() { const c = criteria(); if (!c.name && !c.category) throw Error('请先填写商品名称或商品大类'); await persist({ criteria: c, selected: [] }); await send('SOURCING_SUBSTITUTE_SEARCH', { keyword: c.name || c.category }); status('名称搜索已打开；结果加载后点击“读取该页候选”。'); await tabs(); }
  async function searchImage() { if (!state.reference?.image) throw Error('请先上传商品图片'); await persist({ criteria: criteria(), selected: [] }); const reply = await send('SOURCING_SUBSTITUTE_IMAGE_SEARCH', { image: state.reference.image }); status(reply.message || '图片搜索已打开；结果加载后读取候选。'); await tabs(); }
  async function capture() { const tabId = Number($('#substitute-source-tab').value); if (!tabId) throw Error('请先刷新标签列表并选择1688结果页'); const c = criteria(); await persist({ criteria: c }); const reply = await send('SOURCING_SUBSTITUTE_CAPTURE', { tabId, channel: $('#substitute-channel').value }); await load(); status(`本页读取 ${reply.received} 条，独立候选池共 ${reply.total} 件。`); }
  async function screen() {
    const c = criteria();
    if (!c.name && !c.category && !c.specs && !state.reference) throw Error('请填写名称、品类、规格或上传图片');
    state.criteria = c; state.selected = [];
    const raw = match.screen(state.candidates, { ...c, specs: '', mode: 'alternative', hasImage: false, hasReference: false });
    report = annotateReport(raw, c);
    state.candidates = report.all;
    await persist({ criteria: c, candidates: state.candidates, selected: [] });
    if (!report.shortlist.length && report.review.length) $('#substitute-result-view').value = 'review';
    render();
    status(`已完成规格替代标注：优先 ${report.shortlist.length} 件；同品牌与不同品牌候选均保留，详情页再核对规格。`);
  }
  async function fromPool() { const reply = await send('SOURCING_SUBSTITUTE_FROM_POOL'); await load(); status(`已读取商品池记录；独立候选共 ${reply.total} 件。`); }
  async function clearPool() { await send('SOURCING_SUBSTITUTE_CLEAR'); report = null; await load(); $('#substitute-results').textContent = '本分支候选已清空，其他寻源分支保留。'; status('规格替代寻源候选已清空。'); }
  async function selectTop() { if (!report) throw Error('请先标注并筛选'); state.selected = report.shortlist.slice(0, Number($('#substitute-limit').value) || 20).map(row => row.url); await persist({ selected: state.selected }); render(); status(`已勾选 ${state.selected.length} 件候选。`); }
  async function admit(type) { if (!state.selected.length) throw Error('请先勾选候选'); const reply = await send(type, { urls: state.selected }); $('#substitute-job-status').textContent = type.endsWith('ENRICH') ? `详情补全任务已启动：${reply.count} 件` : `已加入商品池：${reply.count} 件；保留规格替代证据。`; }
  function exportJson() { const blob = new Blob([JSON.stringify({ ...state, report, exportedAt: new Date().toISOString(), identity: '规格替代寻源候选，不等于同款认证' }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'ImageGrab_规格替代寻源.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const action = (id, fn) => $(id).addEventListener('click', async () => { const button = $(id); button.disabled = true; try { await fn(); } catch (error) { status(error.message); } finally { button.disabled = false; } });
  action('#substitute-tabs-refresh', tabs);
  action('#substitute-text-search', searchName);
  action('#substitute-image-search', searchImage);
  action('#substitute-capture', capture);
  action('#substitute-from-pool', fromPool);
  action('#substitute-clear-pool', clearPool);
  action('#substitute-extract', extract);
  action('#substitute-screen', screen);
  action('#substitute-select-top', selectTop);
  action('#substitute-admit', () => admit('SOURCING_SUBSTITUTE_ADMIT'));
  action('#substitute-enrich', () => admit('SOURCING_SUBSTITUTE_ENRICH'));
  action('#substitute-export', exportJson);
  action('#substitute-reference-clear', async () => { state.reference = null; $('#substitute-reference-file').value = ''; $('#substitute-preview').textContent = ''; await persist({ reference: null, selected: [] }); intakeStatus('已移除目标商品图。'); });
  $('#substitute-reference-file').addEventListener('change', event => upload(event).catch(error => status(error.message)));
  for (const id of ['#substitute-name','#substitute-brand','#substitute-category','#substitute-specs','#substitute-match-mode','#substitute-limit']) $(id).addEventListener('change', () => { report = null; state.selected = []; persist({ criteria: criteria(), selected: [] }).catch(error => status(error.message)); });
  $('#substitute-result-view').addEventListener('change', render);
  $('#substitute-results').addEventListener('change', async event => { const url = event.target.dataset.url; if (!url) return; state.selected = event.target.checked ? [...new Set([...state.selected, url])] : state.selected.filter(item => item !== url); try { await persist({ selected: state.selected }); } catch (error) { status(error.message); } });
  (async () => { try { await load(); await tabs(); } catch (error) { status(error.message); } })();
})();
