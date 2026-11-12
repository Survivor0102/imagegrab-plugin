// Search-result verification shared by the background worker and regression tests.
(() => {
  const normalize = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  function check(state, expected, tab) {
    if (state?.challenge) return { fatal: '1688要求登录或安全验证；任务已暂停，没有尝试绕过验证' };
    if (!state || !expected || tab.pendingUrl || state.url !== tab.url) return { reason: '搜索页面正在切换' };
    let url;
    try { url = new URL(state.url); } catch { return { reason: '搜索地址无效' }; }
    if (!['interactive', 'complete'].includes(state.readyState)) return { reason: '搜索页面仍在加载' };
    if (expected.channel === 'image') {
      if (url.hostname !== 'air.1688.com' || !url.pathname.includes('/pc-image-search/') || !url.searchParams.get('imageId')) return { reason: '等待1688返回本次图片搜索结果' };
    } else {
      // 1688 encodes keywords as GBK. Verify the visible input as Unicode instead
      // of decoding the URL's bytes as UTF-8, and require actual query navigation.
      if (url.hostname !== 's.1688.com' || !url.searchParams.get('keywords') || normalize(state.keyword) !== normalize(expected.keyword)) return { reason: '等待本次名称搜索生效' };
    }
    if (!state.signature || !state.count || state.busy) return { reason: '等待本次商品列表加载' };
    if (expected.baselineSignature && state.signature === expected.baselineSignature) return { reason: '列表仍是搜索前的商品，尚未读取' };
    return { ok: true };
  }
  globalThis.ImageGrabSearchReady = { check };
})();
