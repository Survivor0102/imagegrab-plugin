(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const status = text => { $('#auto-ocr-status').textContent = text; };
  const jobStatus = text => { $('#auto-job-status').textContent = text; };
  let inputImage = null, inputObjectUrl = '', crop = null, drag = null, worker = null, running = false;
  const imageCanvas = document.createElement('canvas');
  imageCanvas.className = 'image-intake-canvas';
  imageCanvas.hidden = true;
  imageCanvas.setAttribute('aria-label', '可选：框选参考商品区域');
  const cropHelp = document.createElement('p');
  cropHelp.className = 'muted image-crop-help';
  cropHelp.textContent = '可选框选商品主体用于1688图搜；文字识别仍读取整张截图。';
  $('#auto-preview').after(cropHelp, imageCanvas);

  function parseFields(data) {
    const trusted = Number(data.confidence) >= 60 && Boolean(data.title);
    $('#auto-title').value = trusted ? data.title : '';
    $('#auto-brand').value = trusted ? data.brand || '' : '';
    $('#auto-category').value = trusted ? data.category || '' : '';
    $('#auto-specs').value = trusted ? data.specs || '' : '';
    $('#auto-barcode').value = data.barcode || '';
    $('#auto-sku').value = data.sku || '';
    $('#auto-spu').value = data.spu || '';
    $('#auto-confidence').textContent = `OCR文字置信度：${data.confidence || 0} 分。${trusted ? '识别字段可修改。' : '未自动采用识别名称和条件；将只做图片搜索，也可手动填写商品名称。'}编号仅用于留档，不会冒充1688型号。`;
    $('#auto-fields').hidden = false;
    $('#auto-run').disabled = !inputImage;
  }

  async function loadOcrWorker() {
    if (worker) return worker;
    if (!globalThis.Tesseract?.createWorker) throw Error('本地OCR组件未加载；请在扩展页检查资源完整性后重载');
    const base = chrome.runtime.getURL('ocr/');
    worker = await Tesseract.createWorker('chi_sim+eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core/`,
      langPath: `${base}lang`,
      gzip: true,
      workerBlobURL: false,
      logger: message => {
        if (message.status === 'recognizing text') status(`正在本机识别商品截图：${Math.round(message.progress * 100)}%`);
        else if (message.status === 'loading language traineddata') status(`正在加载本地中文识别模型：${Math.round(message.progress * 100)}%`);
      }
    });
    return worker;
  }

  function drawCrop() {
    if (!inputImage) return;
    const canvas = imageCanvas, maxWidth = Math.min(760, Math.max(320, $('#auto-preview').clientWidth || 640));
    const ratio = Math.min(1, maxWidth / inputImage.width);
    canvas.width = Math.max(1, Math.round(inputImage.width * ratio));
    canvas.height = Math.max(1, Math.round(inputImage.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(inputImage, 0, 0, canvas.width, canvas.height);
    if (crop) {
      ctx.fillStyle = '#10202755'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const x = crop.x * canvas.width, y = crop.y * canvas.height, w = crop.w * canvas.width, h = crop.h * canvas.height;
      ctx.clearRect(x, y, w, h); ctx.drawImage(inputImage, crop.x * inputImage.width, crop.y * inputImage.height, crop.w * inputImage.width, crop.h * inputImage.height, x, y, w, h);
      ctx.strokeStyle = '#087e69'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    }
    canvas.hidden = false;
  }
  function point(event) { const rect = imageCanvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; }
  function imageForSearch() {
    if (!inputImage) return '';
    const area = crop && crop.w > .03 && crop.h > .03 ? crop : { x: 0, y: 0, w: 1, h: 1 };
    const width = inputImage.width * area.w, height = inputImage.height * area.h, scale = Math.min(1, 1200 / Math.max(width, height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(inputImage, area.x * inputImage.width, area.y * inputImage.height, width, height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .88);
  }

  $('#auto-reference-file').addEventListener('change', async event => {
    try {
      const file = event.target.files?.[0]; if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) throw Error('请选择不超过12MB的 PNG、JPEG 或 WebP 图片');
      running = false; $('#auto-run').disabled = true; $('#auto-fields').hidden = true; $('#auto-raw-text').textContent = '';
      inputImage?.close(); if (inputObjectUrl) URL.revokeObjectURL(inputObjectUrl);
      inputObjectUrl = URL.createObjectURL(file); $('#auto-preview').src = inputObjectUrl; $('#auto-preview').hidden = false;
      inputImage = await createImageBitmap(file); crop = null; drawCrop();
      status('图片已载入，正在启动本机 OCR。截图内容不会发送给 OCR 服务。');
      const activeWorker = await loadOcrWorker();
      const result = await activeWorker.recognize(file);
      const parsed = ImageGrabSourcingImage.parse(result.data.text, result.data.confidence);
      if (inputImage.width / inputImage.height >= 4.5) {
        const left = Math.round(inputImage.width * .07), width = Math.round(inputImage.width * .19);
        const column = await activeWorker.recognize(file, { rectangle: { left, top: 0, width, height: inputImage.height } });
        const columnFields = ImageGrabSourcingImage.parse(column.data.text, column.data.confidence);
        if (columnFields.title && columnFields.title.length > parsed.title.length) parsed.title = columnFields.title;
      }
      $('#auto-raw-text').textContent = result.data.text || '未识别到文字';
      parseFields(parsed);
      if (!$('#auto-title').value) { status('图片已就绪，未采用不可靠的OCR名称。可以直接只用图片搜索，也可以手动填写名称。'); return; }
      status(`已识别商品信息：${parsed.title}。请查看识别结果；搜索前仍可修正名称或条件。`);
    } catch (error) {
      status(`识别失败：${error.message}。${inputImage ? '仍可使用图片搜索，或手动填写名称。' : ''}`);
      if (inputImage) parseFields({confidence:0});
    }
  });

  imageCanvas.addEventListener('pointerdown', event => { drag = point(event); imageCanvas.setPointerCapture(event.pointerId); });
  imageCanvas.addEventListener('pointermove', event => { if (!drag) return; const end = point(event); crop = { x: Math.min(drag.x, end.x), y: Math.min(drag.y, end.y), w: Math.abs(end.x - drag.x), h: Math.abs(end.y - drag.y) }; drawCrop(); });
  imageCanvas.addEventListener('pointerup', () => { drag = null; if (crop && (crop.w < .03 || crop.h < .03)) crop = null; drawCrop(); });

  async function wait(ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const job = await chrome.storage.local.get('imagegrabSourcingAutoJob');
      if (job.imagegrabSourcingAutoJob?.stop || !job.imagegrabSourcingAutoJob?.running) throw Error('已停止自动寻源');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  async function message(type, extra = {}) {
    const reply = await chrome.runtime.sendMessage({ type, ...extra });
    if (!reply?.ok) throw Error(reply?.error || `${type} 未成功`);
    return reply;
  }
  async function run() {
    if (running) return;
    const title = $('#auto-title').value.trim();
    if (!inputImage) throw Error('请先选择商品截图');
    running = true; $('#auto-run').disabled = true; $('#auto-stop').hidden = false; $('#auto-reference-file').disabled = true;
    let added = 0, phase = '初始化', runId = '', finishStatus = 'paused';
    try {
      runId = crypto.randomUUID?.() || `auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await message('SOURCING_AUTO_BEGIN', { runId });
      const brand = title ? $('#auto-brand').value.trim() : '', category = title ? $('#auto-category').value.trim() : '', specs = title ? $('#auto-specs').value.trim() : '';
      const nameQuery = brand && !title.toLocaleLowerCase().includes(brand.toLocaleLowerCase()) ? `${brand} ${title}` : title;
      const referenceImage = imageForSearch();
      const imagePermission = await chrome.permissions.contains({ origins: ['https://*.alicdn.com/*'] });
      const criteria = { mode: 'alternative', name: nameQuery, brand: '', model: '', category, specs, required: '', exclude: '', limit: 10, hasImage: imagePermission, hasReference: true };
      await message('SOURCING_AUTO_UPDATE', { runId, patch: { criteria, reference: { original: referenceImage, image: referenceImage, source: 'image-intake' }, evaluations: {}, selected: [] } });
      phase = '图片搜索'; jobStatus('正在后台打开1688图片搜索并提交参考图。');
      let imageIssue = '';
      try {
        const image = await message('SOURCING_IMAGE_SEARCH', { image: referenceImage, background: true, runId });
        if (!image.submitted) {
          imageIssue = image.message;
          if (/登录|安全验证/.test(imageIssue)) throw Error(imageIssue);
        } else {
          const imageRead = await message('SOURCING_AUTO_CAPTURE', { tabId: image.tabId, channel: 'image', runId, searchToken: image.searchToken, timeoutMs: 35000 });
          added += imageRead.received;
          jobStatus(`图片搜索读取 ${imageRead.received} 条；${nameQuery ? '继续名称搜索。' : '不使用名称搜索。'}`);
        }
      } catch (error) {
        if (/登录|安全验证|停止|离开了1688/.test(error.message)) throw error;
        imageIssue = error.message;
      }
      if (nameQuery) {
        phase = '名称搜索';
        const named = await message('SOURCING_SEARCH', { keyword: nameQuery, background: true, runId });
        const nameRead = await message('SOURCING_AUTO_CAPTURE', { tabId: named.tabId, channel: 'name', runId, searchToken: named.searchToken, timeoutMs: 35000 });
        added += nameRead.received;
      }
      if (!added) throw Error(imageIssue || '本次搜索没有读取到经核验的候选');
      phase = '本地筛选'; jobStatus(`已读取 ${added} 条卡片，按链接合并后正在运行现有文字与图片筛选。`);
      const filtered = await globalThis.ImageGrabAutoResults.scoreRun(runId);
      const summary = globalThis.ImageGrabAutoResults.getSummary();
      jobStatus(`${imageIssue ? '部分搜索完成' : '自动流程已完成'}：读取 ${added} 条页面卡片，本次合并为 ${summary?.total ?? 0} 个候选货源；优先 ${summary?.shortlist ?? 0}，待确认 ${summary?.review ?? 0}，其余 ${summary?.remaining ?? 0}。${imageIssue ? `图片搜索未完成：${imageIssue}。` : ''}${nameQuery ? '' : '未使用名称搜索。'}${imagePermission ? '' : '未做候选图片比对。'}候选尚未加入商品池，也未确认同款。手动筛选候选池未受影响。`);
      status(filtered ? '自动筛选完成；结果保存在本页下方，刷新仍可查看。请检查后勾选需要加入商品池或补全详情的货源。' : '自动筛选没有生成结果，请查看下方状态。');
      finishStatus = filtered ? (imageIssue ? 'partial' : 'complete') : 'paused';
      globalThis.ImageGrabAutoResults.present();
    } catch (error) {
      jobStatus(`${phase}阶段暂停：${error.message}。已收集的候选保存在本页下方。`);
    } finally {
      if (runId) await chrome.runtime.sendMessage({ type: 'SOURCING_AUTO_FINISH', runId, status: finishStatus }).catch(() => {});
      await globalThis.ImageGrabAutoResults.load(runId).catch(error => jobStatus(error.message));
      running = false; $('#auto-stop').hidden = true; $('#auto-run').disabled = !inputImage; $('#auto-reference-file').disabled = false;
    }
  }
  $('#auto-run').addEventListener('click', () => run().catch(error => jobStatus(error.message)));
  $('#auto-stop').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'SOURCING_AUTO_STOP' }); jobStatus('正在请求停止；已收集候选会保留。'); });
  window.addEventListener('resize', () => { if (inputImage && !imageCanvas.hidden) drawCrop(); });
  window.addEventListener('beforeunload', () => { worker?.terminate(); inputImage?.close(); if (inputObjectUrl) URL.revokeObjectURL(inputObjectUrl); });
})();
