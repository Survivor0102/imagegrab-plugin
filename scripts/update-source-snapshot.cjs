const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'imagegrab-extension/manifest.json'), 'utf8'));
const sourceRoot = path.join(root, 'imagegrab-extension');
const files = fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => `imagegrab-extension/${entry.name}`)
  .sort()
  .map((relativePath) => {
    const content = fs.readFileSync(path.join(root, relativePath));
    return {
      path: relativePath,
      bytes: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex')
    };
  });

const snapshot = {
  extension_version: manifest.version,
  snapshot_kind: 'ImageGrab source integrity snapshot; see validation notes for synthetic tests and live-site status',
  files
};
const destination = path.join(root, `evidence/2026-11-03/source-snapshot-${manifest.version}.json`);
const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
fs.writeFileSync(destination, serialized, 'utf8');
fs.writeFileSync(path.join(root, 'evidence/2026-11-03/source-snapshot.json'), serialized, 'utf8');
console.log(`Wrote ${path.relative(root, destination)} and current snapshot (${files.length} files).`);
