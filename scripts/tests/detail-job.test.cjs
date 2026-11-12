const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const context=vm.createContext({URL,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout});
for(const file of ['offer-data.js','detail-job.js'])vm.runInContext(fs.readFileSync(path.join(root,'imagegrab-extension',file),'utf8'),context);
const jobs=context.ImageGrabDetailJobs;
const clone=x=>JSON.parse(JSON.stringify(x));
function capture(url,partial=false){return {captureKind:'detail',url,title:'真实详情商品',capturedAt:1234,brand:'品牌',shipFrom:'浙江金华',supplierName:'实际供应商',skus:[{value:'银色 / 10cm',priceText:'¥0.02',imageUrl:'https://images.test/silver.jpg'}],media:[{role:'sku-option',url:'https://images.test/silver.jpg'}],images:['https://images.test/silver.jpg'],optionCollection:{status:partial?'partial':'complete',expectedCombinations:1,collected:[{}],skipped:[],reason:partial?'部分选项不可选':''},salesObservations:[{text:'已售10万+',metric:'detail-displayed-sales',sourceUrl:url}]};}
function fixture(options={}){
  const store={imagegrabResearchData:{products:[{id:'p1',title:'榜单商品',sourceType:'ranking',rank:'1',notes:'保留手写备注'},{id:'p2',title:'商品二'}],offers:[{id:'o1',productId:'p1',url:'https://detail.1688.com/offer/123.html',salesText:'1万 月销量',sourceType:'ranking'},{id:'o2',productId:'p2',url:'https://detail.1688.com/offer/456.html'}],certificates:[{number:'保留证书'}]}};
  const tabs=new Map(),visits=[],closed=[],changes=[],listeners=new Set();let next=90,clock=0;
  const api={storage:{local:{get:async key=>({[key]:clone(store[key]??null)}),set:async values=>{for(const [key,v]of Object.entries(values)){store[key]=clone(v);changes.push(key);}}}},alarms:{create:async()=>{},clear:async()=>{}},tabs:{create:async args=>{assert.equal(args.active,false);const t={id:++next,url:args.url};tabs.set(t.id,t);return t;},get:async id=>{if(!tabs.has(id))throw Error('Tab missing');return clone(tabs.get(id));},update:async(id,args)=>{assert.equal(args.active,false);tabs.get(id).url=args.url;visits.push(args.url);return clone(tabs.get(id));},remove:async id=>{closed.push(id);tabs.delete(id);}},scripting:{executeScript:async args=>{
    if(args.files)return [{result:null}];
    const url=tabs.get(args.target.tabId)?.url;
    if(!args.args?.length){
      if(options.onProbe)return [{result:await options.onProbe(tabs.get(args.target.tabId),store)}];
      return [{result:{url,title:options.blocked?'安全验证':'商品',ready:!(options.removed&&url.includes('/123.html')),unavailable:Boolean(options.removed&&url.includes('/123.html'))}}];
    }
    if(options.onCapture)await options.onCapture(store,tabs,args);
    if(options.error&&url.includes(options.error))return [{result:{ok:false,error:'读取模板失败'}}];
    return [{result:{ok:true,row:capture(url,options.partial)}}];
  }}};
  api.tabs.onUpdated={addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)};
  const update=api.tabs.update;api.tabs.update=async(id,args)=>{const result=await update(id,args);if(options.onNavigate)await options.onNavigate(tabs.get(id),listeners);return result;};
  const engine=jobs.create(api,{sleep:async()=>{clock+=100;await new Promise(r=>setImmediate(r));},now:()=>clock,timing:{poll:1,readyTimeout:4000,between:0}});
  return {api,engine,store,tabs,visits,closed,changes,listeners};
}
test('queue accepts only real 1688 offer hosts, deduplicates tracking URLs and skips covered offers',()=>{
  const data={offers:[{id:'a',productId:'p',url:'https://detail.1688.com/offer/123.html?x=1',details:{optionCollection:{status:'complete'}}},{id:'b',productId:'p',url:'https://detail.1688.com/offer/123.html?x=2'},{id:'c',productId:'q',url:'https://evil.test/detail.1688.com/offer/999.html'},{id:'d',productId:'q',url:'https://offer.1688.com/offer/456.html'}]};
  assert.equal(jobs.makeQueue(data).length,2);assert.equal(jobs.makeQueue(data,['p'])[0].status,'skipped');assert.equal(jobs.makeQueue(data,[]).length,0);
});
test('second stage visits links sequentially, saves per-offer details and preserves ranking/user fields',async()=>{
  const f=fixture();assert.equal((await f.engine.handle({type:'DETAIL_JOB_START'})).ok,true);await f.engine.kick();
  const j=f.store.imagegrabDetailJob,d=f.store.imagegrabResearchData;
  assert.equal(j.status,'complete');assert.deepEqual(f.visits,['https://detail.1688.com/offer/123.html','https://detail.1688.com/offer/456.html']);assert.equal(f.closed.length,1);
  assert.equal(d.offers[0].details.skus[0].priceText,'¥0.02');assert.equal(d.offers[0].shipFrom,'浙江金华');assert.equal(d.products[0].rank,'1');assert.equal(d.products[0].notes,'保留手写备注');assert.equal(d.certificates[0].number,'保留证书');assert.equal(d.offers[0].salesObservations.length,2);assert.equal(d.offers[0].details.optionCollection.status,'complete');
});
test('recapture is opt-in and still respects product scope, offer allowlist and URL deduplication',()=>{
  const data={offers:[{id:'a',productId:'p1',url:'https://detail.1688.com/offer/123.html',details:{optionCollection:{status:'complete'}}},{id:'duplicate',productId:'p1',url:'https://detail.1688.com/offer/123.html?tracking=1'},{id:'b',productId:'p2',url:'https://detail.1688.com/offer/456.html',details:{optionCollection:{status:'complete'}}}]};
  assert.equal(jobs.makeQueue(data,['p1'])[0].status,'skipped');
  assert.equal(jobs.makeQueue(data,['p1'],undefined,{recaptureCompleted:'true'})[0].status,'skipped');
  const queue=jobs.makeQueue(data,['p1'],['https://detail.1688.com/offer/123.html?x=1','https://detail.1688.com/offer/456.html'],{recaptureCompleted:true});
  assert.equal(queue.length,1);assert.equal(queue[0].offerId,'a');assert.equal(queue[0].status,'pending');
  assert.equal(jobs.makeQueue(data,['p1'],[],{recaptureCompleted:true}).length,0);
});
test('scoped recapture updates the same completed offer and preserves other offers and user records',async()=>{
  const f=fixture(),data=f.store.imagegrabResearchData;
  data.offers[0].details={skus:[{value:'旧缩略图规格',imageUrl:'https://images.test/thumb.jpg'}],optionCollection:{status:'complete'}};
  data.offers[1].details={skus:[{value:'范围外旧规格'}],optionCollection:{status:'complete'}};
  const outside=clone(data.offers[1]);
  const result=await f.engine.handle({type:'DETAIL_JOB_START',productIds:['p1'],recaptureCompleted:true});assert.equal(result.ok,true);await f.engine.kick();
  const after=f.store.imagegrabResearchData;
  assert.equal(f.store.imagegrabDetailJob.recaptureCompleted,true);assert.equal(f.store.imagegrabDetailJob.status,'complete');
  assert.deepEqual(f.visits,['https://detail.1688.com/offer/123.html']);
  assert.equal(after.products.length,2);assert.equal(after.offers.length,2);assert.equal(after.offers[0].id,'o1');assert.equal(after.products[0].id,'p1');
  assert.equal(after.offers[0].details.skus[0].imageUrl,'https://images.test/silver.jpg');assert.deepEqual(after.offers[1],outside);
  assert.equal(after.products[0].rank,'1');assert.equal(after.products[0].notes,'保留手写备注');assert.equal(after.certificates[0].number,'保留证书');
});
test('failed or partial recapture keeps the previous complete research data intact',async()=>{
  for(const options of [{partial:true},{error:'/123.html'}]){
    const f=fixture(options);f.store.imagegrabResearchData.offers[0].details={skus:[{value:'原完整规格'}],optionCollection:{status:'complete'}};
    const before=clone(f.store.imagegrabResearchData);
    assert.equal((await f.engine.handle({type:'DETAIL_JOB_START',productIds:['p1'],recaptureCompleted:true})).ok,true);await f.engine.kick();
    assert.equal(f.store.imagegrabDetailJob.status,'finished_with_errors');assert.equal(f.store.imagegrabDetailJob.items[0].status,'failed');
    assert.deepEqual(f.store.imagegrabResearchData,before);
  }
});
test('resume retains recapture mode and retries only unsuccessful items of the original job',async()=>{
  const options={error:'/456.html'},f=fixture(options);
  for(const o of f.store.imagegrabResearchData.offers)o.details={skus:[{value:'旧规格'}],optionCollection:{status:'complete'}};
  await f.engine.handle({type:'DETAIL_JOB_START',recaptureCompleted:true});await f.engine.kick();
  const jobId=f.store.imagegrabDetailJob.id;
  assert.deepEqual(f.store.imagegrabDetailJob.items.map(i=>i.status),['complete','failed']);
  options.error='';await f.engine.handle({type:'DETAIL_JOB_RESUME',recaptureCompleted:false});await f.engine.kick();
  assert.equal(f.store.imagegrabDetailJob.id,jobId);assert.equal(f.store.imagegrabDetailJob.recaptureCompleted,true);assert.equal(f.store.imagegrabDetailJob.status,'complete');
  assert.equal(f.visits.filter(x=>x.includes('/123.html')).length,1);assert.equal(f.visits.filter(x=>x.includes('/456.html')).length,2);
});
test('stop keeps unfinished link pending; resume does not revisit already completed links',async()=>{
  let once=true;const f=fixture({onCapture:async store=>{if(once){once=false;store.imagegrabDetailJob.stopRequested=true;}}});
  await f.engine.handle({type:'DETAIL_JOB_START'});await f.engine.kick();
  assert.equal(f.store.imagegrabDetailJob.status,'paused');assert.equal(f.store.imagegrabDetailJob.items[0].status,'pending');assert.equal(f.store.imagegrabResearchData.offers[0].details,undefined);
  await f.engine.handle({type:'DETAIL_JOB_RESUME'});await f.engine.kick();assert.equal(f.store.imagegrabDetailJob.status,'complete');
  const visits=f.visits.length;const reply=await f.engine.handle({type:'DETAIL_JOB_START'});assert.equal(reply.ok,false);assert.equal(f.visits.length,visits);
});
test('verification pauses queue, preserves verification tab, and does not write fabricated details',async()=>{
  const f=fixture({blocked:true});await f.engine.handle({type:'DETAIL_JOB_START'});await f.engine.kick();
  assert.equal(f.store.imagegrabDetailJob.status,'paused');assert.equal(f.store.imagegrabDetailJob.items[0].status,'blocked');assert.equal(f.visits.length,1);assert.equal(f.closed.length,0);assert.equal(f.store.imagegrabResearchData.offers[0].details,undefined);
});
test('unavailable detail is recorded and skipped without pausing the remaining queue',async()=>{
  const f=fixture({removed:true});f.store.imagegrabResearchData.offers[0].details={skus:[{value:'保留旧规格'}],optionCollection:{status:'partial'}};
  await f.engine.handle({type:'DETAIL_JOB_START'});await f.engine.kick();
  assert.equal(f.store.imagegrabDetailJob.status,'complete');
  assert.deepEqual(f.store.imagegrabDetailJob.items.map(i=>i.status),['unavailable','complete']);
  assert.equal(f.store.imagegrabDetailJob.items[0].error,'商品已下架或已失效');
  assert.deepEqual(f.visits,['https://detail.1688.com/offer/123.html','https://detail.1688.com/offer/456.html']);
  assert.equal(f.store.imagegrabResearchData.offers[0].details.skus[0].value,'保留旧规格');
  const visits=f.visits.length;await f.engine.handle({type:'DETAIL_JOB_RESUME'});await f.engine.kick();assert.equal(f.visits.length,visits);
});
test('navigation ignores stale removed DOM and pending about:blank while the requested offer loads',async()=>{
  let reads=0;const f=fixture({onProbe:async tab=>{
    reads++;
    if(reads===1)return {url:'https://detail.1688.com/offer/999.html',title:'商品已下架',ready:false,unavailable:true};
    if(reads===2){tab.pendingUrl=tab.url;tab.status='loading';return {url:'about:blank',title:'',ready:false};}
    tab.status='complete';delete tab.pendingUrl;return {url:tab.url,title:'商品',ready:true};
  }});
  await f.engine.handle({type:'DETAIL_JOB_START'});await f.engine.kick();
  assert.equal(f.store.imagegrabDetailJob.status,'complete');assert.equal(f.store.imagegrabDetailJob.items[0].status,'complete');
});
test('genuine departure still pauses the task and keeps the navigated tab',async()=>{
  const f=fixture({onProbe:async tab=>{tab.url='https://www.1688.com/';tab.status='complete';return {url:tab.url,title:'1688首页',ready:false};}});
  await f.engine.handle({type:'DETAIL_JOB_START'});await f.engine.kick();
  assert.equal(f.store.imagegrabDetailJob.status,'paused');assert.equal(f.store.imagegrabDetailJob.reason,'采集标签页已离开目标商品');
  assert.equal(f.closed.length,0);assert.equal(f.store.imagegrabResearchData.offers[0].details,undefined);
});

test('known 404 redirect records a retryable failure and continues; old details survive',async()=>{
  let redirect=true;const errorUrl='https://page.1688.com/shtml/static/wrongpage.html';
  const f=fixture({onNavigate:async tab=>{if(redirect&&tab.url.includes('/123.html')){tab.url=errorUrl;tab.status='complete';}}});
  f.store.imagegrabResearchData.offers[0].details={skus:[{value:'保留旧资料'}],optionCollection:{status:'partial'}};
  await f.engine.handle({type:'DETAIL_JOB_START'});await f.engine.kick();
  const j=f.store.imagegrabDetailJob;
  assert.equal(j.status,'finished_with_errors');assert.deepEqual(j.items.map(i=>i.status),['failed','complete']);
  assert.equal(j.items[0].errorCode,'page_not_found');assert.equal(j.items[0].finalUrl,errorUrl);
  assert.equal(j.items[0].url,'https://detail.1688.com/offer/123.html');
  assert.equal(f.store.imagegrabResearchData.offers[0].details.skus[0].value,'保留旧资料');assert.equal(f.closed.length,2);assert.equal(f.listeners.size,0);
  redirect=false;await f.engine.handle({type:'DETAIL_JOB_RESUME'});await f.engine.kick();
  assert.equal(f.store.imagegrabDetailJob.status,'complete');assert.equal(f.store.imagegrabDetailJob.items[0].errorCode,undefined);
  assert.equal(f.visits.filter(url=>url.includes('/456.html')).length,1);
});

test('404 navigation event is retained when the error page redirects home before polling',async()=>{
  const f=fixture({onNavigate:async(tab,listeners)=>{if(tab.url.includes('/123.html')){for(const fn of listeners)fn(tab.id,{url:'https://page.1688.com/shtml/static/wrongpage.html'});tab.url='https://www.1688.com/';tab.status='complete';}}});
  await f.engine.handle({type:'DETAIL_JOB_START'});await f.engine.kick();
  assert.deepEqual(f.store.imagegrabDetailJob.items.map(i=>i.status),['failed','complete']);
  assert.equal(f.store.imagegrabDetailJob.items[0].errorCode,'page_not_found');
  assert.equal(f.tabs.size,1);assert.equal([...f.tabs.values()][0].url,'https://www.1688.com/');assert.equal(f.listeners.size,0);
});

test('untrusted lookalike error URLs and plain home pages remain departures',async()=>{
  for(const url of ['https://page.1688.com.evil.test/shtml/static/wrongpage.html','https://www.1688.com/']){
    const f=fixture({onNavigate:async tab=>{tab.url=url;tab.status='complete';}});
    await f.engine.handle({type:'DETAIL_JOB_START'});await f.engine.kick();assert.equal(f.store.imagegrabDetailJob.status,'paused');assert.equal(f.closed.length,0);assert.equal(f.listeners.size,0);
  }
});

test('verification URL still pauses even after a known 404 navigation was observed',async()=>{
  const f=fixture({onNavigate:async(tab,listeners)=>{for(const fn of listeners)fn(tab.id,{url:'https://page.1688.com/shtml/static/wrongpage.html'});tab.url='https://login.1688.com/';}});
  await f.engine.handle({type:'DETAIL_JOB_START'});await f.engine.kick();assert.equal(f.store.imagegrabDetailJob.status,'paused');assert.equal(f.store.imagegrabDetailJob.reason,'需要登录或安全验证');assert.equal(f.closed.length,0);assert.equal(f.listeners.size,0);
});
test('failed or partial item remains retryable while successful offers are kept',async()=>{
  const f=fixture({error:'/123.html'});await f.engine.handle({type:'DETAIL_JOB_START'});await f.engine.kick();
  assert.equal(f.store.imagegrabDetailJob.status,'finished_with_errors');assert.equal(f.store.imagegrabDetailJob.items[0].status,'failed');assert.equal(f.store.imagegrabDetailJob.items[1].status,'complete');
  const p=fixture({partial:true});await p.engine.handle({type:'DETAIL_JOB_START',productIds:['p1']});await p.engine.kick();assert.equal(p.store.imagegrabDetailJob.items[0].status,'partial');assert.equal(p.store.imagegrabResearchData.offers[0].details.optionCollection.status,'partial');
});
test('worker recovery retries in-flight item and refuses to overwrite complete details with partial capture',async()=>{
  const f=fixture();f.store.imagegrabDetailJob={id:'recovery',status:'running',items:[{url:'https://detail.1688.com/offer/123.html',offerId:'o1',productId:'p1',status:'running',attempts:1}],current:0};await f.engine.kick();assert.equal(f.store.imagegrabDetailJob.status,'complete');
  const d=f.store.imagegrabResearchData;assert.throws(()=>jobs.mergeCapture(d,{url:d.offers[0].url,offerId:'o1'},capture(d.offers[0].url,true),context.ImageGrabOfferData),/保留原完整/);
  assert.throws(()=>jobs.mergeCapture(d,{url:d.offers[0].url,offerId:'o1'},capture('https://detail.1688.com/offer/999.html'),context.ImageGrabOfferData),/不一致/);
});
