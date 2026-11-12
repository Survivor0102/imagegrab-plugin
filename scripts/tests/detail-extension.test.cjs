const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const chromePath='C:/Users/ASUS/Desktop/present_semester/企业实训/02_课程作业与项目/03_考核三/99_工具与临时文件/chrome-for-testing-154.0.8037.98/chrome-win64/chrome.exe';
test('installed extension runs the two-stage queue with real storage, tabs, scripting and worker messaging', {timeout:110000,skip:!fs.existsSync(chromePath)},async()=>{
  const source=path.join(root,'imagegrab-extension');
  fs.mkdirSync(path.join(root,'runtime'),{recursive:true});
  const profile=fs.mkdtempSync(path.join(root,'runtime','detail-extension-test-'));
  const context=await chromium.launchPersistentContext(profile,{executablePath:chromePath,headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding',`--disable-extensions-except=${source}`,`--load-extension=${source}`]});
  try{
    await context.route('https://**/*',route=>{
      if(route.request().url()==='https://page.1688.com/shtml/static/wrongpage.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><title>1688</title><h1>Error 404 抱歉，未找到页面</h1><p>2秒后为您自动跳转</p><script>setTimeout(()=>location.href="https://www.1688.com/",2000)</script>'});
      if(!/^https:\/\/detail\.1688\.com\/offer\/\d+\.html/.test(route.request().url()))return route.fulfill({status:404,body:''});
      if(route.request().url().includes('/offer/22222222.html'))return route.fulfill({status:302,headers:{location:'https://page.1688.com/shtml/static/wrongpage.html'}});
      if(route.request().url().includes('/offer/11111111.html'))return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><meta charset="utf-8"><title>商品详情</title></head><body><main>商品已下架</main></body></html>'});
      return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8"></head><body>
        <div id="productTitle"><div class="title-content"><h1>安装扩展测试商品</h1></div></div><div id="mainPrice"><div class="price-info">¥1.00</div></div><div id="productAttributes"><div class="cpv-attr-item"><span class="cpv-attr-label">品牌</span><span class="cpv-attr-value">测试品牌</span></div></div><div id="shippingServices"><span class="location">浙江金华</span></div><div id="description"></div>
        <div id="skuSelection"><div class="feature-item"><h3>颜色</h3><button class="sku-filter-button active" onclick="selectColor(this)"><span class="label-name">银色</span><img src="https://img.test/silver.jpg"></button><button class="sku-filter-button" onclick="selectColor(this)"><span class="label-name">黑色</span><img src="https://img.test/black.jpg"></button></div><div class="feature-item"><h3>尺寸</h3><div class="expand-view-item"><span class="item-label">10cm</span><span class="item-price-stock" id="price">¥1.00</span><span class="item-price-stock">库存100条</span></div></div></div>
        <script>function selectColor(b){document.querySelectorAll('.sku-filter-button').forEach(x=>x.classList.toggle('active',x===b));document.getElementById('price').innerText=b.innerText==='黑色'?'¥2.00':'¥1.00';}</script></body></html>`});
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const extensionId=new URL(worker.url()).host;
    const page=await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/research.html`);
    await page.evaluate(async()=>chrome.storage.local.set({imagegrabResearchData:{products:[{id:'p0',title:'下架商品'},{id:'p1',title:'榜单商品一',sourceType:'ranking',rank:'1'},{id:'p2',title:'榜单商品二',sourceType:'ranking',rank:'2'}],offers:[{id:'o0',productId:'p0',url:'https://detail.1688.com/offer/11111111.html'},{id:'o1',productId:'p1',url:'https://detail.1688.com/offer/12345678.html'},{id:'o2',productId:'p2',url:'https://detail.1688.com/offer/87654321.html'}],certificates:[]}}));
    await page.evaluate(async()=>{const key='imagegrabResearchData',data=(await chrome.storage.local.get(key))[key];data.products.unshift({id:'p404',title:'跳转404测试商品'});data.offers.unshift({id:'o404',productId:'p404',url:'https://detail.1688.com/offer/22222222.html'});await chrome.storage.local.set({[key]:data});});
    await page.evaluate(async()=>{const key='imagegrabResearchData',data=(await chrome.storage.local.get(key))[key];data.offers.find(o=>o.id==='o2').details={skus:[{value:'已完成的旧规格',imageUrl:'https://img.test/old-thumbnail.jpg'}],optionCollection:{status:'complete'}};await chrome.storage.local.set({[key]:data});});
    await page.reload();await page.locator('.product-row').first().waitFor();
    // Chrome-created tabs can navigate before Playwright installs the fixture
    // routing session. Gate only this test's create() until its page is attached;
    // production still uses the real tabs/storage/scripting APIs and queue times.
    await worker.evaluate(()=>{
      const create=chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.create=async options=>{
        globalThis.__detailFixturePageReady=false;
        const tab=await create(options),deadline=Date.now()+8000;
        while(!globalThis.__detailFixturePageReady&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
        if(!globalThis.__detailFixturePageReady)throw Error('Fixture routing session was not attached');
        return tab;
      };
    });
    context.on('page',async fixturePage=>{
      try{await fixturePage.evaluate(()=>true);await worker.evaluate(()=>{globalThis.__detailFixturePageReady=true;});}catch{}
    });
    const foreground=await page.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true})).map(t=>t.id));
    assert.equal(await page.locator('#detail-job-recapture').isChecked(),false);
    await page.locator('#detail-job-scope').selectOption('all');await page.locator('#detail-job-recapture').check();await page.locator('#detail-job-start').click();
    // Four items include three deliberate 12-second rate-limit gaps plus browser startup/navigation.
    const deadline=Date.now()+90000;
    while(Date.now()<deadline){
      const status=await page.evaluate(async()=> (await chrome.storage.local.get('imagegrabDetailJob')).imagegrabDetailJob?.status);
      if(['complete','paused','finished_with_errors'].includes(status))break;
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    const result=await page.evaluate(async()=>{const d=await chrome.storage.local.get(['imagegrabDetailJob','imagegrabResearchData']);return {job:d.imagegrabDetailJob,data:d.imagegrabResearchData,active:(await chrome.tabs.query({active:true,lastFocusedWindow:true})).map(t=>t.id)};});
    if(result.job.status!=='finished_with_errors')console.error('DETAIL TEST JOB',JSON.stringify(result.job));
    if(result.job.status!=='finished_with_errors')for(const p of context.pages())console.error('DETAIL TEST PAGE',p.url(),await p.locator('body').innerText().catch(()=>''));
    assert.equal(result.job.status,'finished_with_errors',JSON.stringify(result.job));
    assert.equal(result.job.recaptureCompleted,true);assert.equal(result.data.products.length,4);assert.equal(result.data.offers.length,4);
    assert.deepEqual(result.job.items.map(i=>i.status),['failed','unavailable','complete','complete'],JSON.stringify(result.job));assert.deepEqual(result.active,foreground);
    assert.equal(result.job.items[0].errorCode,'page_not_found');assert.equal(result.job.items[0].finalUrl,'https://page.1688.com/shtml/static/wrongpage.html');
    assert.equal(result.data.offers[0].details,undefined);assert.equal(result.data.offers[1].details,undefined);
    for(const offer of result.data.offers.slice(2)){assert.equal(offer.details.skus.length,2);assert.equal(offer.details.skus[0].priceText,'¥1.00');assert.equal(offer.details.skus[1].priceText,'¥2.00');assert.equal(offer.details.skus[1].imageUrl,'https://img.test/black.jpg');assert.equal(offer.shipFrom,'浙江金华');assert.equal(offer.details.optionCollection.status,'complete');}
    assert.equal(result.job.tabId,null);assert.equal(result.data.products[2].rank,'1');
    await page.locator('#detail-job-status').filter({hasText:'下架/失效 1'}).waitFor();
    assert.equal(await page.locator('#detail-job-resume').isVisible(),true);
    assert.match(await page.locator('#detail-job-items').textContent(),/1688页面未找到（404）/);
    const version=await page.evaluate(()=>chrome.runtime.getManifest().version);
    const evidence={checkedAt:new Date().toISOString(),kind:'installed-extension integration against routed synthetic 1688 pages; not live-site collection',version,items:result.job.items.map(i=>({url:i.url,status:i.status,errorCode:i.errorCode,finalUrl:i.finalUrl,skuCount:i.skuCount,imageCount:i.imageCount})),status:result.job.status,preservedForeground:true,redirect404ContinuedQueue:true,retryButtonVisible:true,recaptureCompleted:true,existingOfferUpdatedWithoutDuplicates:true};
    const evidenceDir=path.join(root,'evidence',new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}));fs.mkdirSync(evidenceDir,{recursive:true});fs.writeFileSync(path.join(evidenceDir,`detail-job-installed-fixture-${version}.json`),JSON.stringify(evidence,null,2)+'\n');
  }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
});
