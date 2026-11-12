const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),source=path.join(root,'imagegrab-extension');
require(path.join(source,'sourcing-search.js'));
const check=globalThis.ImageGrabSearchReady.check;

test('result validation rejects default recommendations, wrong query, pending navigation and unchanged list',()=>{
  const url='https://s.1688.com/selloffer/offer_search.htm?keywords=%BF%A8%CD%A8';
  const state={url,readyState:'complete',keyword:'卡通猫咪发夹',count:2,signature:'new',busy:false};
  const expected={channel:'name',keyword:'卡通猫咪发夹',baselineSignature:'default'};
  assert.equal(check(state,expected,{url}).ok,true);
  assert.equal(check({...state,url:url.split('?')[0]},expected,{url:url.split('?')[0]}).ok,undefined);
  assert.equal(check({...state,keyword:'牛奶'},expected,{url}).ok,undefined);
  assert.equal(check(state,expected,{url,pendingUrl:url}).ok,undefined);
  assert.equal(check({...state,signature:'default'},expected,{url}).ok,undefined);
  assert.equal(check({...state,busy:true},expected,{url}).ok,undefined);
  assert.match(check({...state,challenge:true},expected,{url}).fatal,/安全验证/);
  const image={channel:'image',baselineSignature:'default'};
  assert.equal(check(state,image,{url}).ok,undefined);
  const imageUrl='https://air.1688.com/kapp/1688-search/pc-image-search/?imageId=1234';
  assert.equal(check({...state,url:imageUrl},image,{url:imageUrl}).ok,true);
});

test('native image upload waits for delayed platform search button, then actually clicks it', {timeout:20000},async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<input type="file" accept="image/*"><div class="copy-image-container"></div>');
    await page.evaluate(()=>document.querySelector('input').onchange=e=>{
      window.uploaded=e.target.files[0]?.name;
      setTimeout(()=>{const b=document.createElement('div');b.className='search-btn';b.textContent='搜索图片';b.onclick=()=>window.searchClicked=true;document.querySelector('.copy-image-container').append(b);},500);
    });
    await page.addScriptTag({path:path.join(source,'sourcing-native.js')});
    const jpeg=await page.evaluate(()=>document.createElement('canvas').toDataURL('image/jpeg'));
    const result=await page.evaluate(data=>upload1688Reference(data),jpeg);
    assert.equal(result.ok,true);assert.equal(await page.evaluate(()=>window.searchClicked),true);
    assert.equal(await page.evaluate(()=>window.uploaded),'imagegrab-reference.jpg');
  }finally{await browser.close();}
});

// Exercise the production background handler with a virtual clock and delayed DOM.
// Unlike an always-successful message stub, it fails if even one stale row is saved.
function backgroundFixture({challenge=false,stop=false}={}){
  let tick=0,reads=0;
  const defaultUrl='https://s.1688.com/selloffer/offer_search.htm';
  const target=defaultUrl+'?keywords=%BF%A8%CD%A8';
  const expected={token:'search-test',tabId:7,channel:'name',keyword:'卡通猫咪发夹',baselineSignature:'default'};
  const job={running:true,stop:false,runId:'run-test',tabs:[expected]};
  const storage={imagegrabSourcingAutoJob:job,imagegrabSourcingAutoRun:{id:'run-test',status:'running',candidates:[]}};
  const added=[];
  const chrome={
    runtime:{onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
    alarms:{onAlarm:{addListener(){}}},action:{onClicked:{addListener(){}}},
    storage:{local:{get:async k=>({[k]:storage[k]}),set:async obj=>Object.assign(storage,obj)}},
    tabs:{get:async()=>({id:7,url:tick<800?defaultUrl:target}),sendMessage:async()=>{reads++;return{ok:true,sourceUrl:target,products:[{title:'目标猫咪发夹',url:'https://detail.1688.com/offer/956241914550.html'}]};}},
    scripting:{executeScript:async()=>[{result:{url:tick<800?defaultUrl:target,readyState:'complete',keyword:'卡通猫咪发夹',count:3,signature:tick<2400?'default':'target',challenge:challenge&&tick>=800,busy:false}}]}
  };
  class Clock extends Date{static now(){return tick;}}
  const sandbox=vm.createContext({chrome,URL,Date:Clock,crypto:require('node:crypto').webcrypto,console,
    setTimeout:fn=>{tick+=800;if(stop&&tick>=3200)job.stop=true;queueMicrotask(fn);},
    importScripts(){},ImageGrabDetailJobs:{create:()=>({kick(){}})},ImageGrabSearchReady:globalThis.ImageGrabSearchReady,
    ImageGrabSourcingMatch:{},ImageGrabSourcingStore:{create:()=>({addAuto:async(rows,provenance)=>{added.push({rows,provenance,at:tick});return{ok:true,received:rows.length};}})}});
  vm.runInContext(fs.readFileSync(path.join(source,'sourcing-native.js'),'utf8'),sandbox);
  vm.runInContext(fs.readFileSync(path.join(source,'background.js'),'utf8'),sandbox);
  return{call:extra=>sandbox.handleSourcing({type:'SOURCING_AUTO_CAPTURE',runId:'run-test',tabId:7,channel:'name',searchToken:'search-test',timeoutMs:10000,...extra}),added,get reads(){return reads;}};
}
test('background waits for navigation AND replacement of default cards before saving',async()=>{
  const f=backgroundFixture();const result=await f.call();
  assert.equal(result.ok,true);assert.equal(f.reads,1);assert.equal(f.added.length,1);
  assert.ok(f.added[0].at>=4000);assert.match(f.added[0].provenance.url,/keywords=/);assert.equal(f.added[0].provenance.verified,true);
});
test('background refuses mismatched search token, safety challenge and stopped task without saving',async()=>{
  const bad=backgroundFixture();await assert.rejects(bad.call({searchToken:'wrong'}),/凭证/);assert.equal(bad.added.length,0);
  const gate=backgroundFixture({challenge:true});await assert.rejects(gate.call(),/安全验证/);assert.equal(gate.reads,0);
  const stopped=backgroundFixture({stop:true});await assert.rejects(stopped.call(),/停止/);assert.equal(stopped.added.length,0);
});
