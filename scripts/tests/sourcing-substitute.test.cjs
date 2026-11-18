const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({URL,crypto:require('node:crypto').webcrypto});
for(const file of ['sourcing-match.js','sourcing-substitute-match.js','sourcing-store.js','offer-data.js','detail-job.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../imagegrab-extension',file),'utf8'),ctx);
const engine=ctx.ImageGrabSubstituteMatch,clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const target={substitute:true,name:'亮亮照明 LED 全塑料筒灯 12W',brand:'亮亮照明',category:'筒灯',specs:'12W',matchMode:'exact',limit:20};
const row=(id,attrs=[],skus=[{value:'12瓦'}])=>({url:`https://detail.1688.com/offer/${id}.html`,title:'LED 筒灯 12W',details:{title:'LED 筒灯',attributes:attrs,skus,capturedAt:123}});
const attr=(name,value)=>({name,value});
test('absence and placeholders do not establish a different brand; explicit fields distinguish brands',()=>{
 for(const brand of ['', 'other','其他','无品牌'])assert.equal(engine.compare(row(1,[attr('品牌',brand)]),target).brandRelation,'unknown');
 assert.equal(engine.compare({...row(1),title:target.name},target).brandRelation,'unknown');
 assert.equal(engine.compare(row(1,[attr('品牌','开尔照明')]),target).brandRelation,'different');
 assert.equal(engine.compare(row(1,[attr('品牌','亮亮照明')]),target).brandRelation,'same');
 assert.equal(engine.compare({...row(1,[attr('品牌','开尔照明')]),brand:'亮亮照明'},target).brandRelation,'unknown');
});

test('saved search text recovers visible price, sales, supplier and title brand clue without treating it as verified',()=>{
 const saved={url:'https://detail.1688.com/offer/762373020938.html',title:'理星照明LED超薄筒灯白光暖光中光嵌入式家装商铺15W18W12W面板灯',
   visibleText:'理星照明LED超薄筒灯白光暖光中光嵌入式家装商铺15W18W12W面板灯 ¥ 8 .9 限时价 包邮 60件起批 已售200+件 退货包运费 兰山区顺冠神州光科亚明照明灯具厂'};
 const target={name:'亮亮照明 LED 全塑料筒灯 12W',brand:'亮亮照明',specs:'12W',matchMode:'exact'};
 const row=ctx.ImageGrabSourcingMatch.dedupe([saved])[0];
 assert.equal(row.priceText,'¥8.9'); assert.equal(row.salesText,'已售200+件');
 assert.equal(row.supplierName,'兰山区顺冠神州光科亚明照明灯具厂');
 const result=engine.compare({...row,brandClue:'理星照明'},target);
 assert.equal(result.brandRelation,'unknown'); assert.equal(result.brandEvidence.clueRelation,'different');
 assert.match(result.brandEvidence.reason,/疑似不同品牌/);
});

test('search recovery preserves detail fields and never invents shipping or a supplier from the product title',()=>{
 const saved={title:'某灯具厂',visibleText:'某灯具厂'};
 assert.equal(ctx.ImageGrabSourcingMatch.recover(saved).supplierName,undefined);
 const result=ctx.ImageGrabSourcingMatch.recover({title:'筒灯',priceText:'¥12',supplierName:'详情供应商',visibleText:'筒灯 ¥8.9 兰山区某灯具厂'});
 assert.equal(result.priceText,'¥12');assert.equal(result.supplierName,'详情供应商');assert.equal(result.shipFrom,undefined);
 const brand=engine.brandEvidence({title:'理星照明LED筒灯',details:{attributes:[attr('品牌','亮亮照明')]}},target);
 assert.equal(brand.relation,'same');assert.equal(brand.clue,undefined);
});
test('power alone leaves material missing; iron conflicts with plastic and flexible mode keeps warning',()=>{
 const partial=engine.annotate(row(1),target);
 assert.equal(partial.targetSpecStatus,'unknown');assert.equal(partial.status,'review');assert.ok(partial.specComparison.missing.some(x=>x.key==='material'));
 const iron=engine.annotate(row(2,[attr('材质','铁')]),target);
 assert.equal(iron.targetSpecStatus,'excluded');assert.equal(iron.status,'excluded');assert.match(iron.specDifference,/材质.*塑料.*铁/);
 const relaxed=engine.annotate(row(2,[attr('材质','铁')]),{...target,matchMode:'allow-difference'});
 assert.equal(relaxed.status,'review');assert.equal(relaxed.targetSpecStatus,'excluded');assert.ok(relaxed.score<partial.score);
});
test('PC satisfies generic plastic without inventing target voltage or opening requirements',()=>{
 const result=engine.annotate(row(3,[attr('品牌','开尔照明'),attr('材质','PC'),attr('电压','220V')]),target);
 assert.equal(result.targetSpecStatus,'included');assert.equal(result.specComparison.matchingSkus.length,1);
 assert.ok(result.specComparison.targetNotSpecified.includes('电压'));
 assert.ok(!result.specComparison.requirements.some(x=>x.key==='voltage'));
 assert.match(result.specComparison.scope,/仅核对已知/);
});
test('normalizes unit aliases and checks opening and voltage separately',()=>{
 const c={...target,specs:'12瓦；开孔：12cm；电压：220V；暗装'};
 const r=row(4,[attr('材质','PC'),attr('电压','220伏'),attr('安装方式','嵌入式')],[{value:'12W 开孔120mm'}]);
 assert.equal(engine.compare(r,c).targetSpecStatus,'included');
 r.details.skus=[{value:'12W 直径120mm'}];
 assert.equal(engine.compare(r,c).targetSpecStatus,'unknown');
 r.details.skus=[{value:'12W 开孔100mm'}];
 assert.equal(engine.compare(r,c).targetSpecStatus,'excluded');
});
test('does not splice power and opening across different SKUs or take an invalidated search title as fact',()=>{
 const c={...target,specs:'12W；开孔：120mm'};
 const r=row(5,[attr('材质','塑料')],[{value:'12W 开孔90mm'},{value:'18W 开孔120mm'}]);
 assert.equal(engine.compare(r,c).targetSpecStatus,'excluded');
 r.details.skus=[{value:'18W 开孔120mm'}];
 assert.equal(engine.compare(r,c).targetSpecStatus,'excluded');
 r.details.skus.push({value:'12W 开孔120mm',priceText:'¥15'});
 const result=engine.compare(r,c);assert.equal(result.targetSpecStatus,'included');assert.equal(result.specComparison.matchingSkus.length,1);assert.equal(result.specComparison.matchingSkus[0].priceText,'¥15');
});
test('supports arbitrary named specifications, not a lamp-only schema',()=>{
 const c={name:'储物盒',specs:'容量：500ml；颜色：白色',matchMode:'exact'};
 const r={url:'https://detail.1688.com/offer/6.html',title:'储物盒',details:{attributes:[attr('容量','0.5L'),attr('颜色','白色')]}};
 assert.equal(engine.compare(r,c).targetSpecStatus,'included');
 r.details.attributes[1].value='黑色';assert.equal(engine.compare(r,c).targetSpecStatus,'excluded');
 const rubber={name:'密封垫',specs:'材质：硅胶'};
 assert.equal(engine.compare({title:'密封垫',details:{attributes:[attr('材质','橡胶')]}},rubber).targetSpecStatus,'excluded');
 assert.equal(engine.compare({title:'密封垫',details:{attributes:[attr('材质','硅胶')]}},rubber).targetSpecStatus,'included');
});
test('structured attributes override an obsolete matching title',()=>{
 const r={title:'筒灯 12W',details:{title:'筒灯 12W',attributes:[attr('功率','18W'),attr('材质','塑料')]}};
 assert.equal(engine.compare(r,target).targetSpecStatus,'excluded');
});
test('third-branch default is twenty and refreshing saved details fixes only substitute evidence',async()=>{
 const manual={candidates:[{url:'https://detail.1688.com/offer/90.html',title:'旧的手动候选'}]},automatic={id:'old-auto',candidates:[]};
 const saved={imagegrabSourcingData:manual,imagegrabSourcingAutoRun:automatic,imagegrabDetailJob:{status:'complete'},imagegrabResearchData:{products:[{id:'p',title:'筒灯'}],offers:[{id:'o',productId:'p',...row(1,[attr('品牌','other'),attr('材质','铁')]),sourcingEvidence:{criteria:target,brandRelation:'different',targetSpecStatus:'included'}}],certificates:[]}};
 const api={storage:{local:{get:async k=>({[k]:clone(saved[k])}),set:async patch=>Object.assign(saved,clone(patch))}}};
 const pool=ctx.ImageGrabSourcingStore.create(api,ctx.ImageGrabSourcingMatch,{key:'imagegrabSourcingSubstituteData'});
 assert.equal((await pool.get()).criteria.limit,20);
 await pool.update({criteria:target,candidates:[{url:'https://detail.1688.com/offer/1.html',title:'筒灯 12W'}]});
 const refreshed=await pool.refreshSubstitute();assert.equal(refreshed.candidates[0].brandRelation,'unknown');assert.equal(refreshed.candidates[0].targetSpecStatus,'excluded');
 assert.equal(saved.imagegrabResearchData.offers[0].sourcingEvidence.brandRelation,'unknown');
 assert.deepEqual(saved.imagegrabSourcingData,manual);assert.deepEqual(saved.imagegrabSourcingAutoRun,automatic);
 const stable=JSON.stringify(saved);await pool.refreshSubstitute();assert.equal(JSON.stringify(saved),stable);
});
test('detail completion updates evidence immediately without requiring a fresh admission',()=>{
 const data={products:[{id:'p',title:'筒灯'}],offers:[{id:'o',productId:'p',url:'https://detail.1688.com/offer/8.html',sourcingEvidence:{criteria:target,brandRelation:'different',targetSpecStatus:'included'}}]};
 ctx.ImageGrabDetailJobs.mergeCapture(data,{offerId:'o',url:data.offers[0].url},{...row(8,[attr('品牌','other'),attr('材质','铁')]).details,url:data.offers[0].url,captureKind:'detail',capturedAt:456,optionCollection:{status:'complete'},salesObservations:[]},ctx.ImageGrabOfferData);
 assert.equal(data.offers[0].sourcingEvidence.brandRelation,'unknown');assert.equal(data.offers[0].sourcingEvidence.targetSpecStatus,'excluded');
});

test('top twenty verification queue includes pending evidence without promoting it to a match',()=>{
 const rows=Array.from({length:30},(_,i)=>({url:`https://detail.1688.com/offer/${i+200}.html`,title:i===0?'全塑筒灯 12W':i===29?'铁壳筒灯 18W':'筒灯 12W'}));
 const result=engine.screen(rows,{...target,limit:20});
 assert.equal(result.queue.length,20);assert.equal(result.shortlist.length,1);
 assert.ok(result.queue.some(r=>r.status==='review'));
 assert.ok(result.queue.every(r=>r.status!=='excluded'));
 assert.equal(result.queue[0].status,'candidate');
});
