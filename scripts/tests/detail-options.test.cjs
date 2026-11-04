const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
test('rendered SKU collection switches colors, expands sold-out rows and associates real option prices/images', {timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();
    await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
    await page.goto('https://detail.1688.com/offer/123.html');
    await page.setContent(`<div id="productTitle"><div class="title-content"><h1>珠链</h1></div></div><div id="mainPrice"><div class="price-info">¥0.02~0.04</div></div><div id="description"></div><div id="skuSelection"><div class="feature-item"><h3>颜色</h3><button class="sku-filter-button active"><span class="label-name">银色</span><img src="https://img.test/silver.jpg"></button><button class="sku-filter-button"><span class="label-name">黑色</span><img src="https://img.test/black.jpg"></button></div><div class="feature-item"><h3>型号</h3><div id="rows"></div><div class="show-soldout-info"><a>展开售罄规格</a></div></div></div>`);
    await page.evaluate(()=>{
      window.job={id:'job1',status:'running'};
      window.chrome={storage:{local:{get:async()=>({imagegrabDetailJob:window.job})}}};
      const render=()=>{const black=document.querySelectorAll('.sku-filter-button')[1].classList.contains('active');document.getElementById('rows').innerHTML=`<div class="expand-view-item"><span class="item-label">10cm</span><span class="item-price-stock">${black?'¥0.04':'¥0.02'}</span><span class="item-price-stock">库存100条</span></div>`;document.querySelector('.show-soldout-info a').textContent='展开售罄规格';};
      document.querySelectorAll('.sku-filter-button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.sku-filter-button').forEach(x=>x.classList.toggle('active',x===b));render();});
      document.querySelector('.show-soldout-info a').onclick=()=>{document.getElementById('rows').insertAdjacentHTML('beforeend','<div class="expand-view-item"><span class="item-label">20cm</span><span class="item-price-stock">¥0.08</span><div class="item-count-invalid">库存不足</div></div>');document.querySelector('.show-soldout-info a').textContent='收起';};render();
    });
    for(const name of ['detail-capture.js','detail-options.js'])await page.addScriptTag({path:path.join(root,'imagegrab-extension',name)});
    const row=await page.evaluate(()=>imagegrabCollectOptions({offerId:'123',jobId:'job1',descriptionWaitMs:0,optionWaitMs:0,settleMs:0}));
    assert.equal(row.skus.length,4);assert.equal(row.optionCollection.status,'complete');
    assert.equal(row.skus[0].priceText,'¥0.02');assert.equal(row.skus[0].imageUrl,'https://img.test/silver.jpg');
    assert.equal(row.skus[2].priceText,'¥0.04');assert.equal(row.skus[2].imageUrl,'https://img.test/black.jpg');assert.equal(row.skus[3].stockText,'库存不足');
    assert.equal(await page.locator('.sku-filter-button.active .label-name').innerText(),'银色');
    await page.evaluate(()=>window.job.stopRequested=true);
    await assert.rejects(page.evaluate(()=>imagegrabCollectOptions({offerId:'123',jobId:'job1',descriptionWaitMs:0})),/已停止/);
  }finally{await browser.close();}
});
test('research page sends a separate scoped stage-two command and renders background progress', {timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(fs.readFileSync(path.join(root,'imagegrab-extension/research.html'),'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/<link[^>]+>/g,''));
    await page.evaluate(()=>{
      window.store={imagegrabResearchData:{products:[{id:'p1',title:'珠链'},{id:'p2',title:'木珠'}],offers:[{id:'o1',productId:'p1',url:'https://detail.1688.com/offer/123.html'},{id:'o2',productId:'p2',url:'https://detail.1688.com/offer/456.html'}],certificates:[]}};
      window.listeners=[];window.sent=[];
      window.chrome={storage:{local:{get:async k=>({[k]:window.store[k]}),set:async d=>Object.assign(window.store,d)},onChanged:{addListener:f=>window.listeners.push(f)}},runtime:{sendMessage:async message=>{
        if(message.type==='DETAIL_JOB_STATUS')return {ok:true,supported:true,version:'1.6.1'};
        window.sent.push(message);
        const j={id:'ui-test',status:message.type==='DETAIL_JOB_STOP'?'paused':'running',items:[{title:'珠链',url:'https://detail.1688.com/offer/123.html',status:'running'}]};window.store.imagegrabDetailJob=j;for(const f of window.listeners)f({imagegrabDetailJob:{newValue:j}},'local');return {ok:true};
      }}};
    });
    for(const name of ['offer-data.js','research.js'])await page.addScriptTag({path:path.join(root,'imagegrab-extension',name)});
    await page.locator('.product-row').first().waitFor();
    await page.locator('.product-row').filter({hasText:'珠链'}).click();await page.locator('#detail-job-scope').selectOption('selected');await page.locator('#detail-job-start').click();
    const sent=await page.evaluate(()=>window.sent);assert.equal(sent[0].type,'DETAIL_JOB_START');assert.deepEqual(sent[0].productIds,['p1']);
    assert.equal(await page.locator('#detail-job-start').isDisabled(),true);assert.match(await page.locator('#detail-job-status').innerText(),/采集中/);
    await page.locator('#new-product').click();assert.equal(await page.locator('#product-dialog').evaluate(d=>d.open),false);
    await page.locator('#detail-job-stop').click();assert.equal((await page.evaluate(()=>window.sent))[1].type,'DETAIL_JOB_STOP');assert.equal(await page.locator('#detail-job-resume').isVisible(),true);
    await page.evaluate(()=>{window.chrome.runtime.sendMessage=async message=>{window.sent.push(message);return undefined;};window.sent=[];});
    await page.locator('#detail-job-start').click();
    assert.match(await page.locator('#toast').innerText(),/后台尚未加载.*重新加载 ImageGrab/);
    assert.deepEqual(await page.evaluate(()=>window.sent.map(x=>x.type)),['DETAIL_JOB_STATUS']);
  }finally{await browser.close();}
});
