(() => {
  'use strict';
  const CATEGORY_TERMS = [
    '鲜牛奶', '巴氏奶', '冷藏鲜奶', '牛奶', '羊奶', '乳制品', '酸奶', '奶粉', '饮料', '咖啡', '茶叶',
    '洗衣液', '纸巾', '湿巾', '牙膏', '洗洁精', '护肤', '化妆品', '口红', '面膜', '洗发水', '纸尿裤',
    '筒灯', '吸顶灯', '台灯', '灯具', '灯泡', '电池', '手机', '耳机', '充电器', '数据线', '电脑',
    '皮筋', '发圈', '发绳', '发夹', '发饰', '头饰', '鞋', '箱包', '水杯', '玩具', '厨具', '收纳'
  ];
  const unique = values => [...new Set(values.filter(Boolean))];
  const clean = value => String(value || '').normalize('NFKC').replace(/[“”"'`]/g, '').replace(/\s+/g, ' ').trim();
  const cjkCount = value => (value.match(/[\u4e00-\u9fff]/g) || []).length;

  function titleCandidate(line) {
    let value = clean(line).split(/单品|门店\s*[:：]|总部零售价|渠道类目\s*[:：]|店内分类\s*[:：]|商品类目\s*[:：]|商品条码\s*[:：]|外部编码\s*[:：]|SKU\s*[:：]|SPU\s*[:：]/i)[0];
    value = value.replace(/^\s*(?:[a-z]{1,2}|\d{1,2})\s+(?=[\u4e00-\u9fff])/i, '');
    const beforeCjk = value.match(/^([\s\S]*?)(?=[\u4e00-\u9fff])/);
    if (beforeCjk && beforeCjk[1].trim().split(/\s+/).filter(Boolean).length >= 2 && beforeCjk[1].trim().split(/\s+/).every(token => token.length <= 2)) value = value.slice(beforeCjk[0].length);
    return value.replace(/\s*\d+(?:\.\d+)?\s*ml\s*\*\s*\d+\s*瓶\s*\([^)]*\).*$/i, '')
      .replace(/\s*[（(]\s*\d+(?:\.\d+)?\s*(?:克|g|个|件|ml|毫升)[\s\S]*$/i, '')
      .replace(/\([^)]*$/, '').replace(/[，。.,:：;；|｜]+$/g, '').replace(/\s*[|｜]+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function extractTitle(text) {
    const candidates = String(text || '').split(/\r?\n/).map(titleCandidate)
      .filter(line => cjkCount(line) >= 3 && line.length >= 5 && line.length <= 100 && !/^(工作区|商品池|货源比较|认证核验|图片.*筛选|店内分类|渠道类目|商品类目)/.test(line));
    return candidates.map(line => {
      const categoryIndex = CATEGORY_TERMS.map(term => line.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0];
      return { line, score: cjkCount(line) * 2 + (categoryIndex !== undefined ? 20 : 0) - (line.length > 72 ? line.length - 72 : 0) };
    }).sort((a, b) => b.score - a.score)[0]?.line || '';
  }

  function labeledValue(text, label) {
    const match = String(text || '').match(new RegExp(`${label}\\s*[:：]?\\s*([A-Za-z0-9][A-Za-z0-9 -]{5,24})`, 'i'));
    return match?.[1]?.replace(/[ -]+$/g, '') || '';
  }

  function parse(text, confidence = 0) {
    const raw = String(text || '').replace(/\r/g, '');
    const title = extractTitle(raw);
    const brandLabel = raw.match(/(?:^|\n)\s*品牌\s*[:：]\s*([\u4e00-\u9fffA-Za-z0-9·_-]{2,24})/);
    const brand = brandLabel?.[1]?.trim() || '';
    const categorySource = raw.match(/(?:店内分类|渠道类目|商品类目)\s*[:：]?\s*([^\r\n]+)/i)?.[1] || '';
    const category = unique(CATEGORY_TERMS.filter(term => title.includes(term) || categorySource.includes(term))).slice(0, 8).join(' ');
    const barcodeDigits = raw.match(/(?:商品条码|条码|条形码)\s*[:：]?\s*([0-9][0-9\s-]{7,24})/i)?.[1]?.replace(/\D/g, '') || '';
    const barcode = [8, 12, 13, 14].includes(barcodeDigits.length) ? barcodeDigits : '';
    const sku = labeledValue(raw, 'SKU');
    const spu = labeledValue(raw, 'SPU');
    const measurements = unique((title.match(/\d+(?:\.\d+)?\s*(?:mL|毫升|L|升|kg|千克|公斤|mg|毫克|g|克|mm|毫米|cm|厘米|W|瓦|V|伏|GB|TB|mAh)/gi) || []).map(clean));
    const measurementFamily = value => /ml|毫升|^l|升/i.test(value) ? 'volume' : /kg|千克|公斤|mg|毫克|\bg|克/i.test(value) ? 'mass' : /mm|毫米|cm|厘米/i.test(value) ? 'length' : /w|瓦/i.test(value) ? 'power' : /v|伏/i.test(value) ? 'voltage' : value.toLowerCase().replace(/[\d.\s]/g, '');
    const primaryMeasurements = [];
    for (const measurement of measurements) if (!primaryMeasurements.some(value => measurementFamily(value) === measurementFamily(measurement))) primaryMeasurements.push(measurement);
    return {
      title, brand, category, specs: primaryMeasurements.slice(0, 5).join(' '), barcode, sku, spu,
      confidence: Math.max(0, Math.min(100, Math.round(Number(confidence) || 0))), rawText: raw.trim()
    };
  }

  globalThis.ImageGrabSourcingImage = { parse };
})();
