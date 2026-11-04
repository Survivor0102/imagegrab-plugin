const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const chromePath='C:/Users/ASUS/Desktop/present_semester/企业实训/02_课程作业与项目/03_考核三/99_工具与临时文件/chrome-for-testing-154.0.8037.98/chrome-win64/chrome.exe';
test('installed extension runs the two-stage queue with real storage, tabs, scripting and worker messaging', {timeout:75000,skip:!fs.existsSync(chromePath)},async()=>{
  const source=path.join(root,'imagegrab-extension');
  fs.mkdirSync(path.join(root,'runtime'),{recursive:true});
  const profile=fs.mkdtempSync(path.join(root,'runtime','detail-extension-test-'));
  const context=await chromium.launchPersistentContext(profile,{executablePath:chromePath,headless:true,args:[`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
  try{
    await context.route('https://**/*',route=>{
      if(!/^https:\/\/detail\.1688\.com\/offer\/\d+\.html/.test(route.request().url()))return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8"></head><body>
        <div id="productTitle"><div class="title-content"><h1>安装扩展测试商品</h1></div></div><div id="mainPrice"><div class="price-info">¥1.00</div></div><div id="productAttributes"><div class="cpv-attr-item"><span class="cpv-attr-label">品牌</span><span class="cpv-attr-value">测试品牌</span></div></div><div id="shippingServices"><span class="location">浙江金华</span></div><div id="description"></div>
        <div id="skuSelection"><div class="feature-item"><h3>颜色</h3><button class="sku-filter-button active" onclick="selectColor(this)"><span class="label-name">银色</span><img src="https://img.test/silver.jpg"></button><button class="sku-filter-button" onclick="selectColor(this)"><span class="label-name">黑色</span><img src="https://img.test/black.jpg"></button></div><div class="feature-item"><h3>尺寸</h3><div class="expand-view-item"><span class="item-label">10cm</span><span class="item-price-stock" id="price">¥1.00</span><span class="item-price-stock">库存100条</span></div></div></div>
        <script>function selectColor(b){document.querySelectorAll('.sku-filter-button').forEach(x=>x.classList.toggle('active',x===b));document.getElementById('price').innerText=b.innerText==='黑色'?'¥2.00':'¥1.00';}</script></body></html>`});
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const extensionId=new URL(worker.url()).host;
    const page=await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/research.html`);
    await page.evaluate(async()=>chrome.storage.local.set({imagegrabResearchData:{products:[{id:'p1',title:'榜单商品一',sourceType:'ranking',rank:'1'},{id:'p2',title:'榜单商品二',sourceType:'ranking',rank:'2'}],offers:[{id:'o1',productId:'p1',url:'https://detail.1688.com/offer/12345678.html'},{id:'o2',productId:'p2',url:'https://detail.1688.com/offer/87654321.html'}],certificates:[]}}));
    await page.reload();await page.locator('.product-row').first().waitFor();
    const foreground=await page.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true})).map(t=>t.id));
    await page.locator('#detail-job-scope').selectOption('all');await page.locator('#detail-job-start').click();
    const deadline=Date.now()+55000;
    while(Date.now()<deadline){
      const status=await page.evaluate(async()=> (await chrome.storage.local.get('imagegrabDetailJob')).imagegrabDetailJob?.status);
      if(['complete','paused','finished_with_errors'].includes(status))break;
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    const result=await page.evaluate(async()=>{const d=await chrome.storage.local.get(['imagegrabDetailJob','imagegrabResearchData']);return {job:d.imagegrabDetailJob,data:d.imagegrabResearchData,active:(await chrome.tabs.query({active:true,lastFocusedWindow:true})).map(t=>t.id)};});
    assert.equal(result.job.status,'complete',JSON.stringify(result.job));
    assert.deepEqual(result.job.items.map(i=>i.status),['complete','complete']);assert.deepEqual(result.active,foreground);
    for(const offer of result.data.offers){assert.equal(offer.details.skus.length,2);assert.equal(offer.details.skus[0].priceText,'¥1.00');assert.equal(offer.details.skus[1].priceText,'¥2.00');assert.equal(offer.details.skus[1].imageUrl,'https://img.test/black.jpg');assert.equal(offer.shipFrom,'浙江金华');assert.equal(offer.details.optionCollection.status,'complete');}
    assert.equal(result.job.tabId,null);assert.equal(result.data.products[0].rank,'1');
    const evidence={checkedAt:new Date().toISOString(),kind:'installed-extension integration against routed synthetic 1688 pages; not live-site collection',version:'1.6.0',items:result.job.items.map(i=>({url:i.url,status:i.status,skuCount:i.skuCount,imageCount:i.imageCount})),status:result.job.status,preservedForeground:true};
    const evidenceDir=path.join(root,'evidence/2026-11-04');fs.mkdirSync(evidenceDir,{recursive:true});fs.writeFileSync(path.join(evidenceDir,'detail-job-installed-fixture-1.6.0.json'),JSON.stringify(evidence,null,2)+'\n');
  }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
});
