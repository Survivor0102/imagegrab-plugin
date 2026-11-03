const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, safeName, checkPng, parseDownloadPath, uniqueDownloadItems } = require('../runner-utils.cjs');
const original = require('../../collection.config.json');

test('reject output traversal and external CDP endpoints', () => {
  assert.throws(() => validateConfig({ ...original, outputDirectory: '../../elsewhere' }));
  assert.throws(() => validateConfig({ ...original, endpoint: 'http://example.com:9333' }));
  assert.throws(() => validateConfig({ ...original, outputDirectory: 'imagegrab-extension' }));
});
test('reject bad filenames and invalid batch counts', () => {
  for (const name of ['../other', 'CON', 'test.', '']) assert.throws(() => safeName(name));
  assert.throws(() => validateConfig({ ...original, batches: [{ keyword: 'test', page: 1, count: 0 }] }));
});
test('reject original-format fallback renamed to PNG and empty files', () => {
  assert.throws(() => checkPng(Buffer.alloc(0)));
  assert.throws(() => checkPng(Buffer.from('<html>access denied</html>')));
  assert.throws(() => checkPng(Buffer.from([255, 216, 255, 224, 1, 2, 3, 4, 5])));
});
test('decode browser download paths from chrome file-icon URLs', () => {
  assert.equal(parseDownloadPath('chrome://fileicon/?path=C%3A%5CUsers%5CTest%5Cimage.png'),
    'C:\\Users\\Test\\image.png');
  assert.equal(parseDownloadPath('not a URL'), null);
});
test('count each browser download path once', () => {
  const item = path => ({ path: `chrome://fileicon/?path=${encodeURIComponent(path)}` });
  assert.deepEqual(uniqueDownloadItems([item('C:\\a.png'), item('C:\\a.png'), item('C:\\b.png')]),
    [item('C:\\a.png'), item('C:\\b.png')]);
});
