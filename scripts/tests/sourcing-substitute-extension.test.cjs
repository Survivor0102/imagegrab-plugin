const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),source=path.join(root,'imagegrab-extension');
const chromePath='C:/Users/ASUS/Desktop/present_semester/企业实训/02_课程作业与项目/03_考核三/99_工具与临时文件/chrome-for-testing-154.0.8037.98/chrome-win64/chrome.exe';
test('installed third branch renders detail evidence, refreshes after enrichment and preserves old pools', {timeout:30000,skip:!fs.existsSync(chromePath)},async()=>{
 const profile=fs.mkdtempSync(path.join(root,'runtime','substitute-ui-'));
 const browser=await chromium.launchPersistentContext(profile,{executablePath:chromePath,headless:true,args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
 try {
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'),id=new URL(worker.url()).host,page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(`chrome-extension://${id}/research.html#substitute-sourcing`);
  await page.evaluate(async()=>{
   const url=n=>`https://detail.1688.com/offer/${n}.html`,criteria={name:'亮亮照明 LED 全塑料筒灯 12W',brand:'亮亮照明',category:'筒灯',specs:'12W',substitute:true,matchMode:'exact',limit:20};
   const candidates=[1,2,3].map(n=>({url:url(n),title:'LED 筒灯 12W',images:[],sources:[{channel:'name'}]}));
   const details=(brand,material)=>({title:'LED 筒灯',attributes:[{name:'品牌',value:brand},{name:'材质',value:material}],skus:[{value:'12瓦'}],capturedAt:123});
   await chrome.storage.local.set({imagegrabSourcingData:{criteria:{name:'旧手动'},candidates:[]},imagegrabSourcingAutoRun:{id:'old-auto',candidates:[]},imagegrabSourcingSubstituteData:{criteria,candidates,selected:[],reference:null},imagegrabResearchData:{products:[],offers:[{id:'o1',url:url(1),details:details('other','铁')},{id:'o2',url:url(2),details:details('other','铁')},{id:'o3',url:url(3),details:details('开尔照明','PC')}],certificates:[]},imagegrabDetailJob:{status:'complete'}});
  });
  await page.reload();await page.locator('#substitute-result-count').filter({hasText:'排除 2'}).waitFor();
  assert.equal(await page.locator('#substitute-limit').inputValue(),'20');
  let text=await page.locator('#substitute-results').innerText();assert.match(text,/不同品牌/);assert.match(text,/已知条件匹配/);assert.match(text,/目标未提供/);
  await page.locator('#substitute-result-view').selectOption('excluded');text=await page.locator('#substitute-results').innerText();assert.match(text,/品牌待核/);assert.match(text,/存在规格冲突/);assert.match(text,/需要塑料，页面为铁/);
  await page.locator('#substitute-match-mode').selectOption('allow-difference');await page.locator('#substitute-screen').click();await page.locator('#substitute-result-count').filter({hasText:'待核对 2'}).waitFor();
  await page.locator('#substitute-result-view').selectOption('review');assert.match(await page.locator('#substitute-results').innerText(),/允许差异/);
  await page.evaluate(async()=>{const {imagegrabResearchData:data}=await chrome.storage.local.get('imagegrabResearchData');data.offers[0].details.attributes[1].value='PC';await chrome.storage.local.set({imagegrabResearchData:data});});
  await page.locator('#substitute-result-count').filter({hasText:'优先 2'}).waitFor();
  await page.reload();await page.locator('#substitute-result-count').filter({hasText:'优先 2'}).waitFor();
  const old=await page.evaluate(()=>chrome.storage.local.get(['imagegrabSourcingData','imagegrabSourcingAutoRun']));assert.equal(old.imagegrabSourcingData.criteria.name,'旧手动');assert.equal(old.imagegrabSourcingAutoRun.id,'old-auto');assert.deepEqual(errors,[]);
 }finally{await browser.close();fs.rmSync(profile,{recursive:true,force:true});}
});
