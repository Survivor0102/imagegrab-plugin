/* Isolated sourcing pool. Only explicit admission can write to the research archive. */
(() => {
  'use strict';
  const KEY='imagegrabSourcingData', ARCHIVE='imagegrabResearchData';
  function create(api,match){
    let chain=Promise.resolve();
    const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
    const get=async()=> (await api.storage.local.get(KEY))[KEY]||{criteria:{mode:'alternative',limit:10},candidates:[],selected:[],reference:null};
    const getAuto=async()=> (await api.storage.local.get('imagegrabSourcingAutoRun')).imagegrabSourcingAutoRun||null;
    async function beginAuto(runId){return serial(async()=>{const run={id:runId,status:'running',criteria:{mode:'alternative',limit:10},candidates:[],selected:[],evaluations:{},reference:null,startedAt:Date.now()};await api.storage.local.set({imagegrabSourcingAutoRun:run});return {ok:true,run};});}
    async function addAuto(rows,source,runId){return serial(async()=>{const run=await getAuto();if(!run||run.id!==runId||run.status!=='running')throw Error('截图自动寻源任务已失效');run.candidates=match.dedupe([...run.candidates,...rows.map(row=>({...row,sources:[source]}))]);if(source.channel==='image'&&source.verified===true)run.criteria={...run.criteria,nativeImageSearch:true};run.updatedAt=Date.now();await api.storage.local.set({imagegrabSourcingAutoRun:run});return {ok:true,total:run.candidates.length,received:rows.length};});}
    async function updateAuto(runId,patch){return serial(async()=>{const run=await getAuto();if(!run||run.id!==runId)throw Error('找不到本次截图自动寻源结果');for(const key of ['criteria','reference','selected','evaluations'])if(Object.hasOwn(patch,key))run[key]=patch[key];await api.storage.local.set({imagegrabSourcingAutoRun:run});return {ok:true};});}
    async function finishAuto(runId,status='complete'){return serial(async()=>{const run=await getAuto();if(!run||run.id!==runId)return {ok:false};run.status=status;run.finishedAt=Date.now();await api.storage.local.set({imagegrabSourcingAutoRun:run});return {ok:true};});}
    async function clearAuto(runId){return serial(async()=>{const run=await getAuto();if(!run||run.id!==runId)throw Error('找不到本次截图自动寻源结果');run.candidates=[];run.selected=[];run.evaluations={};run.status='cleared';await api.storage.local.set({imagegrabSourcingAutoRun:run});return {ok:true};});}
    async function add(rows,source){return serial(async()=>{const state=await get();state.candidates=match.dedupe([...state.candidates,...rows.map(row=>({...row,sources:[source]}))]);state.updatedAt=Date.now();state.evaluations={};state.selected=[];await api.storage.local.set({[KEY]:state});return {ok:true,total:state.candidates.length,received:rows.length};});}
    async function update(patch){return serial(async()=>{const state=await get();for(const key of ['criteria','reference','selected','evaluations'])if(Object.hasOwn(patch,key))state[key]=patch[key];await api.storage.local.set({[KEY]:state});return {ok:true};});}
    async function admit(urls,runId){return serial(async()=>{
      const job=(await api.storage.local.get('imagegrabDetailJob')).imagegrabDetailJob;
      if(job?.status==='running')throw Error('请先停止正在运行的详情补全任务');
      const state=runId?await getAuto():await get();if(runId&&state?.id!==runId)throw Error('本次自动寻源结果已被新任务替换，请重新筛选');
      const selected=new Set((urls||[]).map(match.canonical).filter(Boolean));
      const rows=state.candidates.filter(x=>selected.has(match.canonical(x.url)));
      if(!rows.length||rows.length>50)throw Error('请勾选1到50个候选');
      const data=(await api.storage.local.get(ARCHIVE))[ARCHIVE]||{products:[],offers:[],certificates:[]};const productIds=[];
      for(const row of rows){
        const url=match.canonical(row.url);let offer=data.offers.find(o=>match.canonical(o.url)===url);
        let product=data.products.find(p=>p.id===offer?.productId)||data.products.find(p=>match.canonical(p.sourceUrl)===url);
        if(!product){product={id:crypto.randomUUID(),title:row.title||'待核候选',sourceType:'similar',sourceUrl:url,images:row.images||[],specs:row.visibleText||'',createdAt:Date.now(),updatedAt:Date.now()};data.products.unshift(product);}
        if(!offer){offer={id:crypto.randomUUID(),productId:product.id,url,sourceType:'similar',supplierName:row.supplierName||'',supplierUrl:row.supplierUrl||'',priceText:row.priceText||'',salesText:row.salesText||'',moqText:row.moqText||'',capturedAt:Date.now()};data.offers.unshift(offer);}
        offer.sourcingEvidence={criteria:state.criteria,sources:row.sources,evaluation:state.evaluations?.[url]||null,admittedAt:Date.now(),identity:'候选，尚未确认同款'};
        productIds.push(product.id);
      }
      await api.storage.local.set({[ARCHIVE]:data});return {ok:true,productIds:[...new Set(productIds)],offerUrls:rows.map(x=>match.canonical(x.url)),count:rows.length};
    });}
    async function clear(){return serial(async()=>{const state=await get();state.candidates=[];state.selected=[];state.evaluations={};await api.storage.local.set({[KEY]:state});return {ok:true};});}
    return {get,getAuto,beginAuto,addAuto,updateAuto,finishAuto,clearAuto,add,update,admit,clear};
  }
  globalThis.ImageGrabSourcingStore={KEY,create};
})();
