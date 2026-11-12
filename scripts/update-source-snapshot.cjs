const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'imagegrab-extension/manifest.json'), 'utf8'));
const sourceRoot = path.join(root, 'imagegrab-extension');
function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(absolutePath) : entry.isFile() ? [absolutePath] : [];
  });
}

const files = sourceFiles(sourceRoot)
  .map((absolutePath) => path.relative(root, absolutePath).split(path.sep).join('/'))
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
const dateArgument = process.argv.find(value => value.startsWith('--date='));
const date = dateArgument?.slice(7) || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Use --date=YYYY-MM-DD');
const directory = path.join(root, 'evidence', date);
fs.mkdirSync(directory, { recursive: true });
const destination = path.join(directory, `source-snapshot-${manifest.version}.json`);
const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
if (fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') !== serialized) {
  throw Error('This version already has a different snapshot. Increment the extension version first.');
}
fs.writeFileSync(destination, serialized, 'utf8');
fs.writeFileSync(path.join(root, 'evidence/source-snapshot.json'), serialized, 'utf8');
console.log(`Wrote ${path.relative(root, destination)} and current snapshot (${files.length} files).`);
