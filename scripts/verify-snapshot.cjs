const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const assert = (ok, message) => { if (!ok) throw new Error(message); };

const snapshot = read('evidence/2026-11-03/source-snapshot.json');
for (const row of snapshot.files) {
  const content = fs.readFileSync(path.join(root, row.path));
  assert(content.length === row.bytes, `Size mismatch: ${row.path}`);
  assert(crypto.createHash('sha256').update(content).digest('hex') === row.sha256,
    `SHA-256 mismatch: ${row.path}`);
}
const manifest = read('imagegrab-extension/manifest.json');
assert(manifest.version === snapshot.extension_version, 'Extension version mismatch');
const report = read('evidence/2026-11-03/file-verification.json');
const images = read('evidence/2026-11-03/image-file-manifest.json');
assert(images.length === report.total_files && images.length === 300, 'Image count mismatch');
assert(new Set(images.map((x) => x.path)).size === images.length, 'Duplicate manifest path');
assert(images.every((x) => x.bytes > 0 && x.png_signature_valid && /^[a-f0-9]{64}$/.test(x.sha256)),
  'Invalid archived image metadata');
for (const group of report.groups) {
  const rows = images.filter((x) => x.path.startsWith(`${group.keyword}/`));
  assert(rows.length === group.files, `Count mismatch: ${group.keyword}`);
  assert(rows.reduce((sum, x) => sum + x.bytes, 0) === group.total_bytes,
    `Byte count mismatch: ${group.keyword}`);
}
assert(images.reduce((sum, x) => sum + x.bytes, 0) === report.total_bytes, 'Total bytes mismatch');
console.log(`PASS: ${snapshot.files.length} source hashes; extension ${manifest.version}; ${images.length} archived image records.`);
console.log('This is an offline archive check, not a fresh Taobao collection or image semantic check.');
