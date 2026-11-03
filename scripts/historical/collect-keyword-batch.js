// Historical function recovered from the successful 2026-11-03 Node REPL.
// Requires context2, collectorPage, downloadsPage, getDownloadItems, seenDownloadPaths,
// fsp2 and collectionRoot initialized as documented. Not a standalone CLI.
var collectKeywordBatch = async (kw, pageNo, need, dirName, startNo) => {
  for (const p of context2.pages().filter(p=>p.url().startsWith('chrome-extension://')&&p.url().includes('gallery.html'))) await p.close().catch(()=>{});
  await collectorPage.goto('https://s.taobao.com/search?page='+pageNo+'&q='+encodeURIComponent(kw),{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
  await collectorPage.waitForTimeout(6500);
  let body=await collectorPage.locator('body').innerText();
  if(body.includes('加载中')) await collectorPage.waitForTimeout(5000);
  let button=collectorPage.getByRole('button',{name:'获取图片',exact:true});
  if(await button.count()===0) return {kw,pageNo,ok:false,reason:'button-missing'};
  await button.click();
  await collectorPage.waitForTimeout(3500);
  let gs=context2.pages().filter(p=>p.url().startsWith('chrome-extension://')&&p.url().includes('gallery.html'));
  let galleryPage=gs[gs.length-1];
  await galleryPage.waitForTimeout(1200);
  for(let i=0;i<80;i++){await galleryPage.evaluate(()=>window.scrollBy(0,Math.max(window.innerHeight*0.85,600)));await galleryPage.waitForTimeout(160);}
  await galleryPage.waitForTimeout(1800);
  let metas=await galleryPage.locator('img').evaluateAll(es=>es.map((e,i)=>({i,complete:e.complete,w:e.naturalWidth,h:e.naturalHeight,src:e.currentSrc||e.src})));
  let usable=metas.filter(x=>x.complete&&x.w>=100&&x.h>=100&&!/600000000|\/tps\/|icon|logo|sprite|placeholder|loading|avatar|emoji|qr/i.test(x.src));
  let chosen=usable.slice(0,need);
  for(const x of chosen) await galleryPage.locator('input[type=checkbox]').nth(x.i).check();
  await galleryPage.getByRole('button',{name:'下载选中'}).click();
  let status='';
  for(let i=0;i<240;i++){await galleryPage.waitForTimeout(1000);status=await galleryPage.locator('#status').innerText().catch(()=> '');if(status.includes('处理完成'))break;}
  for(let i=0;i<35;i++){await downloadsPage.evaluate(()=>{const m=document.querySelector('downloads-manager');const c=m?.shadowRoot?.querySelector('#mainContainer');if(c)c.scrollTop=c.scrollHeight;});await downloadsPage.waitForTimeout(120);}
  let all=await getDownloadItems();
  let fresh=all.filter(x=>x.path&&!seenDownloadPaths.has(x.path));
  let outDir=collectionRoot+'/'+dirName;
  await fsp2.mkdir(outDir,{recursive:true});
  let saved=0;
  for(let i=0;i<fresh.length;i++){try{await fsp2.copyFile(fresh[i].path,outDir+'/'+dirName+'_'+String(startNo+saved).padStart(3,'0')+'.png');seenDownloadPaths.add(fresh[i].path);saved++;}catch{}}
  await galleryPage.close().catch(()=>{});
  return {kw,pageNo,candidates:metas.length,usable:usable.length,requested:need,status,fresh:fresh.length,saved};
};
