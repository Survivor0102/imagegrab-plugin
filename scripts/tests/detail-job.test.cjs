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
  const tabs=new Map(),visits=[],closed=[],changes=[];let next=90,clock=0;
  const api={storage:{local:{get:async key=>({[key]:clone(store[key]??null)}),set:async values=>{for(const [key,v]of Object.entries(values)){store[key]=clone(v);changes.push(key);}}}},alarms:{create:async()=>{},clear:async()=>{}},tabs:{create:async args=>{assert.equal(args.active,false);const t={id:++next,url:args.url};tabs.set(t.id,t);return t;},get:async id=>{if(!tabs.has(id))throw Error('Tab missing');return clone(tabs.get(id));},update:async(id,args)=>{assert.equal(args.active,false);tabs.get(id).url=args.url;visits.push(args.url);return clone(tabs.get(id));},remove:async id=>{closed.push(id);tabs.delete(id);}},scripting:{executeScript:async args=>{
    if(args.files)return [{result:null}];
    const url=tabs.get(args.target.tabId)?.url;
    if(!args.args?.length)return [{result:{url,title:options.blocked?'安全验证':'商品',ready:true}}];
    if(options.onCapture)await options.onCapture(store,tabs,args);
    if(options.error&&url.includes(options.error))return [{result:{ok:false,error:'读取模板失败'}}];
    return [{result:{ok:true,row:capture(url,options.partial)}}];
  }}};
  const engine=jobs.create(api,{sleep:async()=>{clock+=100;await new Promise(r=>setImmediate(r));},now:()=>clock,timing:{poll:1,readyTimeout:1000,between:0}});
  return {api,engine,store,tabs,visits,closed,changes};
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
