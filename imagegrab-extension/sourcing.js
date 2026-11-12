(() => {
  'use strict';
  const $=s=>document.querySelector(s),match=ImageGrabSourcingMatch;
  const resultCount=()=>$('#sourcing-result-count')||$('#result-count');
  const fields=['mode','name','category','specs','brand','model','required','exclude','limit'];
  let state={criteria:{},candidates:[],selected:[],reference:null},report=null,bitmap=null,crop=null,drag=null,controller=null,busy=false,compareReference=true;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status=text=>{$('#status').textContent=text;};
  async function send(type,extra={}){const reply=await chrome.runtime.sendMessage({type,...extra});if(!reply?.ok)throw Error(reply?.error||'后台未加载筛选功能，请重载 ImageGrab 后刷新页面');return reply;}
  function criteria(){return Object.fromEntries(fields.map(id=>[id,id==='limit'?Number($('#'+id).value):$('#'+id).value]).concat([['hasImage',Boolean(state.reference)&&compareReference],['hasReference',Boolean(state.reference)]]));}
  const persist=patch=>send('SOURCING_UPDATE',{patch});
  function poolCount(){$('#pool-status').textContent=`独立候选池：${state.candidates.length} 件（按商品链接去重）。尚未勾选导入的候选不会加入商品池。`;}
  async function load(){report=null;bitmap?.close();bitmap=null;crop=null;$('#crop-wrap').hidden=true;resultCount().textContent='';$('#results').textContent='';state=(await send('SOURCING_GET')).state;compareReference=state.criteria?.hasImage!==false;for(const id of fields)$('#'+id).value=state.criteria?.[id]??(id==='mode'?'alternative':id==='limit'?10:'');poolCount();if(state.reference?.original){await loadBitmap(state.reference.original);crop=state.reference.crop||null;draw();}if(state.candidates.length&&(state.criteria.name||state.criteria.category||state.reference)){report=match.screen(state.candidates.map(row=>({...row,visualScore:state.evaluations?.[row.url]?.visualScore})),{...state.criteria,hasImage:Boolean(state.reference)&&compareReference});render();}}
  async function tabs(){const selected=$('#source-tab').value,reply=await send('SOURCING_TABS');$('#source-tab').innerHTML=reply.tabs.length?reply.tabs.map(t=>`<option value="${Number(t.id)}">${esc(t.title||t.url)}</option>`).join(''):'<option value="">请先打开1688搜索结果页</option>';if(reply.tabs.some(t=>String(t.id)===selected))$('#source-tab').value=selected;}
  function render(){
    if(!report)return;
    resultCount().textContent=`优先 ${report.shortlist.length} · 待确认 ${report.review.length} · 其余 ${report.remaining.length} · 排除 ${report.excluded.length} · 共 ${report.total}`;
    const rows=report[$('#result-view').value]||[];
    $('#results').innerHTML=rows.length?ImageGrabSourcingResults.cards(rows,state.selected):'<p class="muted">当前分组没有候选；可以切换到“待确认”查看缺少的依据。</p>';
  }
  async function loadBitmap(data){bitmap?.close();bitmap=await createImageBitmap(await (await fetch(data)).blob());$('#crop-wrap').hidden=false;const canvas=$('#reference-canvas');canvas.width=Math.min(420,bitmap.width);canvas.height=Math.round(bitmap.height*canvas.width/bitmap.width);draw();}
  function draw(){if(!bitmap)return;const canvas=$('#reference-canvas'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);if(crop){ctx.strokeStyle='#ed580b';ctx.lineWidth=2;ctx.strokeRect(crop.x*canvas.width,crop.y*canvas.height,crop.w*canvas.width,crop.h*canvas.height);}}
  function point(e){const r=$('#reference-canvas').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
  async function applyCrop(){if(!bitmap)return;const r=crop||{x:0,y:0,w:1,h:1},canvas=document.createElement('canvas');const width=Math.max(1,Math.round(bitmap.width*r.w)),height=Math.max(1,Math.round(bitmap.height*r.h));const ratio=Math.min(1,1200/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));canvas.getContext('2d').drawImage(bitmap,r.x*bitmap.width,r.y*bitmap.height,width,height,0,0,canvas.width,canvas.height);state.reference={original:state.reference.original,image:canvas.toDataURL('image/jpeg',.9),crop};state.evaluations={};state.selected=[];await persist({reference:state.reference,evaluations:{},selected:[]});report=null;$('#results').textContent='参考图已更新，请重新筛选。';status('参考图已保存；本地比对和1688图片搜索均使用当前框选区域。');}
  async function screen(){
    if(busy)return;busy=true;controller=new AbortController();const locked=[...document.querySelectorAll('#sourcing-manual input,#sourcing-manual select,#sourcing-manual button')].filter(x=>x.id!=='cancel-screen');for(const el of locked)el.disabled=true;$('#cancel-screen').hidden=false;
    try{
      const c=criteria();state.criteria=c;state.selected=[];await persist({criteria:c,selected:[]});
      const result=await ImageGrabSourcingResults.screen(state,{signal:controller.signal,onProgress:p=>status(`正在本地比对图片 ${p.current}/${p.total}；已读到 ${p.compared} 件。`)});
      report=result.report;state.evaluations=result.evaluations;const compared=result.compared;
      await persist({criteria:c,evaluations:state.evaluations,selected:[]});
      if(!report.shortlist.length&&report.review.length)$('#result-view').value='review';
      render();
      status(`${controller.signal.aborted?'已停止，保留已比对结果':'筛选完成'}：共 ${report.total} 件，优先 ${report.shortlist.length} 件。${c.hasImage?`实际比对图片 ${compared} 件，${result.failed} 件图片读取失败；每次最多比对100件，每件最多2张。`:''}\n未比对或条件缺失的商品仍保留在待确认中；排序分不是同款概率。`);
    }finally{busy=false;for(const el of locked)el.disabled=false;$('#cancel-screen').hidden=true;controller=null;}
  }
  const action=(id,fn)=>$(id).addEventListener('click',async()=>{const button=$(id);button.disabled=true;try{await fn();}catch(error){status(error.message);}finally{button.disabled=false;}});
  action('#tabs-refresh',tabs);
  action('#capture',async()=>{if(busy)throw Error('请先停止筛选');if(!Number($('#source-tab').value))throw Error('请刷新标签列表并选择1688搜索结果页');await persist({criteria:criteria()});const reply=await send('SOURCING_CAPTURE',{tabId:Number($('#source-tab').value),channel:$('#channel').value});await load();status(`本页读取 ${reply.received} 条，去重后独立候选池共 ${reply.total} 件。`);});
  action('#from-pool',async()=>{if(busy)throw Error('请先停止筛选');await persist({criteria:criteria()});const reply=await send('SOURCING_FROM_POOL');await load();status(`已读取商品池；候选共 ${reply.total} 件。`);});
  action('#clear-pool',async()=>{if(busy)throw Error('请先停止筛选');await send('SOURCING_CLEAR');report=null;await load();$('#results').textContent='本次候选已清空，商品池资料保留。';resultCount().textContent='';status('可开始下一次候选收集。');});
  action('#allow-images',async()=>{const granted=await chrome.permissions.request({origins:['https://*.alicdn.com/*']});compareReference=granted;await persist({criteria:criteria()});status(granted?'商品图片读取权限已开启，可进行本地比对。':'图片权限未开启；名称筛选仍可使用。');});
  action('#screen',screen);action('#cancel-screen',()=>controller?.abort());
  action('#crop-apply',applyCrop);action('#crop-reset',async()=>{crop=null;draw();await applyCrop();});
  action('#reference-clear',async()=>{bitmap?.close();bitmap=null;crop=null;state.reference=null;compareReference=false;state.evaluations={};state.selected=[];$('#reference-file').value='';$('#crop-wrap').hidden=true;report=null;await persist({reference:null,evaluations:{},selected:[],criteria:criteria()});$('#results').textContent='参考图已移除，请重新筛选。';status('已切换为名称和文字条件筛选。');});
  action('#text-search',async()=>{const c=criteria();await persist({criteria:c});await send('SOURCING_SEARCH',{keyword:c.name||c.category});status('名称搜索已提交；在1688结果页加载后，回到这里读取候选。');await tabs();});
  action('#image-search',async()=>{if(!state.reference)throw Error('请先上传参考图');const reply=await send('SOURCING_IMAGE_SEARCH',{image:state.reference.image});status(reply.message);await tabs();});
  action('#select-top',async()=>{if(!report)throw Error('请先筛选');state.selected=report.shortlist.map(r=>r.url);await persist({selected:state.selected});render();status(`已勾选 ${state.selected.length} 件；可继续调整。`);});
  for(const [id,type] of [['#admit','SOURCING_ADMIT'],['#enrich','SOURCING_ENRICH']])action(id,async()=>{if(busy)throw Error('请先停止筛选');if(!state.selected.length)throw Error('请先勾选候选商品');const reply=await send(type,{urls:state.selected});status(type==='SOURCING_ADMIT'?`已加入 ${reply.count} 件候选，尚未确认同款。`:`已为 ${reply.count} 件勾选候选启动详情任务。`);});
  action('#export',()=>{const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString(),identity:'候选筛选记录，不等于同款认证'},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ImageGrab_图片名称筛选.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  $('#result-view').addEventListener('change',render);
  $('#results').addEventListener('change',async e=>{const url=e.target.dataset.url;if(!url)return;if(e.target.checked)state.selected=[...new Set([...state.selected,url])];else state.selected=state.selected.filter(x=>x!==url);try{await persist({selected:state.selected});}catch(error){status(error.message);}});
  for(const id of fields)$('#'+id).addEventListener('change',async()=>{controller?.abort();report=null;state.selected=[];$('#results').textContent='条件已变更，请重新筛选。';try{await persist({criteria:criteria(),selected:[]});}catch(error){status(error.message);}});
  $('#reference-file').addEventListener('change',async e=>{try{if(busy)throw Error('请先停止筛选');const file=e.target.files[0];if(!file)return;if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>12*1024*1024)throw Error('请使用不超过12MB的PNG/JPEG/WebP图片');const image=await createImageBitmap(file),canvas=document.createElement('canvas'),ratio=Math.min(1,1600/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();compareReference=true;state.reference={original:canvas.toDataURL('image/jpeg',.9)};crop=null;await loadBitmap(state.reference.original);await applyCrop();}catch(error){status(error.message);}});
  $('#reference-canvas').addEventListener('pointerdown',e=>{if(busy)return;drag=point(e);e.target.setPointerCapture(e.pointerId);});
  $('#reference-canvas').addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);crop={x:Math.min(p.x,drag.x),y:Math.min(p.y,drag.y),w:Math.abs(p.x-drag.x),h:Math.abs(p.y-drag.y)};draw();});
  $('#reference-canvas').addEventListener('pointerup',()=>{drag=null;if(crop&&(crop.w<.02||crop.h<.02))crop=null;draw();});
  function jobText(job){$('#job-status').textContent=job?`详情任务：${{running:'进行中',paused:'已暂停',complete:'已结束',finished_with_errors:'已结束，存在未完成项'}[job.status]||job.status}；完成 ${job.items?.filter(x=>x.status==='complete').length||0} / ${job.items?.length||0} ${job.reason||''}`:'';}
  for(const button of document.querySelectorAll('[data-sourcing-mode="manual"]'))button.addEventListener('click',async()=>{await load().catch(error=>status(error.message));});
  globalThis.ImageGrabSourcingUI={load,runScreen:async()=>{await screen();return Boolean(report);},getSummary:()=>report?{total:report.total,shortlist:report.shortlist.length,review:report.review.length,remaining:report.remaining.length,excluded:report.excluded.length}:null};
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.imagegrabDetailJob)jobText(changes.imagegrabDetailJob.newValue);});
  (async()=>{try{await load();await tabs();jobText((await chrome.storage.local.get('imagegrabDetailJob')).imagegrabDetailJob);}catch(error){status(error.message);}})();
})();
