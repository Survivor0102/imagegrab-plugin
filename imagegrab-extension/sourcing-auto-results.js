/* The screenshot run owns its result view; reloading never replaces it with the manual pool. */
(() => {
  'use strict';
  const $=s=>document.querySelector(s),match=ImageGrabSourcingMatch;
  let run=null,report=null,busy=false,controller=null,revision=0;
  const status=text=>{$('#auto-score-status').textContent=text;};
  async function send(type,extra={}){const reply=await chrome.runtime.sendMessage({type,...extra});if(!reply?.ok)throw Error(reply?.error||'自动寻源操作未成功');return reply;}
  function summary(){return report?{total:report.total,shortlist:report.shortlist.length,review:report.review.length,remaining:report.remaining.length,excluded:report.excluded.length}:null;}
  function criteriaFor(saved){
    const verifiedImageSearch=(saved?.candidates||[]).some(row=>(row.sources||[]).some(source=>source.channel==='image'&&source.verified===true));
    return {...(saved?.criteria||{}),hasReference:Boolean(saved?.reference),nativeImageSearch:Boolean(saved?.criteria?.nativeImageSearch||verifiedImageSearch)};
  }
  function render(){
    $('#auto-saved-results').hidden=!run; if(!run)return;
    const group=$('#auto-result-view').value,rows=report?.[group]||[];
    const compared=Object.values(run.evaluations||{}).filter(v=>Number.isFinite(v.visualScore)).length;
    $('#auto-saved-title').textContent=run.criteria?.name||'图片寻源候选';
    $('#auto-saved-meta').textContent=`${new Date(run.startedAt||run.updatedAt).toLocaleString('zh-CN')} · 已保存在此浏览器 · ${run.candidates.length} 个候选 · ${run.status==='running'?'采集进行中':run.status==='paused'?'采集已暂停':'采集已结束'}`;
    const image=run.reference?.image||run.reference?.original||'';
    $('#auto-saved-reference').hidden=!image;
    if(image&&$('#auto-saved-reference').src!==image)$('#auto-saved-reference').src=image;
    $('#auto-result-count').textContent=report?`优先 ${report.shortlist.length} · 待确认 ${report.review.length} · 其余 ${report.remaining.length} · 排除 ${report.excluded.length} · 共 ${report.total}`:'尚未收集候选';
    $('#auto-score-help').textContent=run.criteria?.nativeImageSearch?`已按1688图片搜索原始顺序排列。本地图片分仅作辅助参考，不代表同款概率。${compared?`已实际比对 ${compared}/${run.candidates.length} 件。`:''}`:compared?`已实际比对 ${compared}/${run.candidates.length} 件的图片。外观分只是本地像素线索，排序分不是同款概率。`:'尚未进行本地图片比对。只有图搜来源而没有文字匹配依据时显示“未评分”，保留在待确认；可以点击下方按钮读取候选图片并评分。';
    $('#auto-results').innerHTML=rows.length?ImageGrabSourcingResults.cards(rows,run.selected||[]):'<p class="muted">当前分组没有候选，可以切换到“待确认”。</p>';
    for(const id of ['auto-score','auto-select-top','auto-admit','auto-enrich','auto-export'])$('#'+id).disabled=busy||run.status==='running';
    $('#auto-cancel-score').hidden=!busy;
  }
  async function load(runId){
    const seq=++revision,data=await chrome.storage.local.get(['imagegrabSourcingAutoRun','imagegrabSourcingAutoJob']);if(seq!==revision)return;
    const saved=data.imagegrabSourcingAutoRun;
    if(runId&&saved?.id!==runId)throw Error('本次自动寻源结果已被新任务替换');
    const changedRun=run?.id!==saved?.id;
    run=saved||null;report=null;
    if(run?.candidates?.length){
      run.criteria=criteriaFor(run);
      report=match.screen(run.candidates.map(row=>({...row,visualScore:run.evaluations?.[row.url]?.visualScore})),run.criteria);
      const remembered=sessionStorage.getItem(`imagegrab:auto-group:${run.id}`);
      if(changedRun)$('#auto-result-view').value=['shortlist','review','remaining','excluded'].includes(remembered)?remembered:report.shortlist.length?'shortlist':'review';
    }
    render();
    if(run&&!$('#auto-reference-file').files.length)$('#auto-intake-form').open=false;
    if(data.imagegrabSourcingAutoJob?.running)$('#auto-job-status').textContent='截图寻源任务正在进行；下方显示当前已保存的候选。';
  }
  async function scoreRun(runId,requestPermission=false){
    if(busy)throw Error('正在比对图片，请稍候或先停止');
    await load(runId);if(!run?.candidates.length)throw Error('本次截图还没有候选');
    const permission=await chrome.permissions.contains({origins:['https://*.alicdn.com/*']});
    let allowed=permission;
    if(requestPermission&&!allowed)allowed=await chrome.permissions.request({origins:['https://*.alicdn.com/*']});
    if(requestPermission&&!allowed){status('图片读取权限未开启，候选保留；尚未执行图片评分。');return false;}
    const currentId=run.id;
    busy=true;controller=new AbortController();render();
    try{
      run.criteria={...criteriaFor(run),hasImage:Boolean(allowed&&run.reference)};
      const result=await ImageGrabSourcingResults.screen(run,{signal:controller.signal,onProgress:p=>status(`正在本地比对图片 ${p.current}/${p.total}；已比对 ${p.compared} 件。`)});
      await send('SOURCING_AUTO_UPDATE',{runId:currentId,patch:{criteria:run.criteria,evaluations:result.evaluations,selected:[]}});
      run.evaluations=result.evaluations;run.selected=[];report=result.report;
      $('#auto-result-view').value=report.shortlist.length?'shortlist':'review';
      status(run.criteria.hasImage?`${result.aborted?'已停止，保留已比对结果':'图片比对完成'}：实际比对 ${result.compared} 件，${result.failed} 件读取失败。`:'候选已整理；尚未进行图片比对，请点击“比对候选图片并评分”。');
      return true;
    }finally{busy=false;controller=null;render();}
  }
  function present(){document.querySelector('[data-sourcing-mode="image"]')?.click();$('#auto-intake-form').open=false;$('#auto-saved-results').scrollIntoView({block:'start'});}
  const action=(id,fn)=>$(id).addEventListener('click',async()=>{try{await fn();}catch(error){status(error.message);}});
  action('#auto-score',async()=>{if(run)await scoreRun(run.id,true);});
  action('#auto-cancel-score',()=>controller?.abort());
  action('#auto-select-top',async()=>{if(!report||!run)return;run.selected=report.shortlist.map(r=>r.url);await send('SOURCING_AUTO_UPDATE',{runId:run.id,patch:{selected:run.selected}});render();status(`已勾选 ${run.selected.length} 件。`);});
  for(const [id,type]of[['#auto-admit','SOURCING_ADMIT'],['#auto-enrich','SOURCING_ENRICH']])action(id,async()=>{if(!run?.selected?.length)throw Error('请先勾选候选商品');const reply=await send(type,{runId:run.id,urls:run.selected});status(type==='SOURCING_ADMIT'?`已加入 ${reply.count} 件候选，尚未确认同款。`:`已为 ${reply.count} 件勾选候选启动详情任务。`);});
  action('#auto-export',()=>{if(!run)return;const blob=new Blob([JSON.stringify({...run,exportedAt:new Date().toISOString(),identity:'截图寻源候选，不等于同款认证'},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ImageGrab_截图寻源候选.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  $('#auto-result-view').addEventListener('change',()=>{if(run)sessionStorage.setItem(`imagegrab:auto-group:${run.id}`,$('#auto-result-view').value);render();});
  $('#auto-results').addEventListener('change',async e=>{const url=e.target.dataset.url;if(!url||!run||busy)return;run.selected=e.target.checked?[...new Set([...(run.selected||[]),url])]:(run.selected||[]).filter(x=>x!==url);try{await send('SOURCING_AUTO_UPDATE',{runId:run.id,patch:{selected:run.selected}});}catch(error){status(error.message);}});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&!busy&&(changes.imagegrabSourcingAutoRun||changes.imagegrabSourcingAutoJob))load().catch(error=>status(error.message));});
  globalThis.ImageGrabAutoResults={load,scoreRun,present,getSummary:summary};
  load().catch(error=>status(error.message));
})();
