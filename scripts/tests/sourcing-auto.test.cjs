const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'../..');
const chromePath=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';

test('screenshot intake coordinates image search, name search, candidate capture and existing screening', {timeout:30000,skip:!require('node:fs').existsSync(chromePath)},async()=>{
  const browser=await chromium.launch({executablePath:chromePath,headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(`<!doctype html><meta charset="utf-8"><input id="auto-reference-file" type="file"><img id="auto-preview" hidden><p id="auto-ocr-status"></p><pre id="auto-raw-text"></pre><section id="auto-fields" hidden><input id="auto-title"><input id="auto-brand"><input id="auto-category"><input id="auto-specs"><input id="auto-barcode"><input id="auto-sku"><input id="auto-spu"><p id="auto-confidence"></p></section><div id="crop-wrap" hidden></div><button id="auto-run" disabled></button><button id="auto-stop" hidden></button><p id="auto-job-status"></p><button data-view="sourcing"></button><button data-sourcing-mode="image"></button>`);
    await page.evaluate(()=>{
      window.__messages=[];window.__mode='image';window.__patches=[];window.__autoRunId='';
      window.chrome={
        runtime:{getURL:value=>`chrome-extension://fixture/${value}`,sendMessage:async message=>{window.__messages.push(message);if(message.type==='SOURCING_AUTO_UPDATE')window.__patches.push(message.patch);if(message.type==='SOURCING_IMAGE_SEARCH')return{ok:true,submitted:true,tabId:11};if(message.type==='SOURCING_SEARCH')return{ok:true,tabId:12};if(message.type==='SOURCING_AUTO_CAPTURE')return{ok:true,received:2,total:2};return{ok:true};}},
        storage:{local:{get:async()=>({imagegrabSourcingAutoJob:{running:true,stop:false}})}},
        permissions:{contains:async()=>false}
      };
      window.Tesseract={createWorker:async()=>({recognize:async file=>{if(!(file instanceof File))throw Error('OCR input must remain a local File');return{data:{text:'悦鲜活 鲜牛奶 260ml\n品牌：悦鲜活',confidence:91}};},terminate(){}})};
      window.ImageGrabAutoResults={load:async runId=>{window.__autoRunId=runId;},present:()=>{window.__presented=true;document.querySelector('[data-view="sourcing"]').click();document.querySelector('[data-sourcing-mode="image"]').click();},scoreRun:async runId=>{window.__autoRunId=runId;return true;},getSummary:()=>({total:3,shortlist:1,review:1,remaining:1})};
      document.querySelector('[data-view="sourcing"]').addEventListener('click',()=>window.__view='sourcing');
      document.querySelector('[data-sourcing-mode="image"]').addEventListener('click',()=>window.__mode='image');
    });
    await page.addScriptTag({path:path.join(root,'imagegrab-extension/sourcing-image.js')});
    await page.addScriptTag({path:path.join(root,'imagegrab-extension/sourcing-auto.js')});
    const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;return canvas.toDataURL('image/png').split(',')[1];});
    await page.locator('#auto-reference-file').setInputFiles({name:'商品截图.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
    await page.locator('#auto-fields').waitFor({state:'visible'});
    assert.equal(await page.locator('#auto-title').inputValue(),'悦鲜活 鲜牛奶 260ml');
    await page.locator('#auto-run').click();
    await page.locator('#auto-job-status').filter({hasText:'自动流程已完成'}).waitFor();
    const result=await page.evaluate(()=>({messages:window.__messages,patches:window.__patches,autoRunId:window.__autoRunId,presented:window.__presented,mode:window.__mode,view:window.__view}));
    const types=result.messages.map(message=>message.type);
    assert.ok(types.indexOf('SOURCING_AUTO_BEGIN')<types.indexOf('SOURCING_IMAGE_SEARCH'));
    assert.ok(types.indexOf('SOURCING_IMAGE_SEARCH')<types.indexOf('SOURCING_SEARCH'));
    assert.deepEqual(result.messages.filter(message=>message.type==='SOURCING_AUTO_CAPTURE').map(message=>message.channel),['image','name']);
    assert.deepEqual(result.patches[0].criteria,{mode:'alternative',name:'悦鲜活 鲜牛奶 260ml',brand:'',model:'',category:'鲜牛奶 牛奶',specs:'260ml',required:'',exclude:'',limit:10,hasImage:false,hasReference:true});
    const runId=result.messages.find(message=>message.type==='SOURCING_AUTO_BEGIN').runId;
    assert.ok(runId);assert.equal(result.autoRunId,runId);
    assert.equal(result.presented,true);
    assert.ok(result.messages.filter(message=>message.type==='SOURCING_AUTO_CAPTURE').every(message=>message.runId===runId));
    assert.equal(types.includes('SOURCING_UPDATE'),false);
    assert.equal(result.view,'sourcing');
    assert.equal(result.mode,'image');
    assert.match(await page.locator('#auto-job-status').innerText(),/候选尚未加入商品池/);
  }finally{await browser.close();}
});

test('low confidence OCR runs image-only; zero verified results cannot be labelled complete', {timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:chromePath,headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<input id="auto-reference-file" type="file"><img id="auto-preview"><p id="auto-ocr-status"></p><pre id="auto-raw-text"></pre><section id="auto-fields" hidden>'+['title','brand','category','specs','barcode','sku','spu'].map(x=>`<input id="auto-${x}">`).join('')+'<p id="auto-confidence"></p></section><button id="auto-run" disabled>运行</button><button id="auto-stop" hidden></button><p id="auto-job-status"></p>');
    await page.evaluate(()=>{
      window.messages=[];window.failImage=false;
      window.chrome={runtime:{getURL:x=>x,sendMessage:async m=>{window.messages.push(m);if(m.type==='SOURCING_IMAGE_SEARCH')return{ok:true,submitted:!window.failImage,tabId:11,searchToken:'image-token',message:'图搜尚未提交'};if(m.type==='SOURCING_AUTO_CAPTURE')return{ok:true,received:60};return{ok:true};}},permissions:{contains:async()=>false}};
      window.Tesseract={createWorker:async()=>({recognize:async()=>({data:{text:'项隐于过ex yi',confidence:31}}),terminate(){}})};
      window.ImageGrabAutoResults={load:async()=>{},scoreRun:async()=>true,getSummary:()=>({total:60,shortlist:0,review:60}),present(){}};
    });
    await page.addScriptTag({path:path.join(root,'imagegrab-extension/sourcing-image.js')});
    await page.addScriptTag({path:path.join(root,'imagegrab-extension/sourcing-auto.js')});
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=80;return c.toDataURL('image/png').split(',')[1];});
    await page.locator('#auto-reference-file').setInputFiles({name:'拼图.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.locator('#auto-fields').waitFor({state:'visible'});assert.equal(await page.locator('#auto-title').inputValue(),'');
    await page.locator('#auto-run').click();await page.locator('#auto-job-status').filter({hasText:'自动流程已完成'}).waitFor();
    await page.waitForFunction(()=>window.messages.some(m=>m.type==='SOURCING_AUTO_FINISH'));
    let messages=await page.evaluate(()=>window.messages);
    assert.equal(messages.some(m=>m.type==='SOURCING_SEARCH'),false);
    assert.equal(messages.find(m=>m.type==='SOURCING_AUTO_CAPTURE').searchToken,'image-token');
    assert.match(await page.locator('#auto-job-status').innerText(),/未使用名称搜索/);
    await page.evaluate(()=>{window.messages=[];window.failImage=true;});
    await page.locator('#auto-run').click();await page.locator('#auto-job-status').filter({hasText:'阶段暂停'}).waitFor();
    await page.waitForFunction(()=>window.messages.some(m=>m.type==='SOURCING_AUTO_FINISH'));
    messages=await page.evaluate(()=>window.messages);
    assert.equal(messages.find(m=>m.type==='SOURCING_AUTO_FINISH').status,'paused');
    assert.equal(messages.some(m=>m.type==='SOURCING_AUTO_CAPTURE'),false);
  }finally{await browser.close();}
});
