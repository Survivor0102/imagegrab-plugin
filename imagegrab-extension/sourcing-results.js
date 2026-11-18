/* Shared candidate presentation and local image comparison, independent of a workspace tab. */
(() => {
  'use strict';
  const match=ImageGrabSourcingMatch;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safe=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}};
  function cards(rows,selected=[]){
    return rows.map(row=>{
      const scored=Number.isFinite(row.visualScore)||Number(row.score)>0&&row.reasons.some(reason=>!reason.includes('平台原始顺序优先'));
      const order=Number.isFinite(row.retrievalOrder)?` · 1688原始顺序 ${row.retrievalOrder+1}`:'';
      const brandLabel={same:'同品牌',different:'不同品牌'}[row.brandRelation] || ({same:'疑似同品牌',different:'疑似不同品牌'}[row.brandEvidence?.clueRelation] || '品牌待核');
      const substituteTags=row.substitute?`<div class="candidate-tags"><span class="candidate-tag ${row.brandRelation==='same'?'same':row.brandRelation==='different'?'different':''}">品牌关系：${esc(brandLabel)}</span><span class="candidate-tag ${row.targetSpecStatus==='included'?'same':row.targetSpecStatus==='excluded'?'different':''}">目标规格：${esc({included:'已知条件匹配',excluded:'存在规格冲突',unknown:'规格证据不足'}[row.targetSpecStatus]||'尚未核对')}</span></div>`:'';
      return `<article class="candidate"><label><input type="checkbox" data-url="${esc(row.url)}" ${selected.includes(row.url)?'checked':''}>加入本次选择</label>${substituteTags}${row.substitute&&row.specComparison?`<p class="spec-comparison">已核对 ${row.specComparison.matched.length}/${row.specComparison.requirements.length} 项 · 缺失 ${row.specComparison.missing.length} 项 · 冲突 ${row.specComparison.conflicts.length} 项</p>`:''}${safe(row.images?.[0])?`<img src="${esc(safe(row.images[0]))}" loading="lazy" alt="候选商品图">`:''}<h3>${esc(row.title)}</h3><p>${esc(row.priceText||'价格待补')} · ${esc(row.supplierName||'供应商待补')}</p><p class="score">${scored?`排序分 ${row.score} / 100`:'未评分'}${Number.isFinite(row.visualScore)?` · 外观参考分 ${row.visualScore}`:''}${order}</p><p class="reason">${esc(row.reasons.join('；')||'尚无本地匹配依据')}</p>${row.missing.length?`<p class="missing">${esc(row.missing.join('；'))}</p>`:''}${row.excluded.length?`<p class="excluded">${esc(row.excluded.join('；'))}</p>`:''}<p>${esc([...new Set((row.sources||[]).map(s=>({image:'图片搜索',name:'名称搜索',pool:'商品池'}[s.channel]||'页面采集')))].join(' + '))} · ${row.substitute?'候选，尚未确认同款':'同款尚未确认'}</p><a class="table-link" href="${esc(safe(row.url))}" target="_blank" rel="noopener">打开货源 ↗</a></article>`;
    }).join('');
  }
  async function descriptor(blob){
    const image=await createImageBitmap(blob);
    try{const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0,64,64);return match.describe(x.getImageData(0,0,64,64).data,64,64);}finally{image.close();}
  }
  function remoteImage(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='alicdn.com'||u.hostname.endsWith('.alicdn.com')||u.hostname==='1688.com'||u.hostname.endsWith('.1688.com'))?u.href:'';}catch{return '';}}
  async function screen(state,{signal,onProgress=()=>{}}={}){
    const criteria={...state.criteria,hasReference:Boolean(state.reference)};
    const rows=state.candidates.map(row=>({...row,visualScore:undefined}));let compared=0;const failures=new Set();
    if(criteria.hasImage&&state.reference?.image){
      const reference=await descriptor(await(await fetch(state.reference.image)).blob());
      const targets=rows.filter(r=>match.evaluate(r,criteria).status!=='excluded').sort((a,b)=>match.evaluate(b,criteria).score-match.evaluate(a,criteria).score).slice(0,100),cache=new Map();
      for(let i=0;i<targets.length;i++){
        if(signal?.aborted)break;
        onProgress({current:i+1,total:targets.length,compared});const row=targets[i],scores=[];
        for(const image of(row.images||[]).slice(0,2)){
          if(signal?.aborted)break;
          const url=remoteImage(image);if(!url)continue;
          try{
            if(!cache.has(url))cache.set(url,(async()=>{const timeout=AbortSignal.timeout(8000),response=await fetch(url,{credentials:'omit',signal:signal?AbortSignal.any([signal,timeout]):timeout});if(!response.ok)throw Error(`HTTP ${response.status}`);const blob=await response.blob();if(blob.size>12*1024*1024)throw Error('图片超过12MB');return descriptor(blob);})());
            scores.push(match.visualSimilarity(reference,await cache.get(url)));
          }catch{ /* A second available image can still provide a comparison. */ }
        }
        if(scores.length){row.visualScore=Math.max(...scores);compared++;}else if(!signal?.aborted)failures.add(row.url);
      }
    }
    const report=match.screen(rows,criteria);
    const evaluations=Object.fromEntries([...report.shortlist,...report.review,...report.excluded,...report.remaining].map(r=>[r.url,{visualScore:r.visualScore,score:r.score,status:r.status,reasons:r.reasons,missing:r.missing,excluded:r.excluded}]));
    return{report,evaluations,compared,failed:failures.size,aborted:Boolean(signal?.aborted)};
  }
  globalThis.ImageGrabSourcingResults={cards,screen};
})();
