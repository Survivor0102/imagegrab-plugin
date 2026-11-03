(() => {
  'use strict';

  const SALES_PATTERNS = [
    /(?:月销(?:量)?|已售(?:出)?|已付款|销量|付款人数)\s*[:：]?\s*[\d,.]+(?:万|千)?\+?(?:\s*(?:件|人|笔))?/i,
    /[\d,.]+(?:万|千)?\+?\s*(?:人已付款|人付款)/i
  ];

  function extractSalesText(text) {
    if (!text || typeof text !== 'string') return '';
    for (const pattern of SALES_PATTERNS) {
      const match = text.replace(/\s+/g, ' ').match(pattern);
      if (match) return match[0].trim();
    }
    return '';
  }

  const api = { extractSalesText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.ImageGrabSales = api;
})();
