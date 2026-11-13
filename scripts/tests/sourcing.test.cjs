const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const context=vm.createContext({URL,crypto:require('node:crypto').webcrypto});
for(const file of ['sourcing-match.js','sourcing-store.js','offer-data.js','detail-job.js'])vm.runInContext(fs.readFileSync(path.join(root,'imagegrab-extension',file),'utf8'),context);
const match=context.ImageGrabSourcingMatch,clone=x=>JSON.parse(JSON.stringify(x));
const offer=(id,title,more={})=>({url:`https://detail.1688.com/offer/${id}.html`,title,...more});
test('two sourcing channels deduplicate tracking URLs and retain both provenance records',()=>{
 const rows=match.dedupe([offer(123,'筒灯',{sources:[{channel:'image'}],images:['https://img.test/a.jpg']}),{url:'https://offer.1688.com/offer/123.html?x=1',title:'筒灯',sources:[{channel:'name'}],images:['https://img.test/b.jpg']},{url:'https://evil.test/offer/123.html',title:'不接受'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].sources.length,2);assert.equal(rows[0].images.length,2);
});
test('specification substitute sourcing uses an independent pool and preserves replacement evidence',async()=>{
 const store={imagegrabSourcingData:{criteria:{name:'旧分支'},candidates:[offer(91,'旧候选')],selected:[],reference:null},imagegrabResearchData:{products:[],offers:[],certificates:[]}};
 const api={storage:{local:{get:async key=>({[key]:clone(store[key]??null)}),set:async value=>Object.assign(store,clone(value))}}};
 const manual=context.ImageGrabSourcingStore.create(api,match);
 const substitute=context.ImageGrabSourcingStore.create(api,match,{key:'imagegrabSourcingSubstituteData'});
 await manual.add([offer(91,'旧候选')],{channel:'name'});
 await substitute.update({criteria:{substitute:true,matchMode:'exact',brand:'亮亮照明',specs:'5W 95mm'}});
 await substitute.add([{...offer(92,'其他品牌 LED 筒灯 5W 95mm'),brandRelation:'different',targetSpecStatus:'included'}],{channel:'name',substitute:true});
 assert.equal((await manual.get()).candidates.length,1);assert.equal((await substitute.get()).candidates.length,1);
 assert.equal(store.imagegrabSourcingSubstituteData.candidates[0].url,'https://detail.1688.com/offer/92.html');
 assert.equal(store.imagegrabSourcingData.candidates[0].url,'https://detail.1688.com/offer/91.html');
 const admitted=await substitute.admit(['https://detail.1688.com/offer/92.html']);
 assert.equal(admitted.count,1);assert.equal(store.imagegrabResearchData.offers[0].sourcingEvidence.identity,'规格替代候选，尚未确认同款');
 assert.equal(store.imagegrabResearchData.offers[0].sourcingEvidence.brandRelation,'different');assert.equal(store.imagegrabResearchData.offers[0].sourcingEvidence.targetSpecStatus,'included');
});
test('category and visible specification conflicts exclude unrelated goods without padding the shortlist',()=>{
 const r=match.screen([offer(1,'亮亮照明 LED 嵌入式筒灯 5W 95mm'),offer(2,'亮亮照明 LED 灯泡 5W'),offer(3,'绿色包装胶带'),offer(4,'LED 筒灯 12W 95mm')],{name:'亮亮照明LED',category:'筒灯',specs:'5W 95mm',exclude:'胶带 电池',limit:10});
 assert.equal(r.shortlist.length,1);assert.equal(r.excluded.length,3);assert.match(r.excluded.find(x=>x.url.includes('/4.html')).excluded.join(),/规格冲突/);
 assert.equal(match.screen([offer(5,'LED 筒灯')],{category:'筒灯',specs:'5W'}).review.length,1);
});
test('exact-brand/model missing evidence stays in review while alternative sourcing can retain other brands',()=>{
 const rows=[offer(1,'亚明 LED 筒灯 5W')];
 assert.equal(match.screen(rows,{name:'LED 筒灯',category:'筒灯',mode:'exact',brand:'亮亮照明',model:'AB-5'}).review.length,1);
 assert.equal(match.screen(rows,{name:'LED 筒灯',category:'筒灯',mode:'alternative',brand:'亮亮照明'}).shortlist.length,1);
});
test('unreadable or low similarity images are not silently treated as a confirmed visual match',()=>{
 assert.equal(match.screen([offer(1,'筒灯')],{hasImage:true,category:'筒灯'}).review.length,1);
 assert.equal(match.screen([offer(1,'筒灯',{visualScore:45})],{hasImage:true,category:'筒灯'}).review.length,1);
 assert.equal(match.screen([offer(1,'筒灯',{visualScore:90})],{hasImage:true,category:'筒灯'}).shortlist.length,1);
});
test('local pixels are actually compared and blank images of different colors do not get a high score',()=>{
 const rgba=new Uint8ClampedArray(64*64*4).fill(255),black=new Uint8ClampedArray(rgba.length);for(let i=3;i<black.length;i+=4)black[i]=255;
 const a=match.describe(rgba,64,64),b=match.describe(black,64,64);
 assert.equal(match.visualSimilarity(a,a),100);assert.ok(match.visualSimilarity(a,b)<70);assert.equal(match.visualSimilarity(a,null),null);
});

test('image-only retrieval without pixel permission keeps all candidates unscored in review',()=>{
 const r=match.screen([offer(1,'小猫长条发夹'),offer(2,'卡通边夹')],{hasImage:false,hasReference:true,name:'',category:''});
 assert.equal(r.total,2);assert.equal(r.shortlist.length,0);assert.equal(r.review.length,2);
 for(const row of r.review){assert.equal(row.score,0);assert.equal(row.visualScore,undefined);assert.ok(row.missing.includes('图片未比对'));}
 assert.throws(()=>match.screen([offer(1,'未知商品')],{}),/请填写/);
});
test('native 1688 image-search results keep platform order while retaining local score as a hint',()=>{
 const rows=[offer(1,'外观相近但平台第3条',{retrievalOrder:2,visualScore:98}),offer(2,'平台第1条但像素分较低',{retrievalOrder:0,visualScore:45}),offer(3,'平台第2条',{retrievalOrder:1,visualScore:70})];
 const r=match.screen(rows,{name:'',hasImage:true,hasReference:true,nativeImageSearch:true,limit:10});
 assert.equal(Array.from(r.shortlist,x=>x.url).join(','),[rows[1].url,rows[2].url,rows[0].url].join(','));
 assert.match(r.shortlist[0].reasons.join('；'),/平台原始顺序优先/);
});
test('ordinary manual sourcing still ranks by local score',()=>{
 const rows=[offer(1,'候选一',{visualScore:45}),offer(2,'候选二',{visualScore:98})];
 const r=match.screen(rows,{name:'候选',hasImage:true,hasReference:true,limit:10});
 assert.equal(r.shortlist[0].url,'https://detail.1688.com/offer/2.html');
});
test('candidate pool is isolated until admission; clear preserves research details; selected links constrain detail queue',async()=>{
 const store={imagegrabResearchData:{products:[{id:'p',title:'原商品',notes:'用户备注'}],offers:[{id:'o1',productId:'p',url:'https://detail.1688.com/offer/1.html',details:{skus:[{value:'原规格'}]}},{id:'o2',productId:'p',url:'https://detail.1688.com/offer/2.html'}],certificates:[{number:'保留'}]}};
 const api={storage:{local:{get:async key=>({[key]:clone(store[key]??null)}),set:async value=>Object.assign(store,clone(value))}}};
 const pool=context.ImageGrabSourcingStore.create(api,match),before=JSON.stringify(store.imagegrabResearchData);
 await pool.add([offer(1,'候选1'),offer(3,'候选3')],{channel:'image'});await pool.add([offer(3,'候选3')],{channel:'name'});
 assert.equal(JSON.stringify(store.imagegrabResearchData),before);assert.equal((await pool.get()).candidates.length,2);
 const result=await pool.admit(['https://detail.1688.com/offer/1.html']);
 assert.equal(result.count,1);assert.equal(store.imagegrabResearchData.offers[0].details.skus[0].value,'原规格');assert.equal(store.imagegrabResearchData.products[0].notes,'用户备注');
 const queue=context.ImageGrabDetailJobs.makeQueue(store.imagegrabResearchData,result.productIds,result.offerUrls);assert.equal(queue.length,1);assert.equal(queue[0].url,'https://detail.1688.com/offer/1.html');
 await pool.clear();assert.equal((await pool.get()).candidates.length,0);assert.equal(store.imagegrabResearchData.offers.length,2);
});
test('active detail job blocks admission and cannot be replaced by sourcing',async()=>{
 const store={imagegrabDetailJob:{status:'running'}};const api={storage:{local:{get:async key=>({[key]:store[key]}),set:async value=>Object.assign(store,value)}}};
 const pool=context.ImageGrabSourcingStore.create(api,match);await pool.add([offer(1,'筒灯')],{channel:'image'});
 await assert.rejects(pool.admit(['https://detail.1688.com/offer/1.html']),/先停止/);assert.equal(store.imagegrabResearchData,undefined);
});
test('automatic screenshot runs stay isolated from the manual pool and admit only their own candidates',async()=>{
 const store={imagegrabSourcingData:{criteria:{mode:'alternative',name:'手动候选'},candidates:[offer(1,'旧的手动候选')],selected:[],reference:null},imagegrabResearchData:{products:[{id:'original',title:'保留商品'}],offers:[],certificates:[]}};
 const api={storage:{local:{get:async key=>({[key]:clone(store[key]??null)}),set:async value=>Object.assign(store,clone(value))}}};
 const pool=context.ImageGrabSourcingStore.create(api,match);
 await pool.beginAuto('run-isolated-001');
 await pool.updateAuto('run-isolated-001',{criteria:{mode:'alternative',name:'本次截图商品'},selected:[]});
 await pool.addAuto([offer(2,'本次截图商品')],{channel:'image'},'run-isolated-001');
 await pool.addAuto([offer(2,'本次截图商品')],{channel:'name'},'run-isolated-001');
 const run=await pool.getAuto();
 assert.equal(run.candidates.length,1);assert.equal(run.candidates[0].sources.length,2);
 assert.equal((await pool.get()).candidates.length,1);assert.equal((await pool.get()).candidates[0].url,'https://detail.1688.com/offer/1.html');
 const result=await pool.admit(['https://detail.1688.com/offer/2.html'],'run-isolated-001');
 assert.equal(result.count,1);assert.equal(store.imagegrabResearchData.products.length,2);
 assert.equal(store.imagegrabResearchData.products[0].title,'本次截图商品');
 assert.equal((await pool.get()).candidates[0].title,'旧的手动候选');
 await assert.rejects(pool.admit(['https://detail.1688.com/offer/1.html'],'another-run'),/已被新任务替换/);
 await pool.clearAuto('run-isolated-001');assert.equal((await pool.getAuto()).candidates.length,0);
 assert.equal((await pool.get()).candidates[0].title,'旧的手动候选');assert.equal(store.imagegrabResearchData.products.length,2);
});
