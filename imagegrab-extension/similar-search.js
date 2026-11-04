function normalizeSimilarKeyword(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// This function is injected into the 1688 page, so it must not depend on
// helpers from the extension service worker.
function fill1688Search(keyword) {
  const clean = String(keyword || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return { ok: false, error: '商品名称为空，无法搜索同名货源' };
  const visible = element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const inputs = [...document.querySelectorAll(
    '#alisearch-input,input[type="search"],input[name*="keyword" i],input[placeholder*="搜索" i],input[placeholder*="关键词" i]'
  )].filter(input => visible(input) && !input.disabled && !input.readOnly);
  const input = inputs.find(item => item.id === 'alisearch-input') || inputs[0];
  if (!input) return { ok: false, error: '搜索页没有找到可用的关键词输入框' };

  const form = input.closest('form');
  const searchBox = input.closest('.ali-search-box') || form;
  const controls = [...(searchBox || document).querySelectorAll('button,[role="button"],input[type="submit"],a,.input-button')]
    .filter(visible);
  const submit = controls.find(item => /^搜索$|^搜全网$|^查找$|^search$/i.test(
    `${item.innerText || item.value || item.getAttribute('aria-label') || item.title || ''}`.replace(/\s+/g, '')
  ));
  if (!submit && !form) return { ok: false, error: '搜索页尚未找到可用的搜索按钮' };

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, clean); else input.value = clean;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: clean }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  if (submit) submit.click();
  else if (form) {
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  }
  return { ok: true, keyword: clean, submitted: true };
}
