const crypto = require('node:crypto');
const path = require('node:path');
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function safeName(value) {
  if (typeof value !== 'string' || !value.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(value) ||
      /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new Error('Keyword must be a valid Windows folder name');
  }
  return value;
}
function validateConfig(config) {
  const url = new URL(config.endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('CDP endpoint must be a local HTTP address');
  }
  if (!Array.isArray(config.batches) || !config.batches.length) throw new Error('No batches configured');
  for (const batch of config.batches) {
    safeName(batch.keyword);
    if (!Number.isInteger(batch.page) || batch.page < 1 || !Number.isInteger(batch.count) ||
        batch.count < 1 || batch.count > 500) throw new Error('Invalid batch page/count');
  }
  for (const key of ['pageTimeoutMs', 'downloadTimeoutMs', 'navigationDelayMs']) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`Invalid ${key}`);
  }
  if (!config.outputDirectory || path.isAbsolute(config.outputDirectory)) {
    throw new Error('Use a relative project output directory');
  }
  const base = path.resolve(__dirname, '..');
  const resolved = path.resolve(base, config.outputDirectory);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
      !['output', 'runtime'].includes(relative.split(path.sep)[0])) {
    throw new Error('Output must stay under project output/ or runtime/');
  }
  return { ...config, outputDirectory: resolved };
}
function usable(meta) {
  return meta.complete && meta.width >= 100 && meta.height >= 100 &&
    !/600000000|\/tps\/|icon|logo|sprite|placeholder|loading|avatar|emoji|qr/i.test(meta.url);
}
function checkPng(bytes) {
  if (bytes.length <= 8 || !bytes.subarray(0, 8).equals(PNG)) throw new Error('Downloaded file is not a nonempty PNG');
  return { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
function parseDownloadPath(iconUrl) {
  try {
    return new URL(iconUrl).searchParams.get('path');
  } catch { return null; }
}
module.exports = { safeName, validateConfig, usable, checkPng, parseDownloadPath };
