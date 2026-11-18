/* Evidence-aware comparison used only by specification substitute sourcing. */
(() => {
  'use strict';
  const clean = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const unknownBrand = value => !clean(value) || /^(?:other|others|其它|其他|其它品牌|其他品牌|无|无品牌|未知|未标注|不详|通用|oem|odm|n\/a|none|null|品牌未识别|品牌)$/.test(clean(value));
  const attributes = details => (details?.attributes || []).filter(a => a && a.name && a.value != null).map(a => ({ name: String(a.name), value: String(a.value) }));
  const label = name => /开孔|孔径/.test(name) ? 'opening' : /直径/.test(name) ? 'diameter' : /长度/.test(name) ? 'length' : /宽度/.test(name) ? 'width' : /高度|厚度/.test(name) ? 'height' : '';
  const labels = { power:'功率', voltage:'电压', length:'尺寸', opening:'开孔', diameter:'直径', width:'宽度', height:'高度/厚度', temperature:'色温', mass:'重量', volume:'容量', capacity:'电池容量', storage:'存储容量', material:'材质', installation:'安装方式', text:'规格文字' };
  const units = {
    w:['power',1,'W'],瓦:['power',1,'W'],v:['voltage',1,'V'],伏:['voltage',1,'V'],
    mm:['length',1,'mm'],毫米:['length',1,'mm'],cm:['length',10,'mm'],厘米:['length',10,'mm'],
    kg:['mass',1000,'g'],千克:['mass',1000,'g'],公斤:['mass',1000,'g'],g:['mass',1,'g'],克:['mass',1,'g'],mg:['mass',.001,'g'],毫克:['mass',.001,'g'],
    ml:['volume',1,'ml'],毫升:['volume',1,'ml'],l:['volume',1000,'ml'],升:['volume',1000,'ml'],
    k:['temperature',1,'K'],mah:['capacity',1,'mAh'],gb:['storage',1,'GB'],tb:['storage',1000,'GB']
  };
  const numeric = /(\d+(?:\.\d+)?)(?:\s*[-~～至]\s*(\d+(?:\.\d+)?))?\s*(mah|毫米|厘米|毫升|千克|公斤|毫克|mm|cm|ml|kg|mg|gb|tb|w|v|g|l|k|瓦|伏|克|升)(?![a-z])/gi;
  function numbers(text, name = '') {
    const input = clean(text), out = [];
    for (const m of input.matchAll(numeric)) {
      const [kind,factor,unit] = units[m[3]], dimension = kind === 'length' ? label(name) || label(input.slice(Math.max(0,m.index-6),m.index)) || kind : kind;
      out.push({ key:dimension, value:Number(m[1])*factor, max:Number(m[2] || m[1])*factor, unit, raw:m[0] });
    }
    return out;
  }
  function material(text) {
    const s = clean(text), values = [];
    if (/塑料|塑胶|塑壳|全塑|\b(?:pc|abs|pp|pvc|pet|pe)\b/.test(s)) values.push('塑料');
    if (/不锈钢/.test(s)) values.push('不锈钢');
    if (/(?:^|[\s,，;/])铁(?:$|[\s,，;/])|铁制|铁壳|铁艺|铁质|铁[+＋/]|[+＋/]铁/.test(s)) values.push('铁');
    if (/铝合金|铝材|铝制|铝壳|全铝|^铝$/.test(s)) values.push('铝');
    if (/玻璃/.test(s)) values.push('玻璃');
    if (/实木|木质|木制|原木/.test(s)) values.push('木');
    return values;
  }
  function installations(text) {
    return [...new Set((clean(text).match(/暗装|明装|嵌入式|吸顶式|吊装|壁挂式/g) || []).map(v => v === '嵌入式' ? '暗装' : v))];
  }
  function requirements(c) {
    const out = [], source = [c.name,c.specs].filter(Boolean).join(' ');
    for (const n of numbers(source)) out.push({ ...n, label:labels[n.key], expected:`${n.value}${n.max !== n.value ? '-'+n.max : ''}${n.unit}` });
    for (const value of material(source)) out.push({ key:'material',label:labels.material,value,expected:value });
    for (const value of installations(source)) out.push({ key:'installation',label:labels.installation,value,expected:value });
    // Arbitrary user-supplied attribute names remain comparable without a category template.
    for (const part of String(c.specs || '').split(/[;；\n,，]+/)) {
      const m = part.trim().match(/^([^:：=]{1,20})[:：=]\s*(.+)$/);
      if (m && /材质|材料/.test(m[1]) && !material(m[2]).length) out.push({key:'material',label:'材质',value:clean(m[2]),expected:m[2]});
      else if (m && /安装/.test(m[1]) && !installations(m[2]).length) out.push({key:'installation',label:'安装方式',value:clean(m[2]),expected:m[2]});
      else if (m && !numbers(m[2],m[1]).length && !/品牌|材质|材料|安装/.test(m[1])) out.push({ key:'attribute:'+clean(m[1]),label:m[1],value:clean(m[2]),expected:m[2] });
      else if (m) {
        // Prefer named dimensions over their unqualified copy above.
        for (const n of numbers(m[2],m[1])) { if (n.key !== 'length') { const i=out.findIndex(r=>r.key==='length'&&r.value===n.value&&r.unit===n.unit);if(i>=0)out.splice(i,1); } out.push({...n,label:labels[n.key],expected:`${n.value}${n.max!==n.value?'-'+n.max:''}${n.unit}`}); }
      }
    }
    const residual = clean(c.specs).replace(numeric,' ').replace(/[^\s,，;；、/]+[:：=][^,，;；]+/g,' ').split(/[\s,，;；、/]+/).filter(x=>x.length>1&&!material(x).length&&!installations(x).length);
    for (const word of residual) out.push({key:'text',label:'规格文字',value:word,expected:word});
    return [...new Map(out.map(r=>[`${r.key}:${r.expected}`,r])).values()];
  }
  function brandEvidence(row,c) {
    const attrs=attributes(row.details), explicit=attrs.filter(a=>/^(?:商品)?品牌(?:名称)?(?:\([^)]*\))?$/.test(clean(a.name))).map(a=>({value:a.value,source:'详情属性：'+a.name}));
    if(row.brand)explicit.push({value:row.brand,source:'采集品牌字段'});
    const valid=explicit.filter(a=>!unknownBrand(a.value)), target=clean(c.brand);
    if(!target||unknownBrand(target))return {relation:'unknown',values:valid,reason:'未提供可核对的目标品牌'};
    const same=valid.filter(a=>clean(a.value)===target), different=valid.filter(a=>clean(a.value)!==target);
    if(same.length&&different.length)return {relation:'unknown',values:valid,reason:'页面品牌字段互相冲突，待人工核对'};
    if(same.length)return {relation:'same',values:valid,reason:`明确品牌字段：${same[0].value}`};
    if(different.some(a=>{const name=clean(a.value);return Math.min(name.length,target.length)>=2&&(name.startsWith(target)||target.startsWith(name));}))
      return {relation:'unknown',values:valid,reason:'详情品牌与目标名称可能存在简称差异，待核对：'+valid.map(a=>a.value).join('/')+'；目标为'+c.brand};
    if(different.length)return {relation:'different',values:valid,reason:`明确品牌字段：${different[0].value}；目标为${c.brand}`};
    // A title brand is a useful clue, but it is not equivalent to a verified detail attribute.
    const clue = row.brandClue || ((row.title || row.details?.title || '').match(/^[\u4e00-\u9fffA-Za-z0-9·&]{2,20}(?:照明|灯具|电器|家居|科技|服饰|母婴|美妆)/)?.[0] || (clean([row.title,row.details?.title].join(' ')).includes(target) ? c.brand : ''));
    if (clue) {
      const clueRelation = clean(clue) === target ? 'same' : Math.min(clean(clue).length,target.length)>=2&&(clean(clue).startsWith(target)||target.startsWith(clean(clue))) ? 'unknown' : 'different';
      return {relation:'unknown',values:explicit,clue,clueRelation,target:c.brand,reason:`标题品牌线索：${clue}；目标品牌：${c.brand}；${{same:'疑似同品牌',different:'疑似不同品牌',unknown:'可能存在简称差异'}[clueRelation]}，待详情核验`};
    }
    return {relation:'unknown',values:explicit,target:c.brand,reason:`目标品牌：${c.brand}；候选品牌尚未采到，待详情补全`};
  }
  function compare(row,c) {
    const detail=row.details || {}, attrs=attributes(detail), reqs=requirements(c), brand=brandEvidence(row,c);
    const globalFacts=[];
    for(const a of attrs) {
      const source='详情属性：'+a.name;
      globalFacts.push(...numbers(a.value,a.name).map(n=>({...n,source})));
      if(/材质|材料/.test(a.name))for(const v of material(a.value).length?material(a.value):[clean(a.value)])globalFacts.push({key:'material',value:v,raw:a.value,source});
      if(/安装/.test(a.name))for(const v of installations(a.value).length?installations(a.value):[clean(a.value)])globalFacts.push({key:'installation',value:v,raw:a.value,source});
      globalFacts.push({key:'attribute:'+clean(a.name),value:clean(a.value),raw:a.value,source});
    }
    const title=detail.title||row.title||'', titleSource=detail.title?'详情商品标题线索':'搜索商品标题线索';
    globalFacts.push(...numbers(title).filter(n=>!globalFacts.some(f=>f.key===n.key)).map(n=>({...n,source:titleSource})));
    for(const value of material(title))if(!globalFacts.some(f=>f.key==='material'))globalFacts.push({key:'material',value,raw:value,source:titleSource});
    for(const value of installations(title))if(!globalFacts.some(f=>f.key==='installation'))globalFacts.push({key:'installation',value,raw:value,source:titleSource});
    const skus=detail.skus || [], variants=skus.length?skus.map((sku,index)=>({index,value:sku.value,priceText:sku.priceText,imageUrl:sku.imageUrl, facts:numbers([sku.value,...(sku.selectedOptions||[]).map(o=>o.value)].join(' ')).map(n=>({...n,source:'SKU：'+sku.value}))})):[{index:null,facts:[]}];
    function assessment(requirement,variant) {
      const skuFacts=variant.facts.filter(f=>f.key===requirement.key), available=skuFacts.length?skuFacts:globalFacts.filter(f=>f.key===requirement.key);
      if(requirement.key==='text')return { ...requirement,status:clean([title,detail.specs,...attrs.map(a=>a.value),variant.value].join(' ')).includes(requirement.value)?'match':'missing',actual:[],source:'可见文字' };
      if(!available.length)return {...requirement,status:'missing',actual:[],source:''};
      const matches=available.filter(f=>requirement.unit?f.unit===requirement.unit&&f.value<=requirement.value+.01&&f.max>=requirement.max-.01:clean(f.value)===clean(requirement.value));
      // If structured facts disagree, retain the ambiguity rather than assert compatibility.
      const mixed=!requirement.unit&&matches.length&&available.some(f=>!matches.includes(f));
      return {...requirement,status:mixed?'missing':matches.length?'match':'conflict',actual:available.map(f=>f.raw||String(f.value)),source:[...new Set(available.map(f=>f.source))].join('；')};
    }
    const evaluated=variants.map(v=>({...v,checks:reqs.map(r=>assessment(r,v))}));
    evaluated.sort((a,b)=>a.checks.filter(x=>x.status==='conflict').length-b.checks.filter(x=>x.status==='conflict').length||a.checks.filter(x=>x.status==='missing').length-b.checks.filter(x=>x.status==='missing').length);
    const best=evaluated[0],checks=best?.checks||[],conflicts=checks.filter(x=>x.status==='conflict'),missing=checks.filter(x=>x.status==='missing'),matched=checks.filter(x=>x.status==='match');
    const targetSpecStatus=!reqs.length?'unknown':conflicts.length?'excluded':missing.length?'unknown':'included';
    const notSpecified=['material','installation','opening','voltage'].filter(key=>!reqs.some(r=>r.key===key)).map(key=>labels[key]);
    return {brandRelation:brand.relation,brandEvidence:brand,targetSpecStatus,specComparison:{requirements:reqs,checks,conflicts,missing,matched,targetNotSpecified:notSpecified,matchingSkus:evaluated.filter(v=>v.checks.length&&v.checks.every(x=>x.status==='match')).map(({facts,checks,...v})=>v),detailCapturedAt:detail.capturedAt||null,scope:'仅核对已知目标条件；未提供的参数不推断一致'},specDifference:conflicts.map(x=>`${x.label}：需要${x.expected}，页面为${x.actual.join('/')}`).join('；')};
  }
  function annotate(row,c) {
    const evidence=compare(row,c),spec=evidence.specComparison;
    const base=ImageGrabSourcingMatch.evaluate(row,{...c,specs:'',mode:'alternative',hasImage:false,hasReference:false});
    const reasons=[...base.reasons,evidence.brandEvidence.reason,...spec.matched.map(x=>`${x.label}命中：${x.expected}（${x.source}）`)];
    const missing=[...base.missing,...spec.missing.map(x=>`${x.label}待核对：${x.expected}`)];
    const excluded=[...base.excluded];
    if(spec.conflicts.length) {if(c.matchMode==='allow-difference')reasons.push('允许差异，仅作待核对候选：'+evidence.specDifference);else excluded.push(evidence.specDifference);}
    if(!spec.requirements.length)missing.push('尚未提供可比较的目标规格');
    if(spec.targetNotSpecified.length)reasons.push('目标未提供：'+spec.targetNotSpecified.join('、')+'；不能据此确认可直接替代');
    const status=excluded.length?'excluded':spec.missing.length||spec.conflicts.length||!spec.requirements.length||base.status==='review'?'review':'candidate';
    const adjustment=spec.matched.length*5-spec.missing.length*5-spec.conflicts.length*20;
    return {...base,...evidence,substitute:true,status,score:Math.max(0,Math.min(100,base.score+adjustment)),reasons,missing,excluded};
  }
  function screen(rows,c) {
    const evaluated=ImageGrabSourcingMatch.dedupe(rows).map(r=>annotate(r,c)).sort((a,b)=>b.score-a.score||a.url.localeCompare(b.url));
    const limit=Math.min(50,Math.max(1,Number(c.limit)||20)),candidates=evaluated.filter(x=>x.status==='candidate');
    const review=evaluated.filter(x=>x.status==='review');
    return {shortlist:candidates.slice(0,limit),review,remaining:candidates.slice(limit),excluded:evaluated.filter(x=>x.status==='excluded'),queue:[...candidates,...review].slice(0,limit),total:evaluated.length,all:evaluated};
  }
  function attachDetails(rows,offers=[]) {
    const byUrl=new Map(offers.map(o=>[ImageGrabSourcingMatch.canonical(o.url),o]));
    return rows.map(row=>{const offer=byUrl.get(ImageGrabSourcingMatch.canonical(row.url));return offer?.details?{...row,details:offer.details,supplierName:offer.supplierName||row.supplierName,priceText:offer.priceText||row.priceText}:row;});
  }
  globalThis.ImageGrabSubstituteMatch={requirements,brandEvidence,compare,annotate,screen,attachDetails};
})();
