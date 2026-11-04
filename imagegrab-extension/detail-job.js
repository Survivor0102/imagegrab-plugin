/* Durable second-stage queue. Only one background product tab is owned by a job. */
(() => {
  'use strict';
  const KEY='imagegrabDetailJob', DATA='imagegrabResearchData', ALARM='imagegrab-detail-queue';
  function canonical(value){try{const u=new URL(value);const m=u.pathname.match(/^\/offer\/(\d+)\.html$/);return u.protocol==='https:'&&['detail.1688.com','offer.1688.com'].includes(u.hostname)&&m?`https://detail.1688.com/offer/${m[1]}.html`:'';}catch{return '';}}
  function covered(offer){const c=offer.details?.optionCollection;return c?.status==='complete'||Boolean(c&&!c.status&&c.collected?.length&&c.collected.length===c.expectedCombinations&&!c.skipped?.length);}
  function makeQueue(data,productIds){const ids=Array.isArray(productIds)?new Set(productIds):null;const urls=new Set();return (data.offers||[]).filter(o=>!ids||ids.has(o.productId)).flatMap(o=>{const url=canonical(o.url);if(!url||urls.has(url))return [];urls.add(url);return [{url,offerId:o.id,productId:o.productId,title:data.products?.find(p=>p.id===o.productId)?.title||url,status:covered(o)?'skipped':'pending',attempts:0}];});}
  function mergeCapture(data,item,row,offerData){
    if(canonical(row.url)!==item.url||row.captureKind!=='detail')throw Error('返回的商品与队列链接不一致，未保存');
    const offer=(data.offers||[]).find(o=>o.id===item.offerId&&canonical(o.url)===item.url);
    const product=(data.products||[]).find(p=>p.id===offer?.productId);
    if(!offer||!product)throw Error('该货源已被删除或修改，未保存');
    if(covered(offer)&&row.optionCollection?.status!=='complete')throw Error('本次只读到部分规格，已保留原完整资料');
    offer.details=offerData.fromCapture(row);
    for(const key of ['supplierName','supplierUrl','priceText','moqText','priceContext','shipFrom','supplierMetrics','supplierYears','supplierCategory','supplierRating'])if(row[key])offer[key]=row[key];
    offer.detailSourceUrl=item.url;offer.detailCapturedAt=row.capturedAt;
    const observations=offer.salesObservations||[];
    if(!observations.length&&offer.salesText)observations.push({text:offer.salesText,metric:offer.sourceType==='ranking'?'ranking-displayed-sales':'page-displayed-sales',sourceUrl:offer.sourceUrl||offer.url,capturedAt:offer.capturedAt});
    for(const observation of row.salesObservations||[])if(!observations.some(x=>x.text===observation.text&&x.metric===observation.metric&&x.sourceUrl===observation.sourceUrl))observations.push(observation);
    offer.salesObservations=observations;offer.salesText=observations.map(o=>o.text).join(' / ');
    if(!product.detailSourceUrl||canonical(product.detailSourceUrl)===item.url){
      product.title=row.title||product.title;
      for(const key of ['brand','category','origin'])if(!product[key]&&row[key])product[key]=row[key];
      for(const key of ['attributes','skus','selectedOptions','media','videoUrls','services','packaging','promotionText','certificateEvidence','optionCollection'])if(row[key]!==undefined)product[key]=row[key];
      if(row.specs)product.specs=row.specs;
      product.images=[...new Set([...(row.images||[]),...(product.images||[])])];
      product.detailSourceUrl=item.url;product.detailCapturedAt=row.capturedAt;product.updatedAt=row.capturedAt;
    }
    return data;
  }
  function create(api, options={}){
    const sleep=options.sleep|| (ms=>new Promise(r=>setTimeout(r,ms))),now=options.now||Date.now;
    const timing={poll:1000,readyTimeout:45000,between:12000,...options.timing};
    let runner=null, command=Promise.resolve();
    const read=async()=> (await api.storage.local.get(KEY))[KEY];
    const save=async job=>{job.updatedAt=now();await api.storage.local.set({[KEY]:job});};
    const arm=()=>api.alarms.create(ALARM,{periodInMinutes:0.5});
    const serial=fn=>{const next=command.then(fn);command=next.catch(()=>{});return next;};
    const valid=async id=>{const j=await read();if(!j||j.id!==id||j.status!=='running'||j.stopRequested)throw Error('已停止');return j;};
    async function execute(tabId,func,args=[]){const rows=await api.scripting.executeScript({target:{tabId,frameIds:[0]},func,args});if(!rows?.[0])throw Error('商品脚本未返回结果');return rows[0].result;}
    async function ownTab(job){
      if(job.tabId){try{const tab=await api.tabs.get(job.tabId);if(job.tabUrl ? canonical(tab.pendingUrl||tab.url)===job.tabUrl : tab.url==='about:blank')return tab.id;}catch{}job.tabId=null;job.tabUrl='';}
      const tab=await api.tabs.create({url:'about:blank',active:false});job.tabId=tab.id;job.tabUrl='';await save(job);return tab.id;
    }
    async function closeOwned(job){if(!job?.tabId)return;try{const t=await api.tabs.get(job.tabId);if((job.tabUrl && canonical(t.pendingUrl||t.url)===job.tabUrl)||t.url==='about:blank')await api.tabs.remove(job.tabId);}catch{}job.tabId=null;job.tabUrl='';}
    async function ready(job,item){
      const start=now();
      while(now()-start<timing.readyTimeout){
        await valid(job.id);
        const tab=await api.tabs.get(job.tabId);
        if(/login\.|\/punish|captcha|passport\./i.test(tab.url||''))throw Error('需要登录或安全验证');
        if(canonical(tab.pendingUrl||tab.url)!==item.url)throw Error('采集标签页已离开目标商品');
        let status;
        try{status=await execute(job.tabId,()=>({url:location.href,title:document.title,ready:document.readyState!=='loading'&&Boolean(document.querySelector('#productTitle .title-content h1')?.innerText && document.querySelector('#mainPrice .price-info')?.innerText && document.querySelector('#skuSelection')),challenge:Boolean(document.querySelector('iframe[src*="captcha"],iframe[src*="punish"]'))}));}catch{await sleep(timing.poll);continue;}
        if(status.challenge||/安全验证|访问验证|请完成验证|验证码|滑动验证|访问异常/.test(status.title))throw Error('需要登录或安全验证');
        // A pending navigation can still expose the previous product's loaded DOM.
        if(status.ready&&canonical(status.url)===item.url&&tab.status!=='loading')return;
        await sleep(timing.poll);
      }
      throw Error('等待商品标题、报价和规格加载超时');
    }
    async function capture(job,item){
      await api.scripting.executeScript({target:{tabId:job.tabId,frameIds:[0]},files:['detail-capture.js','detail-options.js']});
      let settled=false;
      const result=execute(job.tabId,async request=>{
        try{return {ok:true,row:await globalThis.imagegrabCollectOptions(request)};}catch(error){return {ok:false,error:error.message};}
      },[{jobId:job.id,offerId:item.url.match(/\/offer\/(\d+)/)[1]}]);
      result.then(()=>{settled=true;},()=>{settled=true;});
      // API calls keep an active collection observable across worker idle periods.
      while(!settled){await sleep(timing.poll);await valid(job.id);}
      const outcome=await result;
      if(!outcome?.ok)throw Error(outcome?.error||'商品详情采集失败');
      return outcome.row;
    }
    async function run(){
      let job=await read();
      if(!job||job.status!=='running')return;
      // If Chrome suspended/restarted the worker during one item, retry that item.
      for(const item of job.items)if(item.status==='running')item.status='pending';
      await save(job);
      try{
        while(true){
          job=await read();if(!job||job.status!=='running')return;
          if(job.stopRequested){job.status='paused';job.reason='用户停止';await closeOwned(job);await save(job);return;}
          const item=job.items.find(i=>i.status==='pending');
          if(!item){job.status=job.items.some(i=>['failed','partial'].includes(i.status))?'finished_with_errors':'complete';job.reason=job.status==='complete'?'详情补全完成':'本轮结束，部分商品未完成，可重试';await closeOwned(job);await save(job);return;}
          if(job.nextAt>now()){await sleep(Math.min(job.nextAt-now(),timing.poll));continue;}
          const index=job.items.indexOf(item);job.current=index;
          if(item.attempts>=3){item.status='failed';item.error='连续中断次数达到3次，请检查商品页面后重试';await save(job);continue;}
          item.status='running';item.attempts++;await save(job);
          try{
            const tabId=await ownTab(job);await valid(job.id);
            job.tabUrl=item.url;await save(job);await api.tabs.update(tabId,{url:item.url,active:false});
            await ready(job,item);
            const row=await capture(job,item);await valid(job.id);
            const data=(await api.storage.local.get(DATA))[DATA]||{products:[],offers:[],certificates:[]};
            mergeCapture(data,item,row,globalThis.ImageGrabOfferData);
            await api.storage.local.set({[DATA]:data});
            // Re-read stop requests arriving during capture/storage operations.
            const current=await read();if(!current||current.id!==job.id)return;
            job=current;Object.assign(job.items[index],{status:row.optionCollection?.status==='complete'?'complete':'partial',error:row.optionCollection?.reason||'',skuCount:row.skus.length,imageCount:row.media.length,completedAt:now()});
          }catch(error){
            const current=await read();if(!current||current.id!==job.id)return;job=current;
            const stopped=job.stopRequested||error.message==='已停止';
            const blocked=/登录|验证|离开目标商品/.test(error.message);
            Object.assign(job.items[index],{status:stopped?'pending':blocked?'blocked':'failed',error:error.message});
            if(stopped||blocked){job.status='paused';job.reason=stopped?'用户停止':error.message;if(stopped)await closeOwned(job);await save(job);return;}
          }
          job.nextAt=now()+timing.between;await save(job);
        }
      }finally{const current=await read();if(current?.status!=='running')await api.alarms.clear(ALARM);}
    }
    function kick(){if(!runner)runner=run().catch(async error=>{const job=await read();if(job?.status==='running'){job.status='paused';job.reason=error.message;await save(job);}}).finally(()=>{runner=null;});return runner;}
    async function handle(message){return serial(async()=>{
      let job=await read();
      if(message.type==='DETAIL_JOB_STOP'){if(job?.status==='running'){job.stopRequested=true;await save(job);kick();}return {ok:true};}
      if(job?.status==='running')return {ok:false,error:'已有详情补全任务正在运行'};
      if(runner)return {ok:false,error:'上一任务正在收尾，请稍后重试'};
      if(message.type==='DETAIL_JOB_RESUME'){
        if(!job)return {ok:false,error:'没有可继续的任务'};
        for(const i of job.items)if(!['complete','skipped'].includes(i.status)){i.status='pending';i.attempts=0;i.error='';}
        job.status='running';job.stopRequested=false;job.reason='';
      }else{
        const ranking=(await api.storage.local.get('imagegrabResearchAutoJob')).imagegrabResearchAutoJob;
        if(ranking?.running)return {ok:false,error:'请先停止榜单采集，再补全详情'};
        const data=(await api.storage.local.get(DATA))[DATA]||{};
        const items=makeQueue(data,message.productIds);
        if(!items.some(i=>i.status==='pending'))return {ok:false,error:'所选范围没有待补全的1688货源，已有完整规格的商品会自动跳过'};
        job={id:crypto.randomUUID(),status:'running',items,current:-1,createdAt:now(),stopRequested:false};
      }
      await save(job);await arm();kick();return {ok:true,jobId:job.id};
    });}
    return {handle,kick,read,alarm:ALARM};
  }
  globalThis.ImageGrabDetailJobs={create,makeQueue,mergeCapture,canonical,covered,KEY,DATA};
})();
