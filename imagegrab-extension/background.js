importScripts('offer-data.js', 'detail-options.js', 'detail-job.js', 'similar-search.js', 'ranking-scope.js', 'sourcing-match.js', 'sourcing-store.js', 'sourcing-native.js', 'sourcing-search.js');
const detailJobs = ImageGrabDetailJobs.create(chrome);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === detailJobs.alarm) detailJobs.kick(); });
chrome.runtime.onStartup.addListener(() => detailJobs.kick());
// A worker restart resumes a durable job without opening another research page.
detailJobs.kick();
const STORAGE_KEY = 'imagegrabGalleryState';

function readRankingCards() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const imageUrl = value => /^https?:/i.test(String(value || '')) && !/(icon|logo|avatar|sprite|loading|placeholder)/i.test(String(value || ''));
  const cards = [...document.querySelectorAll('.cgf-product-card')];
  return cards.map(card => {
    let fiber = null;
    const fiberKey = Object.keys(card).find(key => key.startsWith('__reactFiber$'));
    if (fiberKey) fiber = card[fiberKey];
    let data = null;
    for (let depth = 0; fiber && depth < 8; depth += 1, fiber = fiber.return) {
      const candidate = fiber.memoizedProps?.data;
      if (candidate?.id && candidate?.title) { data = candidate; break; }
    }
    const body = clean(card.innerText);
    const title = clean(card.querySelector('.cgf-card-title')?.innerText) || clean(data?.title);
    const id = String(data?.id || '').trim();
    if (!/^\d{5,20}$/.test(id) || !title) return null;
    const images = [data?.image, ...[...card.querySelectorAll('img')].map(img => img.currentSrc || img.src || img.dataset.src)]
      .filter(imageUrl).filter((url, index, all) => all.indexOf(url) === index).slice(0, 8);
    const priceText = (clean(card.querySelector('.cgf-card-price')?.innerText) || clean(data?.price?.formatPrice)).replace(/\s+/g, '');
    let salesText = '';
    for (const item of card.querySelectorAll('.card-meta-item')) {
      const label = clean(item.querySelector('.card-meta-label')?.innerText);
      if (/月销量/.test(label)) {
        const value = clean(item.querySelector('.card-meta-value')?.innerText);
        salesText = [value, label].filter(Boolean).join(' ');
        break;
      }
    }
    return {
      title: title.slice(0, 180),
      url: `https://detail.1688.com/offer/${encodeURIComponent(id)}.html`,
      images,
      priceText: priceText.slice(0, 80),
      salesText: salesText.slice(0, 80),
      moqText: '', rank: '', supplierName: '', supplierUrl: '',
      visibleText: body.slice(0, 1200), sourceType: 'ranking'
    };
  }).filter(Boolean);
}

async function openSimilarSearch(keyword, background = false, runId = '') {
  const clean = normalizeSimilarKeyword(keyword);
  if (!clean) throw Error('商品名称为空，无法搜索同名货源');
  const tab = await chrome.tabs.create({ url: 'https://s.1688.com/selloffer/offer_search.htm', active: !background });
  let searchToken = '';
  const started = Date.now();
  let lastError = '搜索页尚未加载完成';
  while (Date.now() - started < 30000) {
    const current = await chrome.tabs.get(tab.id);
    if (/login|passport|punish|captcha|security/i.test(current.url || '')) throw Error('1688要求登录或安全验证，未自动填写搜索词');
    // 1688 may keep the document in "loading" while its client app is already
    // interactive. The search input is the useful readiness signal.
    try {
      if (runId && !searchToken) {
        const [before] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: read1688SearchState });
        if (before?.result?.challenge) throw Error('1688要求登录或安全验证，未自动填写搜索词');
        if (!before?.result?.count) { lastError = '正在等待搜索前页面就绪，以防读取默认推荐'; await new Promise(r=>setTimeout(r,700)); continue; }
        searchToken = await registerSourcingSearch(tab.id, 'name', clean, runId, before?.result?.signature);
      }
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: fill1688Search, args: [clean] });
      if (result?.result?.ok) return { ok: true, tabId: tab.id, keyword: result.result.keyword, searchToken };
      lastError = result?.result?.error || lastError;
    } catch (error) { if (/登录|安全验证|停止|替换/.test(error.message)) throw error; lastError = error.message; }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw Error(lastError);
}

async function openRankingScope(input) {
  const scope = ImageGrabRankingScope.normalize(input || {});
  const url = ImageGrabRankingScope.toUrl(scope);
  const tab = await chrome.tabs.create({ url, active: false });
  const started = Date.now();
  let lastError = '榜单页面尚未加载完成';
  while (Date.now() - started < 30000) {
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'START_RANKING_AUTO', scope });
      if (result?.ok) return { ok: true, tabId: tab.id, scope, url };
      lastError = result?.error || lastError;
    } catch (error) { lastError = error.message; }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw Error(lastError);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type?.startsWith('SOURCING_')){
    const senderUrl=sender.url?.split(/[?#]/)[0];
    if(sender.id!==chrome.runtime.id||![chrome.runtime.getURL('sourcing.html'),chrome.runtime.getURL('research.html')].includes(senderUrl)){sendResponse({ok:false,error:'请从选品研究台的寻源页操作'});return false;}
    handleSourcing(message).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if (message?.type === 'DETAIL_JOB_STATUS') {
    if (sender.id !== chrome.runtime.id || sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL('research.html')) {
      sendResponse({ ok: false, error: '请从选品研究台检查任务状态' }); return false;
    }
    sendResponse({ ok: true, supported: true, recaptureCompletedSupported: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (message?.type === 'OPEN_SIMILAR_SEARCH') {
    if (sender.id !== chrome.runtime.id || sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL('research.html')) {
      sendResponse({ ok: false, error: '请从选品研究台发起同名货源搜索' }); return false;
    }
    openSimilarSearch(message.keyword).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'OPEN_RANKING_SCOPE') {
    if (sender.id !== chrome.runtime.id || sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL('research.html')) {
      sendResponse({ ok: false, error: '请从选品研究台设置榜单范围' }); return false;
    }
    openRankingScope(message.scope).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (['DETAIL_JOB_START', 'DETAIL_JOB_STOP', 'DETAIL_JOB_RESUME'].includes(message?.type)) {
    if (sender.id !== chrome.runtime.id || sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL('research.html')) {
      sendResponse({ ok: false, error: '请从选品研究台操作详情补全' }); return false;
    }
    detailJobs.handle(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'READ_RANKING_CARDS') {
    const url = sender.url || '';
    if (!sender.tab?.id || sender.frameId !== 0 || !/^https:\/\/air\.1688\.com\/kapp\/1688-global\/sales\/ranking(?:[/?#]|$)/i.test(url)) {
      sendResponse({ ok: false, error: '当前页面不是受支持的 1688 榜单页面' });
      return false;
    }
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
      world: 'MAIN', func: readRankingCards
    }).then(results => sendResponse({ ok: true, products: results?.[0]?.result || [] }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'OPEN_GALLERY') {
    chrome.storage.local.set({ [STORAGE_KEY]: {
      images: Array.isArray(message.images) ? message.images : [],
      pageTitle: message.pageTitle || '商品图片', sourceUrl: message.sourceUrl || '', createdAt: Date.now()
    }}).then(() => chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') }))
      .then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'DOWNLOAD_ORIGINAL') {
    chrome.downloads.download({ url: message.url, filename: message.filename || '商品图.png', saveAs: false, conflictAction: 'uniquify' })
      .then(id => sendResponse({ ok: true, id })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'OPEN_RESEARCH') {
    const state = { products: Array.isArray(message.products) ? message.products : [], capturedAt: Date.now(), sourceUrl: message.sourceUrl || '', pageTitle: message.pageTitle || '', scope: globalThis.ImageGrabRankingScope?.fromUrl(message.sourceUrl || '') || null };
    chrome.storage.local.set({ imagegrabResearchCapture: state })
      .then(() => chrome.tabs.create({ url: chrome.runtime.getURL('research.html'), active: false }))
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'FINISH_RESEARCH_AUTO') {
    chrome.storage.local.get('imagegrabResearchAutoJob')
      .then(result => {
        const job = result.imagegrabResearchAutoJob || {};
        return chrome.storage.local.set({ imagegrabResearchCapture: {
          products: Array.isArray(job.products) ? job.products.slice(0, 1000) : [],
          capturedAt: Date.now(), sourceUrl: job.sourceUrl || '', pageTitle: job.pageTitle || '',
          pageCount: job.pageCount || 0, finishReason: job.finishReason || '已结束', scope: job.scope || null
        }});
      })
      .then(() => chrome.tabs.create({ url: chrome.runtime.getURL('research.html'), active: false }))
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.set({ imagegrabVersion: chrome.runtime.getManifest().version }));
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('research.html') }));

let sourcingStore;
async function registerSourcingSearch(tabId, channel, keyword, runId, baselineSignature = '') {
  const job=(await chrome.storage.local.get('imagegrabSourcingAutoJob')).imagegrabSourcingAutoJob;
  if(!job?.running||job.stop||job.runId!==runId)throw Error('自动寻源已停止或任务已替换');
  const token=crypto.randomUUID();
  job.tabs=[...(job.tabs||[]),{token,tabId,channel,keyword,baselineSignature,startedAt:Date.now()}];
  await chrome.storage.local.set({imagegrabSourcingAutoJob:job});
  return token;
}
function sourcePage(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='1688.com'||u.hostname.endsWith('.1688.com'))&&!['detail.1688.com','offer.1688.com'].includes(u.hostname);}catch{return false;}}
async function handleSourcing(message){
  if(!sourcingStore)sourcingStore=ImageGrabSourcingStore.create(chrome,ImageGrabSourcingMatch);
  if(message.type==='SOURCING_AUTO_BEGIN'){
    const job=(await chrome.storage.local.get('imagegrabSourcingAutoJob')).imagegrabSourcingAutoJob;
    if(job?.running)throw Error('已有截图自动寻源任务正在运行');
    if(typeof message.runId!=='string'||message.runId.length<8)throw Error('截图自动寻源缺少有效任务编号');
    await sourcingStore.beginAuto(message.runId);
    await chrome.storage.local.set({imagegrabSourcingAutoJob:{running:true,stop:false,runId:message.runId,startedAt:Date.now(),tabs:[]}});
    return {ok:true};
  }
  if(message.type==='SOURCING_AUTO_STOP'){
    const job=(await chrome.storage.local.get('imagegrabSourcingAutoJob')).imagegrabSourcingAutoJob||{};
    await chrome.storage.local.set({imagegrabSourcingAutoJob:{...job,stop:true}});
    return {ok:true};
  }
  if(message.type==='SOURCING_AUTO_FINISH'){
    const job=(await chrome.storage.local.get('imagegrabSourcingAutoJob')).imagegrabSourcingAutoJob||{};
    if(job.runId!==message.runId)throw Error('任务已替换，未修改当前自动寻源结果');
    if(job.runId)await sourcingStore.finishAuto(job.runId,message.status||'complete');
    await chrome.storage.local.set({imagegrabSourcingAutoJob:{...job,running:false,stop:false,finishedAt:Date.now()}});
    return {ok:true};
  }
  if(message.type==='SOURCING_AUTO_CAPTURE'){
    const deadline=Date.now()+Math.max(5000,Math.min(60000,Number(message.timeoutMs)||35000));
    let lastError='搜索结果仍在加载',stableKey='',stableSince=0;
    while(Date.now()<deadline){
      const job=(await chrome.storage.local.get('imagegrabSourcingAutoJob')).imagegrabSourcingAutoJob;
      if(!job?.running||job.stop||job.runId!==message.runId)throw Error('自动寻源已停止或任务已替换');
      const expected=job.tabs?.find(t=>t.token===message.searchToken&&t.tabId===Number(message.tabId)&&t.channel===message.channel);
      if(!expected)throw Error('缺少本次搜索凭证；没有读取默认推荐列表');
      let tab;try{tab=await chrome.tabs.get(Number(message.tabId));}catch{throw Error('搜索标签页已关闭');}
      if(/login|passport|punish|captcha|security/i.test(tab.url||''))throw Error('1688要求登录或安全验证；任务已暂停，没有尝试绕过验证');
      if(!sourcePage(tab.url))throw Error('搜索页面离开了1688结果页，未继续读取');
      try{
        const [inspection]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:read1688SearchState});
        const state=inspection?.result,ready=ImageGrabSearchReady.check(state,expected,tab);
        if(ready.fatal)throw Error(ready.fatal);
        if(!ready.ok){lastError=ready.reason;stableKey='';stableSince=0;}
        else {
          const key=`${state.url}|${state.signature}`;
          if(key!==stableKey){stableKey=key;stableSince=Date.now();}
          if(Date.now()-stableSince>=1400){
        const result=await chrome.tabs.sendMessage(tab.id,{type:'SOURCING_READ_CANDIDATES'});
        if(result?.error&&/登录|安全验证/.test(result.error))throw Error(result.error);
        const current=await chrome.tabs.get(tab.id);
        const [after]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:read1688SearchState});
        const verified=ImageGrabSearchReady.check(after?.result,expected,current);
        if(verified.fatal)throw Error(verified.fatal);
        const finalJob=(await chrome.storage.local.get('imagegrabSourcingAutoJob')).imagegrabSourcingAutoJob;
        if(!finalJob?.running||finalJob.stop||finalJob.runId!==message.runId)throw Error('自动寻源已停止或任务已替换');
        if(result?.ok&&result.sourceUrl===state.url&&verified.ok&&after.result.signature===state.signature&&result.products?.length)
          return sourcingStore.addAuto(result.products,{channel:expected.channel,url:state.url,capturedAt:Date.now(),auto:true,searchToken:expected.token,verified:true},message.runId);
        lastError=result?.error||lastError;
          }
        }
      }catch(error){if(/登录|安全验证|停止|替换/.test(error.message))throw error;lastError=error.message||lastError;stableKey='';stableSince=0;}
      await new Promise(resolve=>setTimeout(resolve,800));
    }
    throw Error(`等待候选超时：${lastError}。搜索页保留在后台，可切回手动筛选读取。`);
  }
  if(message.type==='SOURCING_GET')return {ok:true,state:await sourcingStore.get()};
  if(message.type==='SOURCING_UPDATE')return sourcingStore.update(message.patch||{});
  if(message.type==='SOURCING_AUTO_GET'){const run=await sourcingStore.getAuto();if(!run||run.id!==message.runId)throw Error('找不到本次截图自动寻源结果');return {ok:true,run};}
  if(message.type==='SOURCING_AUTO_UPDATE')return sourcingStore.updateAuto(message.runId,message.patch||{});
  if(message.type==='SOURCING_AUTO_CLEAR')return sourcingStore.clearAuto(message.runId);
  if(message.type==='SOURCING_CLEAR')return sourcingStore.clear();
  if(message.type==='SOURCING_TABS')return {ok:true,tabs:(await chrome.tabs.query({})).filter(t=>sourcePage(t.url)).map(({id,title,url})=>({id,title,url}))};
  if(message.type==='SOURCING_CAPTURE'){
    const tab=await chrome.tabs.get(message.tabId);if(!sourcePage(tab.url))throw Error('请选择1688结果页，不能读取其他网站');
    let result;try{result=await chrome.tabs.sendMessage(tab.id,{type:'SOURCING_READ_CANDIDATES'});}catch{throw Error('当前1688标签页尚未加载新版插件，请先刷新该页再读取');}
    if(!result?.ok)throw Error(result?.error||'未读取到商品卡片');
    if(!result.products?.length)throw Error('当前页面未读到商品卡片；请完成搜索并等待列表加载');
    return sourcingStore.add(result.products,{channel:message.channel==='image'?'image':'name',url:tab.url,capturedAt:Date.now()});
  }
  if(message.type==='SOURCING_FROM_POOL'){
    const data=(await chrome.storage.local.get('imagegrabResearchData')).imagegrabResearchData||{};
    const rows=(data.offers||[]).map(offer=>{const p=data.products?.find(x=>x.id===offer.productId)||{};return {...p,...offer,title:p.title,images:p.images,url:offer.url};});
    return sourcingStore.add(rows,{channel:'pool',capturedAt:Date.now()});
  }
  if(message.type==='SOURCING_SEARCH')return openSimilarSearch(message.keyword,message.background===true,message.runId||'');
  if(message.type==='SOURCING_IMAGE_SEARCH'){
    if(typeof message.image!=='string'||!/^data:image\/jpeg;base64,/.test(message.image)||message.image.length>4*1024*1024)throw Error('请先上传有效参考图');
    const tab=await chrome.tabs.create({url:'https://s.1688.com/selloffer/offer_search.htm',active:message.background!==true});
    let searchToken='';
    for(let i=0;i<20;i++){
      const current=await chrome.tabs.get(tab.id);
      if(/login|passport|punish|captcha/i.test(current.url||''))return {ok:true,message:'1688要求登录或安全验证；完成后用平台相机按钮上传参考图。'};
      if(current.status==='complete'){
        if(!sourcePage(current.url))throw Error('搜索页面已离开1688，未提交参考图');
        if(message.runId){
          const [before]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:read1688SearchState});
          searchToken=await registerSourcingSearch(tab.id,'image','',message.runId,before?.result?.signature);
        }
        const rows=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'MAIN',func:upload1688Reference,args:[message.image]});
        const outcome=rows[0]?.result;return {ok:true,tabId:tab.id,searchToken,submitted:Boolean(outcome?.ok),message:outcome?.message||outcome?.error||'请在1688使用原生相机按钮上传参考图，再回到筛选页读取候选。'};
      }
      await new Promise(r=>setTimeout(r,500));
    }
    return {ok:true,message:'1688搜索页仍在加载；请在页面中使用相机按钮上传参考图，再回到筛选页读取候选。'};
  }
  if(['SOURCING_ADMIT','SOURCING_ENRICH'].includes(message.type)){
    if((await chrome.storage.local.get('imagegrabResearchAutoJob')).imagegrabResearchAutoJob?.running)throw Error('请先停止正在运行的榜单采集');
    const result=await sourcingStore.admit(message.urls,message.runId||'');
    if(message.type==='SOURCING_ENRICH'){
      const task=await detailJobs.handle({type:'DETAIL_JOB_START',productIds:result.productIds,offerUrls:result.offerUrls});
      if(!task.ok)throw Error(`候选已加入商品池；${task.error}`);return {...result,jobId:task.jobId};
    }
    return result;
  }
  throw Error('未知筛选操作');
}
