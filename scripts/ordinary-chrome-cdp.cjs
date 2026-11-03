// Attach to an already authorized local Chrome. Never starts or closes Chrome.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

if (typeof WebSocket !== 'function') throw Error('This optional client needs Node.js 22+ (tested with 24.14.1).');
const probe = process.argv.includes('--probe');
const marker = process.argv.slice(2).find(value => !value.startsWith('--')) || path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data/DevToolsActivePort');
const [port, suffix] = fs.readFileSync(marker, 'utf8').trim().split(/\r?\n/);
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || !/^\/devtools\/browser\/[a-z0-9-]+$/i.test(suffix || '')) throw Error('Invalid local DevToolsActivePort marker');
const socket = new WebSocket(`ws://127.0.0.1:${port}${suffix}`);
const input = readline.createInterface({ input: process.stdin });
const queued = [];
const pendingMethods = new Map();
let open = false;

function send(line) {
  const command = JSON.parse(line);
  if (!Number.isInteger(command.id) || typeof command.method !== 'string') throw Error('A CDP command needs an integer id and a method');
  if (command.method === 'Browser.close') throw Error('This client keeps the shared browser running; use disconnect');
  pendingMethods.set(command.id, command.method);
  socket.send(JSON.stringify(command));
}
socket.onopen = () => {
  open = true;
  console.log(JSON.stringify({ connected: true, port: Number(port) }));
  if (probe) { send(JSON.stringify({ id: 1, method: 'Browser.getVersion' })); return; }
  for (const line of queued) {
    try { send(line); } catch (error) { console.error(JSON.stringify({error:error.message})); }
  }
};
socket.onmessage = event => {
  const result = JSON.parse(event.data);
  if (!result.id) return;
  // Do not print metadata for unrelated user tabs.
  if (pendingMethods.get(result.id) === 'Target.getTargets' && result.result?.targetInfos) {
    result.result.targetInfos = result.result.targetInfos.filter(target => {
      try {
        const url = new URL(target.url);
        return url.hostname === '1688.com' || url.hostname.endsWith('.1688.com')
          || (url.protocol === 'chrome-extension:' && /\/(research\.html|background\.js)$/.test(url.pathname));
      } catch { return false; }
    }).map(({targetId,type,url,attached}) => ({targetId,type,url,attached}));
  }
  pendingMethods.delete(result.id);
  console.log(JSON.stringify(result));
  if (probe && result.id === 1) socket.close();
};
socket.onerror = event => console.error(JSON.stringify({ error: event.message || 'WebSocket connection failed' }));
socket.onclose = event => { console.log(JSON.stringify({ disconnected: event.code })); process.exit(); };
input.on('line', line => {
  if (line === 'disconnect') { socket.close(); return; }
  if (!line.trim()) return;
  if (!open) { queued.push(line); return; }
  try { send(line); } catch (error) { console.error(JSON.stringify({ error: error.message })); }
});
