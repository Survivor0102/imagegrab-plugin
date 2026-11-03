const STORAGE_KEY = 'imagegrabGalleryState';
const state = { images: [], selected: new Set(), busy: false };
const gallery = document.querySelector('#gallery'), statusBox = document.querySelector('#status'), sourceMeta = document.querySelector('#source-meta'), selectedCount = document.querySelector('#selected-count');
function setStatus(text, error = false) { statusBox.textContent = text; statusBox.classList.toggle('error', error); }
function updateCount() { selectedCount.textContent = `已选 ${state.selected.size} 张`; }
function filename(index) { return `商品图_${String(index + 1).padStart(3, '0')}.png`; }
function render() {
  gallery.replaceChildren();
  if (!state.images.length) { setStatus('没有收到可用图片。请返回商品详情页重新点击“获取图片”。', true); updateCount(); return; }
  setStatus(`已提取 ${state.images.length} 张候选图片，可勾选后批量下载。`);
  state.images.forEach((item, index) => {
    const fragment = document.querySelector('#image-card-template').content.cloneNode(true), card = fragment.querySelector('.image-card'), checkbox = fragment.querySelector('.image-check'), image = fragment.querySelector('.preview'), size = fragment.querySelector('.image-size');
    fragment.querySelector('.image-index').textContent = `#${String(index + 1).padStart(3, '0')}`;
    checkbox.checked = state.selected.has(index); checkbox.addEventListener('change', () => { checkbox.checked ? state.selected.add(index) : state.selected.delete(index); updateCount(); });
    image.src = item.url; image.alt = `商品图片 ${index + 1}`;
    image.addEventListener('load', () => { size.textContent = `${image.naturalWidth} × ${image.naturalHeight}`; });
    image.addEventListener('error', () => { size.textContent = '预览失败'; card.classList.add('broken'); });
    fragment.querySelector('.single-download').addEventListener('click', () => downloadOne(index)); gallery.appendChild(fragment);
  }); updateCount();
}
async function convertToPng(url) {
  const response = await fetch(url, { mode:'cors', credentials:'omit' }); if (!response.ok) throw new Error(`图片请求失败：HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob()), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
  return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
function fallbackDownload(item, index) { return new Promise(resolve => chrome.runtime.sendMessage({ type:'DOWNLOAD_ORIGINAL', url:item.url, filename:filename(index) }, resolve)); }
async function downloadOne(index) {
  const item = state.images[index]; if (!item || state.busy) return; state.busy = true; setStatus(`正在处理 ${filename(index)}…`);
  try { const objectUrl = URL.createObjectURL(await convertToPng(item.url)); await chrome.downloads.download({ url:objectUrl, filename:filename(index), saveAs:false, conflictAction:'uniquify' }); setTimeout(() => URL.revokeObjectURL(objectUrl), 5000); setStatus(`已开始下载 ${filename(index)}。`); }
  catch (error) { const result = await fallbackDownload(item,index); setStatus(result?.ok ? `${filename(index)} 无法转换 PNG，已启动原图兜底下载。` : `下载失败：${error.message}`, !result?.ok); }
  finally { state.busy = false; }
}
async function downloadSelected() {
  const indexes = [...state.selected].sort((a,b)=>a-b); if (!indexes.length) { setStatus('请先至少选择一张图片。', true); return; } state.busy = true; let success = 0;
  for (let i=0;i<indexes.length;i++) { const index = indexes[i]; setStatus(`正在下载 ${i+1}/${indexes.length}：${filename(index)}…`); try { const objectUrl = URL.createObjectURL(await convertToPng(state.images[index].url)); await chrome.downloads.download({url:objectUrl,filename:filename(index),saveAs:false,conflictAction:'uniquify'}); setTimeout(() => URL.revokeObjectURL(objectUrl),5000); success++; } catch { if ((await fallbackDownload(state.images[index],index))?.ok) success++; } }
  state.busy = false; setStatus(`处理完成：${success}/${indexes.length} 张已启动下载。`);
}
document.querySelector('#select-all').addEventListener('click', () => { state.images.forEach((_,i)=>state.selected.add(i)); render(); });
document.querySelector('#invert-selection').addEventListener('click', () => { state.images.forEach((_,i)=>state.selected.has(i)?state.selected.delete(i):state.selected.add(i)); render(); });
document.querySelector('#download-selected').addEventListener('click', downloadSelected);
chrome.storage.local.get(STORAGE_KEY).then(result => { const saved=result[STORAGE_KEY]||{}; state.images=Array.isArray(saved.images)?saved.images:[]; sourceMeta.textContent=`${saved.pageTitle||'商品图片'}${saved.sourceUrl?` · ${saved.sourceUrl}`:''}`; render(); }).catch(error=>setStatus(`读取提取结果失败：${error.message}`,true));
