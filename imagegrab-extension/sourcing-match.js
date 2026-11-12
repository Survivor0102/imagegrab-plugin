/* Local, explainable candidate screening. Scores are retrieval hints, never proof of identity. */
(() => {
  'use strict';
  const clean = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const terms = value => [...new Set(clean(value).split(/[\s,，;；、\n]+/).filter(Boolean))];
  function canonical(value) {
    try { const u = new URL(value); const m = u.pathname.match(/^\/offer\/(\d+)\.html$/); return u.protocol === 'https:' && ['detail.1688.com','offer.1688.com'].includes(u.hostname) && m ? `https://detail.1688.com/offer/${m[1]}.html` : ''; } catch { return ''; }
  }
  function dedupe(rows) {
    const map = new Map();
    for (const [inputIndex, input] of (rows || []).entries()) {
      const url = canonical(input.url); if (!url) continue;
      const old = map.get(url);
      const row = { ...input, url, retrievalOrder: Number.isFinite(input.retrievalOrder) ? input.retrievalOrder : inputIndex, images: [...new Set(input.images || [])].slice(0, 8), sources: input.sources || [] };
      if (old) {
        old.retrievalOrder = Math.min(old.retrievalOrder, row.retrievalOrder);
        old.images = [...new Set([...old.images,...row.images])].slice(0, 8);
        old.sources = [...new Map([...old.sources,...row.sources].map(x => [JSON.stringify(x),x])).values()];
        for (const key of ['title','brand','model','category','priceText','salesText','supplierName','supplierUrl','visibleText']) old[key] ||= row[key];
      } else map.set(url, row);
    }
    return [...map.values()];
  }
  function tokens(value) {
    const s = clean(value); const out = s.match(/[a-z]+\d*(?:\.\d+)?|\d+(?:\.\d+)?(?:mah|mm|cm|ml|kg|mg|gb|tb|w|v|g|l)?/g) || [];
    for (const run of s.match(/[\u4e00-\u9fff]+/g) || []) for (let i=0;i<run.length-1;i++) out.push(run.slice(i,i+2));
    return [...new Set(out)];
  }
  function units(value) {
    const out = new Map();
    for (const m of clean(value).matchAll(/(\d+(?:\.\d+)?)\s*(mah|mm|cm|ml|kg|mg|gb|tb|毫米|厘米|毫升|千克|公斤|毫克|克|g|l|升|w|瓦|v|伏)(?![a-z])/g)) {
      const rawUnit = m[2], unit = /mm|cm|毫米|厘米/.test(rawUnit) ? 'length' : /ml|毫升|^l$|升/.test(rawUnit) ? 'volume' : /kg|千克|公斤|^g$|克|mg|毫克/.test(rawUnit) ? 'mass' : /w|瓦/.test(rawUnit) ? 'w' : /v|伏/.test(rawUnit) ? 'v' : rawUnit;
      const factor = /^cm$|厘米/.test(rawUnit) ? 10 : /^l$|升/.test(rawUnit) ? 1000 : /^kg$|千克|公斤/.test(rawUnit) ? 1000 : /^mg$|毫克/.test(rawUnit) ? 0.001 : 1;
      const n = Number(m[1]) * factor;
      if (!out.has(unit)) out.set(unit, []); out.get(unit).push(n);
    }
    return out;
  }
  function describe(rgba,width,height) {
    if (!width || !height || rgba.length !== width*height*4) throw Error('图片像素无效');
    const sample=(x,y)=>{ const i=(Math.min(height-1,Math.floor(y*height))*width+Math.min(width-1,Math.floor(x*width)))*4; const a=rgba[i+3]/255; return [0,1,2].map(k=>rgba[i+k]*a+255*(1-a)); };
    const luminance=p=>p[0]*.299+p[1]*.587+p[2]*.114;
    const hash=[], colors=new Array(12).fill(0),luma=[];
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)hash.push(luminance(sample((x+.5)/9,(y+.5)/8))>luminance(sample((x+1.5)/9,(y+.5)/8))?1:0);
    for(let y=0;y<32;y++)for(let x=0;x<32;x++){const p=sample((x+.5)/32,(y+.5)/32);for(let c=0;c<3;c++)colors[c*4+Math.min(3,Math.floor(p[c]/64))]++;}
    for(let y=0;y<16;y++)for(let x=0;x<16;x++)luma.push(luminance(sample((x+.5)/16,(y+.5)/16))/255);
    return {hash,colors:colors.map(x=>x/1024),luma};
  }
  function visualSimilarity(a,b) {
    if (!a || !b || a.hash?.length!==64 || b.hash?.length!==64 || a.colors?.length!==12 || b.colors?.length!==12 || a.luma?.length!==256 || b.luma?.length!==256) return null;
    const shape=1-a.hash.reduce((n,x,i)=>n+(x!==b.hash[i]),0)/64;
    const color=a.colors.reduce((n,x,i)=>n+Math.min(x,b.colors[i]),0)/3;
    const layout=Math.max(0,1-a.luma.reduce((n,x,i)=>n+Math.abs(x-b.luma[i]),0)/256*2);
    return Math.round((shape*.45+layout*.4+color*.15)*100);
  }
  function evaluate(row,criteria={}) {
    const title=clean(row.title), text=clean([row.title,row.brand,row.model,row.category,row.visibleText].join(' '));
    const reasons=[],missing=[],excluded=[];let score=0, signals=0;
    if(criteria.nativeImageSearch)reasons.push('1688图片搜索结果，平台原始顺序优先');
    const category=terms(criteria.category);
    if(category.length){if(!category.some(t=>title.includes(t)))excluded.push(`品类未命中：${category.join(' / ')}`);else {score+=30;signals++;reasons.push('标题命中品类');}}
    for(const word of terms(criteria.exclude))if(title.includes(word))excluded.push(`标题含排除词：${word}`);
    for(const word of terms(criteria.required))if(!text.includes(word))missing.push(`必需词待确认：${word}`);else {score+=8;signals++;reasons.push(`命中：${word}`);}
    if(criteria.mode==='exact')for(const key of ['brand','model'])if(criteria[key]){
      if(text.includes(clean(criteria[key]))){score+=16;signals++;reasons.push(`${key==='brand'?'品牌':'型号'}文字命中`);}else missing.push(`${key==='brand'?'品牌':'型号'}待确认：${criteria[key]}`);
    }
    const target=tokens(criteria.name), matched=target.filter(t=>title.includes(t));
    if(target.length){const fraction=matched.length/target.length;score+=Math.round(fraction*25);if(matched.length){signals++;reasons.push(`名称命中 ${matched.length}/${target.length} 个片段`);}else missing.push('名称未命中');}
    const expected=units(criteria.specs), actual=units(row.title);
    for(const [unit,values] of expected){const seen=actual.get(unit);if(!seen){missing.push(`规格待确认：${values.join('/')} ${unit}`);continue;}if(values.some(x=>seen.some(y=>Math.abs(x-y)<.01))){score+=10;signals++;reasons.push(`规格文字命中：${unit}`);}else excluded.push(`规格冲突：需要 ${values.join('/')} ${unit}，标题为 ${seen.join('/')} ${unit}`);}
    if(Number.isFinite(row.visualScore)){score+=Math.round(row.visualScore*.3);if(row.visualScore>=70){signals++;reasons.push(`图片外观参考分 ${row.visualScore}`);}else missing.push(`图片外观参考分较低：${row.visualScore}`);}else if(criteria.hasImage||criteria.hasReference)missing.push('图片未比对');
    const requiredMissing=missing.some(x=>/必需词|品牌|型号|规格待确认/.test(x));
    const imageMissing=criteria.hasImage&&!Number.isFinite(row.visualScore);
    const lowVisualMissing=criteria.hasImage&&Number.isFinite(row.visualScore)&&row.visualScore<70&&!criteria.nativeImageSearch;
    const nativeImageCompared=criteria.nativeImageSearch&&Number.isFinite(row.visualScore);
    const status=excluded.length?'excluded':requiredMissing||imageMissing&&!nativeImageCompared||lowVisualMissing||signals===0&&!nativeImageCompared?'review':'candidate';
    return {...row,score:Math.min(100,score),status,reasons,missing,excluded};
  }
  function screen(rows,criteria={}) {
    if(!clean(criteria.name)&&!criteria.hasImage&&!criteria.hasReference&&!clean(criteria.category))throw Error('请填写名称、品类或上传参考图片');
    const evaluated=dedupe(rows).map(row=>evaluate(row,criteria));
    evaluated.sort((a,b)=>criteria.nativeImageSearch
      ? (a.retrievalOrder-b.retrievalOrder||b.score-a.score||a.url.localeCompare(b.url))
      : (b.score-a.score||a.url.localeCompare(b.url)));
    const limit=Math.min(50,Math.max(1,Number(criteria.limit)||10));
    return {shortlist:evaluated.filter(x=>x.status==='candidate').slice(0,limit),review:evaluated.filter(x=>x.status==='review'),excluded:evaluated.filter(x=>x.status==='excluded'),remaining:evaluated.filter(x=>x.status==='candidate').slice(limit),total:evaluated.length};
  }
  globalThis.ImageGrabSourcingMatch={canonical,dedupe,describe,visualSimilarity,evaluate,screen};
})();
