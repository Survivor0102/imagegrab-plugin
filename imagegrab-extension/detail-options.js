/* Injected only into the batch-owned product tab. Uses rendered controls. */
async function imagegrabCollectOptions(request) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = el => (el?.innerText || '').replace(/\s+/g, ' ').trim();
  const label = button => text(button.querySelector('.label-name')) || text(button);
  const unavailable = button => !button || button.disabled || button.getAttribute('aria-disabled') === 'true' || /(?:^|\s)disabled(?:\s|$)/.test(button.className);
  const started = Date.now();
  const maxMs = request.maxMs || 210000;
  async function check() {
    if (!new RegExp('^https://(?:detail|offer)\\.1688\\.com/offer/' + request.offerId + '\\.html(?:[?#]|$)').test(location.href)) throw Error('商品页面已变化，未保存');
    if (/安全验证|访问验证|请完成验证|验证码|滑动验证|访问异常/.test(document.title) || document.querySelector('iframe[src*="captcha"],iframe[src*="punish"]')) throw Error('需要登录或安全验证');
    const job = (await chrome.storage.local.get('imagegrabDetailJob')).imagegrabDetailJob;
    if (!job || job.id !== request.jobId || job.status !== 'running' || job.stopRequested) throw Error('已停止');
  }
  await check();
  document.querySelector('#description')?.scrollIntoView({block:'start'});
  await sleep(request.descriptionWaitMs ?? 2000);
  const groupNodes = () => [...document.querySelectorAll('#skuSelection .feature-item')];
  const groups = groupNodes().map((group, index) => ({index, name:text(group.querySelector('h3')), options:[...group.querySelectorAll('.sku-filter-button')].map(button => ({value:label(button),disabled:unavailable(button)}))})).filter(g => g.options.length);
  const original = groups.flatMap(g => [...groupNodes()[g.index].querySelectorAll('.sku-filter-button.active')].map(b => ({groupIndex:g.index,value:label(b)})));
  let combinations = [[]];
  for (const group of groups) {
    // Keep dependent choices: some disabled options become selectable after an earlier choice.
    if (combinations.length * group.options.length > 600) throw Error('选项组合超过600，需缩小范围后采集');
    combinations = combinations.flatMap(combo => group.options.map(o => [...combo,{groupIndex:group.index,group:group.name,value:o.value}]));
  }
  const result = globalThis.ImageGrabDetail.collect();
  result.skus=[]; result.media=[]; result.images=[];
  result.optionCollection={includeSoldOut:true,groups,expectedCombinations:combinations.length,collected:[],skipped:[],status:'complete',method:'rendered-option-buttons'};
  const skuKeys=new Set(), mediaKeys=new Set();
  try {
    for (const combo of combinations) {
      await check();
      if(Date.now()-started>maxMs){result.optionCollection.status='partial';result.optionCollection.reason='单件采集达到时间上限，可重新采集';break;}
      let selectable=true;
      for(const choice of combo) {
        const button=[...(groupNodes()[choice.groupIndex]?.querySelectorAll('.sku-filter-button')||[])].find(b=>label(b)===choice.value);
        if(unavailable(button)){selectable=false;break;}
        if(!button.classList.contains('active')){button.click();await sleep(request.optionWaitMs ?? 1400);}
      }
      if(!selectable || !combo.every(c=>[...(groupNodes()[c.groupIndex]?.querySelectorAll('.sku-filter-button.active')||[])].some(b=>label(b)===c.value))) {
        result.optionCollection.skipped.push({options:combo.map(c=>`${c.group}:${c.value}`),reason:'选项未激活或组合不可选'});continue;
      }
      await sleep(request.settleMs ?? 450);
      const expander=document.querySelector('#skuSelection .show-soldout-info a');
      if(expander && /展开/.test(text(expander))){expander.click();await sleep(request.settleMs ?? 650);}
      await check();
      const capture=globalThis.ImageGrabDetail.collect();
      result.optionCollection.collected.push({options:combo.map(c=>({group:c.group,value:c.value})),skuRows:capture.skus.length});
      if(!capture.skus.length && capture.selectedOptions.length && capture.priceText) capture.skus.push({group:capture.selectedOptions.map(o=>o.group).join(' / '),value:capture.selectedOptions.map(o=>o.value).join(' / '),priceText:'',pageReferencePrice:capture.priceText,stockText:'页面未显示规格报价',selectedOptions:capture.selectedOptions,imageUrl:capture.selectedOptions.find(o=>o.imageUrl)?.imageUrl||'',imageAssociation:capture.selectedOptions.some(o=>o.imageUrl)?'selected-option-shared':'not-found',priceScope:'not-displayed-for-selected-options'});
      for(const sku of capture.skus){const key=JSON.stringify([sku.group,sku.value,sku.selectedOptions]);if(!skuKeys.has(key)){skuKeys.add(key);result.skus.push(sku);}}
      for(const media of capture.media){const key=`${media.role}|${media.url}`;if(!mediaKeys.has(key)){mediaKeys.add(key);result.media.push(media);}}
      result.videoUrls=[...new Set([...(result.videoUrls||[]),...(capture.videoUrls||[])])];
    }
    if(!result.optionCollection.collected.length)throw Error('没有读到可选规格组合，未覆盖原资料');
    if(result.optionCollection.skipped.length){result.optionCollection.status='partial';result.optionCollection.reason='部分选项不可选或未激活，已保存成功读取的部分';}
    result.images=[...new Set(result.media.map(m=>m.url))];result.capturedAt=Date.now();
    await check();
    return result;
  } finally {
    // The task tab is ours, but restore the original choice when possible.
    for(const choice of original){const b=[...(groupNodes()[choice.groupIndex]?.querySelectorAll('.sku-filter-button')||[])].find(b=>label(b)===choice.value);if(!unavailable(b)&&!b.classList.contains('active'))b.click();}
  }
}
globalThis.imagegrabCollectOptions=imagegrabCollectOptions;
