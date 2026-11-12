const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),source=path.join(root,'imagegrab-extension');
const chromePath='C:/Users/ASUS/Desktop/present_semester/企业实训/02_课程作业与项目/03_考核三/99_工具与临时文件/chrome-for-testing-154.0.8037.98/chrome-win64/chrome.exe';
async function poll(check,label,timeout=10000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(`Timed out: ${label}`);}

test('automatic results keep their own view, image scores and selection across refresh without changing manual or product data', {timeout:45000,skip:!fs.existsSync(chromePath)},async()=>{
 fs.mkdirSync(path.join(root,'runtime'),{recursive:true});const profile=fs.mkdtempSync(path.join(root,'runtime','sourcing-auto-results-'));
 const context=await chromium.launchPersistentContext(profile,{executablePath:chromePath,headless:true,args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
 const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 try{
   const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
   const page=await context.newPage();await page.goto(`chrome-extension://${id}/research.html#image-sourcing`);
   const images=await page.evaluate(()=>{
     const c=document.createElement('canvas');c.width=80;c.height=40;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,80,40);x.fillStyle='#222';x.fillRect(4,12,72,16);const reference=c.toDataURL('image/png');x.fillStyle='red';x.fillRect(0,0,80,40);return{reference,other:c.toDataURL('image/png')};
   });
   await context.route('https://s.1688.com/imagegrab-fixture/*',route=>route.fulfill({contentType:'image/png',body:Buffer.from((route.request().url().endsWith('same.png')?images.reference:images.other).split(',')[1],'base64')}));
   await page.evaluate(async({reference})=>{
     window.imageComparisonFetches=0;const fetchOriginal=window.fetch;window.fetch=(...args)=>{if(String(args[0]).includes('/imagegrab-fixture/'))window.imageComparisonFetches++;return fetchOriginal(...args);};
     await chrome.storage.local.set({
       imagegrabSourcingData:{criteria:{name:'皮筋',mode:'alternative'},candidates:[{url:'https://detail.1688.com/offer/99999999.html',title:'旧皮筋手动候选'}],selected:[],evaluations:{},reference:null},
       imagegrabResearchData:{products:[{id:'old-product',title:'已有商品'}],offers:[{id:'old-offer',productId:'old-product'}],certificates:[]},imagegrabDetailJob:{status:'complete',items:[]},
       imagegrabSourcingAutoRun:{id:'auto-cats',startedAt:Date.now(),status:'complete',criteria:{mode:'alternative',name:'',hasReference:true,hasImage:false,limit:10},reference:{image:reference,original:reference},selected:[],evaluations:{},candidates:[
         {url:'https://detail.1688.com/offer/12345678.html',title:'猫咪长条发夹 A',images:['https://s.1688.com/imagegrab-fixture/same.png'],sources:[{channel:'image',verified:true}],retrievalOrder:0},
         {url:'https://detail.1688.com/offer/22345678.html',title:'猫咪长条发夹 B',images:['https://s.1688.com/imagegrab-fixture/other.png'],sources:[{channel:'image',verified:true}],retrievalOrder:1},
         {url:'https://detail.1688.com/offer/32345678.html',title:'猫咪长条发夹 C',images:[],sources:[{channel:'image',verified:true}],retrievalOrder:2}
       ]}
     });
     await ImageGrabAutoResults.load('auto-cats');
   },images);
   const preserved=await page.evaluate(()=>chrome.storage.local.get(['imagegrabSourcingData','imagegrabResearchData','imagegrabDetailJob']));
   assert.equal(await page.locator('#auto-result-view').inputValue(),'review');
   assert.equal(await page.locator('#auto-results .candidate').count(),3);
   assert.match(await page.locator('#auto-results .candidate').first().innerText(),/未评分/);
   assert.doesNotMatch(await page.locator('#auto-results').innerText(),/排序分 0/);
   await page.evaluate(()=>ImageGrabAutoResults.scoreRun('auto-cats'));
   assert.equal(await page.evaluate(()=>window.imageComparisonFetches),0);
   assert.match(await page.locator('#auto-score-status').innerText(),/尚未进行图片比对/);
   await page.locator('#auto-results input').first().check();
   await poll(()=>page.evaluate(async()=>(await chrome.storage.local.get('imagegrabSourcingAutoRun')).imagegrabSourcingAutoRun.selected.length===1),'automatic selection saved');
   await page.reload();await page.locator('#auto-saved-results').waitFor();
   assert.equal(await page.locator('#sourcing-image-tab').getAttribute('aria-selected'),'true');
   assert.equal(await page.locator('#sourcing-manual').isVisible(),false);
   assert.equal(await page.locator('#auto-results .candidate').count(),3);
   assert.equal(await page.locator('#auto-results input').first().isChecked(),true);
   assert.equal(await page.locator('#auto-intake-form').getAttribute('open'),null);
   await page.locator('[data-sourcing-mode="manual"]').click();await page.locator('#results').filter({hasText:'旧皮筋手动候选'}).waitFor();
   await page.locator('[data-sourcing-mode="image"]').click();
   assert.match(await page.locator('#auto-results').innerText(),/猫咪长条发夹/);
   assert.doesNotMatch(await page.locator('#auto-results').innerText(),/皮筋/);
   // Simulate the permission decision only; the image fetching, decoding, comparison and storage are real.
   await page.evaluate(async()=>{chrome.permissions.contains=async()=>true;await ImageGrabAutoResults.scoreRun('auto-cats');});
   const scored=await page.evaluate(async()=>(await chrome.storage.local.get('imagegrabSourcingAutoRun')).imagegrabSourcingAutoRun);
   assert.equal(scored.evaluations['https://detail.1688.com/offer/12345678.html'].visualScore,100);
   assert.ok(Number.isFinite(scored.evaluations['https://detail.1688.com/offer/22345678.html'].visualScore));
   assert.equal(scored.evaluations['https://detail.1688.com/offer/32345678.html'].visualScore,undefined);
   assert.match(await page.locator('#auto-score-status').innerText(),/实际比对 2 件，1 件读取失败/);
   await page.locator('#auto-result-view').selectOption('review');
   await page.locator('#auto-results input').first().check();await poll(()=>page.evaluate(async()=>(await chrome.storage.local.get('imagegrabSourcingAutoRun')).imagegrabSourcingAutoRun.selected.length===1),'scored selection saved');
   await page.reload();await page.locator('#auto-saved-results').waitFor();
   assert.equal(await page.locator('#auto-result-view').inputValue(),'review');
   assert.equal(await page.locator('#auto-results input').first().isChecked(),true);
   assert.match(await page.locator('#auto-score-help').innerText(),/已实际比对 2\/3/);
   assert.match(await page.locator('#auto-score-help').innerText(),/1688图片搜索原始顺序/);
   assert.deepEqual(await page.evaluate(()=>chrome.storage.local.get(['imagegrabSourcingData','imagegrabResearchData','imagegrabDetailJob'])),preserved);
   assert.deepEqual(errors,[]);
   const version=await page.evaluate(()=>chrome.runtime.getManifest().version),dir=path.join(root,'evidence',new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}));fs.mkdirSync(dir,{recursive:true});
   fs.writeFileSync(path.join(dir,`sourcing-auto-results-installed-fixture-${version}.json`),JSON.stringify({version,kind:'Installed extension with synthetic candidate data and image routes; permission decision simulated only for the scoring branch',refreshKeepsAutomaticResults:true,manualPoolIndependent:true,missingScoreExplicit:true,comparedImages:2,missingImage:1,restoresScoresWithoutRerun:true,selectionAndGroupPersist:true,manualArchiveAndDetailJobUnchanged:true,pageErrors:errors},null,2)+'\n');
 }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
});

test('installed image-only run renders unscored review candidates without remote image permission', {timeout:30000,skip:!fs.existsSync(chromePath)},async()=>{
 fs.mkdirSync(path.join(root,'runtime'),{recursive:true});const profile=fs.mkdtempSync(path.join(root,'runtime','sourcing-image-only-'));
 const context=await chromium.launchPersistentContext(profile,{executablePath:chromePath,headless:true,args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
 try{
   const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
   const page=await context.newPage();await page.goto(`chrome-extension://${id}/research.html#image-sourcing`);
   const reference=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=40;return c.toDataURL('image/jpeg');});
   const runId='image-only-no-permission';
   await page.evaluate(async({reference,runId})=>{
     await chrome.storage.local.set({imagegrabSourcingAutoRun:{id:runId,status:'running',criteria:{name:'',category:'',hasImage:false,hasReference:true},reference:{original:reference,image:reference},candidates:[{url:'https://detail.1688.com/offer/12345678.html',title:'猫咪长条发夹',sources:[{channel:'image',verified:true}]}],evaluations:{},selected:[]}});
     await ImageGrabAutoResults.scoreRun(runId);
   },{reference,runId});
   assert.match(await page.locator('#auto-result-count').innerText(),/优先 0 · 待确认 1/);
   assert.equal(await page.locator('#auto-result-view').inputValue(),'review');
   assert.match(await page.locator('#auto-results .candidate').innerText(),/图片未比对/);
   const saved=await page.evaluate(async()=>chrome.storage.local.get(['imagegrabSourcingAutoRun','imagegrabResearchData']));
   const evaluation=Object.values(saved.imagegrabSourcingAutoRun.evaluations)[0];
   assert.equal(evaluation.score,0);assert.equal(evaluation.status,'review');assert.equal(evaluation.visualScore,undefined);
   assert.equal(saved.imagegrabResearchData,undefined);
 }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
});
test('installed sourcing page captures independent channels, compares real image pixels and enriches only selected candidates', {timeout:75000,skip:!fs.existsSync(chromePath)},async()=>{
 fs.mkdirSync(path.join(root,'runtime'),{recursive:true});const profile=fs.mkdtempSync(path.join(root,'runtime','sourcing-extension-'));
 const context=await chromium.launchPersistentContext(profile,{executablePath:chromePath,headless:true,args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
 const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 try{
   const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),extensionId=new URL(worker.url()).host;
   let image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7U8AAAAASUVORK5CYII=','base64');
   const cards=[['12345678','亮亮照明 LED 嵌入式筒灯 5W 95mm'],['22222222','绿色包装纽扣电池 5W'],['33333333','LED 嵌入式筒灯 12W 95mm']];
   const listing=`<!doctype html><html><head><meta charset="utf-8"><title>1688测试搜索结果</title></head><body><form class="ali-search-box"><input id="alisearch-input"><button type="submit">搜索</button></form><input id="native-upload" type="file" accept="image/*"><main>${cards.map(([id,title],index)=>index===2?`<div data-tracker="offer" data-renderkey="1_2_normal_test_${id}" data-aplus-report="object_id@${id}^position@2"><img src="https://s.1688.com/item.png" width="200" height="200"><div class="titleText--fixture">${title}</div><div class="offer-price-row"><div class="priceItem--fixture">¥7.30</div></div><div>10件起批</div><div class="shopName--fixture">测试供应商</div></div>`:`<article><a href="https://detail.1688.com/offer/${id}.html"><img src="https://s.1688.com/item.png" width="200" height="200"><span style="display:block">${title}</span><span style="display:block">¥7.30</span><span style="display:block">10件起批</span></a><a href="https://shop.1688.com/page/index.htm">测试供应商</a></article>`).join('')}</main><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();document.body.dataset.keyword=document.getElementById('alisearch-input').value;};document.getElementById('native-upload').onchange=e=>{document.body.dataset.uploaded=e.target.files[0]?.name||'';};</script></body></html>`;
   await context.route('https://**/*',route=>{
     const url=route.request().url();
     if(url==='https://s.1688.com/item.png')return route.fulfill({contentType:'image/png',body:image});
     if(url.startsWith('https://s.1688.com/selloffer/offer_search.htm'))return route.fulfill({contentType:'text/html; charset=utf-8',body:listing});
     if(url.startsWith('https://detail.1688.com/offer/'))return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><div id="productTitle"><div class="title-content"><h1>亮亮照明 LED 嵌入式筒灯 5W 95mm</h1></div></div><div id="mainPrice"><div class="price-info">¥7.30</div></div><div id="description"></div><div id="skuSelection"><div class="feature-item"><h3>规格</h3><div class="expand-view-item"><span class="item-label">5W</span><span class="item-price-stock">¥7.30</span><span class="item-price-stock">库存100件</span></div></div></div>'});
     return route.fulfill({status:404,body:''});
   });
   const page=await context.newPage();await page.goto(`chrome-extension://${extensionId}/research.html#sourcing`);
   assert.equal(await page.locator('[data-view="sourcing"]').count(),1);
   assert.equal(await page.locator('[data-view="image-sourcing"]').count(),0);
   assert.equal(await page.locator('#sourcing-manual').isVisible(),true);
   assert.equal(await page.locator('#workspace-image-sourcing').isVisible(),false);
   const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,64,64);x.fillStyle='#555';x.beginPath();x.arc(32,32,20,0,Math.PI*2);x.fill();return c.toDataURL('image/png').split(',')[1];});image=Buffer.from(png,'base64');
   await page.evaluate(async()=>chrome.storage.local.set({imagegrabResearchData:{products:[{id:'old',title:'旧资料'}],offers:[{id:'old-offer',productId:'old',url:'https://detail.1688.com/offer/99999999.html'}],certificates:[]}}));
   const sourcePage=await context.newPage();await sourcePage.goto('https://s.1688.com/selloffer/offer_search.htm');await sourcePage.locator('#imagegrab-research-button').waitFor();
   await page.locator('#name').fill('亮亮照明 LED 筒灯');await page.locator('#category').fill('筒灯');await page.locator('#specs').fill('5W 95mm');await page.locator('#exclude').fill('电池 胶带');
   await page.locator('#tabs-refresh').click();await poll(()=>page.evaluate(()=>Number(document.querySelector('#source-tab').value)>0),'source tab');await page.locator('#capture').click();await page.locator('#pool-status').filter({hasText:'3 件'}).waitFor();await poll(()=>page.locator('#capture').isEnabled(),'first capture finished');
   let saved=await page.evaluate(async()=>chrome.storage.local.get(['imagegrabSourcingData','imagegrabResearchData']));assert.equal(saved.imagegrabResearchData.products.length,1);assert.equal(saved.imagegrabSourcingData.candidates.length,3);
   await page.locator('#channel').selectOption('name');await page.locator('#capture').click();await poll(()=>page.evaluate(async()=> (await chrome.storage.local.get('imagegrabSourcingData')).imagegrabSourcingData?.candidates.some(row=>row.sources?.some(s=>s.channel==='name'))),'second capture provenance');await poll(()=>page.locator('#capture').isEnabled(),'second capture finished');
   saved=await page.evaluate(async()=> (await chrome.storage.local.get('imagegrabSourcingData')).imagegrabSourcingData);assert.equal(saved.candidates.length,3);assert.ok(saved.candidates.some(candidate=>candidate.sources.length===2),JSON.stringify(saved.candidates.map(candidate=>({url:candidate.url,sources:candidate.sources}))));
   await page.locator('#reference-file').setInputFiles({name:'筒灯.png',mimeType:'image/png',buffer:image});await page.locator('#status').filter({hasText:'参考图已保存'}).waitFor();
    await page.locator('#reference-canvas').scrollIntoViewIfNeeded();const box=await page.locator('#reference-canvas').boundingBox();await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1);await page.mouse.down();await page.mouse.move(box.x+box.width*.9,box.y+box.height*.9);await page.mouse.up();await page.locator('#crop-apply').click();
   await poll(()=>page.locator('#crop-apply').isEnabled(),'crop saved');const cropped=await page.evaluate(async()=> (await chrome.storage.local.get('imagegrabSourcingData')).imagegrabSourcingData.reference);assert.ok(cropped.crop.w>.7&&cropped.crop.w<.9);
   await page.locator('#crop-reset').click();await poll(()=>page.locator('#crop-reset').isEnabled(),'crop reset');await page.locator('#screen').click();await page.locator('#status').filter({hasText:'筛选完成'}).waitFor();
   assert.equal(await page.locator('.candidate').count(),1);assert.match(await page.locator('#results .candidate').innerText(),/外观参考分/);
   await page.locator('#result-view').selectOption('excluded');assert.equal(await page.locator('.candidate').count(),2);
   await page.locator('#result-view').selectOption('shortlist');await page.locator('#select-top').click();
   const foreground=await page.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true})).map(t=>t.id));
   await page.locator('#enrich').click();await page.locator('#status').filter({hasText:'启动详情任务'}).waitFor();
   const deadline=Date.now()+25000;
   while(Date.now()<deadline){const job=await page.evaluate(async()=> (await chrome.storage.local.get('imagegrabDetailJob')).imagegrabDetailJob);if(job?.status==='complete'&&job.items?.every(x=>['complete','skipped','unavailable'].includes(x.status)))break;await new Promise(r=>setTimeout(r,250));}
   const result=await page.evaluate(async()=>chrome.storage.local.get(['imagegrabDetailJob','imagegrabResearchData','imagegrabSourcingData']));
   assert.equal(result.imagegrabDetailJob.items.length,1);assert.equal(result.imagegrabDetailJob.items[0].url,'https://detail.1688.com/offer/12345678.html');assert.equal(result.imagegrabDetailJob.items[0].status,'complete',JSON.stringify(result.imagegrabDetailJob));assert.equal(result.imagegrabResearchData.products.length,2);
   assert.equal(result.imagegrabResearchData.offers.find(x=>x.id==='old-offer').details,undefined);
   assert.deepEqual(await page.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true})).map(t=>t.id)),foreground);
   // Inject the production native-input functions into an already-routed synthetic tab.
   // Chrome-created tabs can navigate before Playwright attaches its routing session.
   const tabId=await page.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url.startsWith('https://s.1688.com/'))?.id);
   const reference=await page.evaluate(async()=> (await chrome.storage.local.get('imagegrabSourcingData')).imagegrabSourcingData.reference.image);
   await sourcePage.evaluate(()=>{const b=document.createElement('button');b.className='search-btn';b.textContent='搜索图片';b.onclick=()=>document.body.dataset.imageSearchClicked='true';document.body.appendChild(b);});
   const nativeUpload=await worker.evaluate(async({tabId,reference})=>(await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:upload1688Reference,args:[reference]}))[0].result,{tabId,reference});assert.equal(nativeUpload.ok,true);
   assert.equal(await sourcePage.locator('body').getAttribute('data-image-search-clicked'),'true');
   assert.equal(await sourcePage.locator('body').getAttribute('data-uploaded'),'imagegrab-reference.jpg');
   const nativeSearch=await worker.evaluate(async({tabId})=>(await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:fill1688Search,args:['亮亮照明 LED 筒灯']}))[0].result,{tabId});assert.equal(nativeSearch.ok,true);
   assert.equal(await sourcePage.locator('body').getAttribute('data-keyword'),'亮亮照明 LED 筒灯');
   // Even another extension page cannot admit candidates through the sourcing commands.
   const deniedPage=await context.newPage();await deniedPage.goto(`chrome-extension://${extensionId}/gallery.html`);
   const denied=await deniedPage.evaluate(()=>chrome.runtime.sendMessage({type:'SOURCING_ADMIT',urls:['https://detail.1688.com/offer/22222222.html']}));assert.equal(denied.ok,false);
   await page.reload();await page.locator('#pool-status').filter({hasText:'3 件'}).waitFor();assert.equal(await page.locator('#name').inputValue(),'亮亮照明 LED 筒灯');
   await page.locator('#reference-clear').click();await poll(()=>page.locator('#reference-clear').isEnabled(),'reference cleared');assert.equal(await page.evaluate(async()=> (await chrome.storage.local.get('imagegrabSourcingData')).imagegrabSourcingData.reference),null);
   await page.locator('#clear-pool').click();await page.locator('#pool-status').filter({hasText:'0 件'}).waitFor();assert.equal(await page.evaluate(async()=> (await chrome.storage.local.get('imagegrabResearchData')).imagegrabResearchData.products.length),2);
   assert.deepEqual(errors,[]);
   const version=await page.evaluate(()=>chrome.runtime.getManifest().version),date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),dir=path.join(root,'evidence',date);fs.mkdirSync(dir,{recursive:true});
   const evidence={checkedAt:new Date().toISOString(),version,kind:'Installed extension integration on routed synthetic 1688 pages; not live 1688 verification',captured:3,afterCrossChannelDedupe:3,shortlist:1,excluded:2,actualImageComparison:true,cropSaved:true,selectedDetailQueue:1,taskStatus:result.imagegrabDetailJob.status,oldArchivePreserved:true,foregroundPreserved:true,nativeImageInputReceivedFile:true,nativeChineseSearchSubmitted:true,unauthorizedSourceRejected:true,reloadPersistence:true};
   fs.writeFileSync(path.join(dir,`sourcing-installed-fixture-${version}.json`),JSON.stringify(evidence,null,2)+'\n');
 }catch(error){for(const p of context.pages())if(p.url().includes('/sourcing.html')){console.error('SOURCING DIAGNOSTICS',await p.locator('#status').textContent(),await p.locator('#source-tab').innerHTML(),await p.evaluate(async()=> (await chrome.storage.local.get('imagegrabDetailJob')).imagegrabDetailJob),errors);}throw error;}finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
});

test('sourcing workspace switches modes and recognizes a screenshot with bundled local OCR', {timeout:120000,skip:!fs.existsSync(chromePath)},async()=>{
 const profile=fs.mkdtempSync(path.join(root,'runtime','sourcing-ocr-'));
 const context=await chromium.launchPersistentContext(profile,{executablePath:chromePath,headless:true,args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
 const errors=[];context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>errors.push(`console:${m.type()}:${m.text()}`));p.on('requestfailed',r=>errors.push(`request:${r.url()}:${r.failure()?.errorText}`));});
 try{
   const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),extensionId=new URL(worker.url()).host;
   const page=await context.newPage();await page.goto(`chrome-extension://${extensionId}/research.html#image-sourcing`);
   await page.locator('#workspace-image-sourcing').waitFor({state:'visible'});
   assert.equal(await page.locator('[data-view="sourcing"]').count(),1);
   assert.equal(await page.locator('#sourcing-manual').isVisible(),false);
   const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1500;c.height=360;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#111';x.textBaseline='top';x.font='bold 88px "Microsoft YaHei", sans-serif';x.fillText('悦鲜活 鲜牛奶 260ml',45,60);x.font='48px "Microsoft YaHei", sans-serif';x.fillText('品牌：悦鲜活 规格：260ml',45,190);return c.toDataURL('image/png').split(',')[1];});
   await page.locator('#auto-reference-file').setInputFiles({name:'synthetic-product.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
   await page.locator('#auto-fields').waitFor({state:'visible',timeout:90000});
   await poll(async()=>{const value=await page.locator('#auto-title').inputValue(),state=await page.locator('#auto-ocr-status').innerText();if(!value&&/识别失败|没有找到可信的商品名/.test(state))throw Error(`${state}; OCR原文：${(await page.locator('#auto-raw-text').innerText()).slice(0,500)}; diagnostics: ${errors.join(' | ')}`);return value.length>0;},'OCR title',30000);
   const recognized={title:await page.locator('#auto-title').inputValue(),brand:await page.locator('#auto-brand').inputValue(),specs:await page.locator('#auto-specs').inputValue(),raw:await page.locator('#auto-raw-text').textContent()};
   assert.match(recognized.title,/鲜牛奶/);
   assert.match(recognized.title,/260\s*ml/i);
   await page.locator('[data-sourcing-mode="manual"]').click();
   assert.equal(await page.locator('#sourcing-manual').isVisible(),true);
   assert.equal(await page.locator('#workspace-image-sourcing').isVisible(),false);
   await page.locator('[data-sourcing-mode="image"]').click();
   assert.equal(await page.locator('#workspace-image-sourcing').isVisible(),true);
   assert.deepEqual(errors,[]);
   const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),version=await page.evaluate(()=>chrome.runtime.getManifest().version),dir=path.join(root,'evidence',date);fs.mkdirSync(dir,{recursive:true});
   fs.writeFileSync(path.join(dir,`sourcing-ocr-installed-fixture-${version}.json`),JSON.stringify({checkedAt:new Date().toISOString(),version,kind:'Installed extension with synthetic screenshot; bundled offline OCR and workspace-tab navigation',recognized,manualModePreserved:true,networkOcr:false,serviceWorkerErrors:errors},null,2)+'\n');
 }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
});
