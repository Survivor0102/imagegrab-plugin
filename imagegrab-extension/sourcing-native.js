// Runs in the platform page; uses its rendered image-upload input, without private endpoints.
async function upload1688Reference(dataUrl) {
  if (!/^data:image\/jpeg;base64,/.test(dataUrl) || dataUrl.length>4*1024*1024) return {ok:false,error:'参考图片无效或过大'};
  let input=[...document.querySelectorAll('input[type="file"]')].find(x=>/image|\.png|\.jpg|\.jpeg/.test(x.accept)&&!x.disabled);
  if(!input){
    const control=[...document.querySelectorAll('[title],[aria-label],button,[role="button"]')].find(x=>/图片搜索|以图搜|识图搜索/.test(`${x.title||''} ${x.getAttribute('aria-label')||''} ${x.innerText||''}`)&&x.getBoundingClientRect().width>0);
    if(control){control.click();await new Promise(r=>setTimeout(r,500));input=[...document.querySelectorAll('input[type="file"]')].find(x=>/image|\.png|\.jpg|\.jpeg/.test(x.accept)&&!x.disabled);}
  }
  if(!input)return {ok:false,error:'当前页面未找到平台图片上传入口。请点击1688的相机按钮上传参考图，完成后回本页读取候选。'};
  const blob=await (await fetch(dataUrl)).blob(),transfer=new DataTransfer();
  transfer.items.add(new File([blob],'imagegrab-reference.jpg',{type:'image/jpeg'}));
  const originalUrl = location.href;
  input.files=transfer.files;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  const visible = e => { const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
    if(location.href!==originalUrl && location.pathname.includes('/pc-image-search/'))return {ok:true,message:'平台已进入图片搜索，正在等待结果列表'};
    const button=[...document.querySelectorAll('.copy-image-container .search-btn,button,[role="button"],.search-btn')]
      .find(e=>e.textContent.replace(/\s+/g,'')==='搜索图片'&&visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
    if(button){button.click();return {ok:true,message:'已点击1688原生搜索图片按钮，正在等待本次图搜结果'};}
    await new Promise(r=>setTimeout(r,250));
  }
  return {ok:false,error:'图片已上传，但没有找到可用的“搜索图片”按钮；未读取默认推荐列表。请在平台完成图搜后使用手动读取。'};
}

// Runs in the rendered platform page. No private API or page-internal data access.
function read1688SearchState() {
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const cards=new Map();
  for(const a of document.querySelectorAll('a[href*="1688.com/offer/"]')){
    const id=a.href.match(/\/offer\/(\d+)\.html/)?.[1];
    if(id&&visible(a)&&a.querySelector('img'))cards.set(id,clean(a.innerText).slice(0,180));
  }
  for(const e of document.querySelectorAll('[data-tracker="offer"][data-renderkey]')){
    const id=e.getAttribute('data-renderkey')?.match(/_(\d{6,})$/)?.[1];
    const title=clean(e.querySelector('[class*="titleText--"]')?.innerText);
    if(id&&title&&visible(e))cards.set(id,title);
  }
  const body=document.body?.innerText||'';
  const challenge=[...document.querySelectorAll('iframe')].some(e=>visible(e)&&/captcha|punish|login|passport|security/i.test(e.src))
    ||[...document.querySelectorAll('[role="dialog"],.nc-container,#baxia-dialog-content')].some(e=>visible(e)&&/安全验证|滑动验证|拖动滑块|请先登录|登录后继续/.test(e.innerText))
    ||(cards.size===0&&/请完成安全验证|请拖动滑块|请先登录后再/.test(body));
  const busy=[...document.querySelectorAll('[aria-busy="true"],.next-loading-tip,.ant-spin-spinning')].some(visible);
  return {url:location.href,readyState:document.readyState,keyword:document.querySelector('#alisearch-input')?.value||'',count:cards.size,
    signature:JSON.stringify([...cards].slice(0,100)),challenge,busy};
}
