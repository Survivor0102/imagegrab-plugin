// Attach to an already authorized local Chrome. Never starts or closes Chrome.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');

if (typeof WebSocket !== 'function') throw Error('This optional client needs Node.js 22+ (tested with 24.14.1).');
const probe = process.argv.includes('--probe');
const explicitMarker = process.argv.slice(2).find(value => !value.startsWith('--'));

function readJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(1200, () => { request.destroy(new Error('HTTP discovery timeout')); });
    request.on('error', reject);
  });
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket authorization/connection timeout after 300000ms; no automatic retry')); }, 300000);
    socket.onopen = () => { clearTimeout(timer); resolve(socket); };
    socket.onerror = event => { clearTimeout(timer); reject(new Error(event.message || 'WebSocket connection failed')); };
  });
}

async function resolveEndpoint() {
  if (!explicitMarker) {
    try {
      const version = await readJson('http://127.0.0.1:9222/json/version');
      if (version.webSocketDebuggerUrl) return { url: version.webSocketDebuggerUrl, port: 9222, source: 'http-discovery' };
    } catch {}
  }

  const markers = explicitMarker ? [explicitMarker] : [
    path.join(process.env.CHROME_USER_DATA_DIR || '', 'DevToolsActivePort'),
    'C:/Users/ASUS/Desktop/ordinary-chrome-bridge-link/DevToolsActivePort',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data/DevToolsActivePort')
  ];
  for (const marker of markers) {
    if (!marker || !fs.existsSync(marker)) continue;
    const [port, suffix] = fs.readFileSync(marker, 'utf8').trim().split(/\r?\n/);
    if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || !/^\/devtools\/browser\/[a-z0-9-]+$/i.test(suffix || '')) continue;
    // Discovery must not open a throwaway connection: Chrome may require a
    // separate user grant for every new remote-debugging WebSocket.
    return { url: `ws://127.0.0.1:${port}${suffix}`, port: Number(port), source: 'DevToolsActivePort', marker };
  }
  throw Error('No usable local Chrome CDP endpoint found');
}

(async () => {
  const endpoint = await resolveEndpoint();
  console.log(JSON.stringify({ waitingForConnection: true, port: endpoint.port, source: endpoint.source, authorizationTimeoutMs: 300000 }));
  const socket = await openSocket(endpoint.url);
  const input = readline.createInterface({ input: process.stdin });
  const queued = [];
  const pendingMethods = new Map();
  let open = true;

  function send(line) {
    const command = JSON.parse(line);
    if (!Number.isInteger(command.id) || typeof command.method !== 'string') throw Error('A CDP command needs an integer id and a method');
    if (command.method === 'Browser.close') throw Error('This client keeps the shared browser running; use disconnect');
    pendingMethods.set(command.id, command.method);
    socket.send(JSON.stringify(command));
  }
  console.log(JSON.stringify({ connected: true, port: endpoint.port, source: endpoint.source, marker: endpoint.marker || null }));
  if (probe) send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
  for (const line of queued) {
    try { send(line); } catch (error) { console.error(JSON.stringify({error:error.message})); }
  }
  socket.onmessage = event => {
    const result = JSON.parse(event.data);
    if (!result.id) return;
    // Do not print metadata for unrelated user tabs.
    if (pendingMethods.get(result.id) === 'Target.getTargets' && result.result?.targetInfos) {
      result.result.targetInfos = result.result.targetInfos.filter(target => {
        try {
          const url = new URL(target.url);
          return url.hostname === '1688.com' || url.hostname.endsWith('.1688.com')
            || (url.protocol === 'chrome-extension:' && /\/(research\.html|offer\.html|sourcing\.html|background\.js)$/.test(url.pathname));
        } catch { return false; }
      }).map(({targetId,type,url,attached}) => ({targetId,type,url,attached}));
    }
    pendingMethods.delete(result.id);
    console.log(JSON.stringify(result));
    if (probe && result.id === 1) socket.close();
  };
  socket.onerror = event => console.error(JSON.stringify({ error: event.message || 'WebSocket connection failed' }));
  socket.onclose = event => { open = false; console.log(JSON.stringify({ disconnected: event.code })); process.exit(); };
  input.on('line', line => {
    if (line === 'disconnect') { socket.close(); return; }
    if (!line.trim()) return;
    if (!open) return;
    try { send(line); } catch (error) { console.error(JSON.stringify({ error: error.message })); }
  });
})();
