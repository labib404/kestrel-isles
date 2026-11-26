// Retakes screenshots/ from the game's own ?shot= scenes in headless Chrome, at 1280×800, driven over the
// DevTools protocol with Node's built-in fetch and WebSocket (nothing to install).
//
//   node tools/screenshots.mjs [path-to-chrome]
//
// Chrome renders WebGL in software here (SwiftShader), so each scene gets a few seconds to settle. A PNG over
// the gate's 256 KiB is captured again as a JPEG.

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.argv[2] || process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8095;
const DEBUG = 9343;
const LIMIT = 250 * 1024;
const W = 1280;
const H = 800;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const shots = JSON.parse(readFileSync(join(repo, 'shots.json'), 'utf8'));
const out = join(repo, 'screenshots');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) rmSync(join(out, f));

const server = spawn(process.execPath, ['serve.ts', '--port', String(PORT)], { cwd: repo, stdio: 'ignore' });
const profile = join(tmpdir(), `kestrel-shots-${Date.now()}`);
const browser = spawn(chrome, ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`,
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

async function devtools() {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${DEBUG}/json/version`)).json(); } catch { await wait(250); }
  }
  if (!version) throw new Error('Chrome did not start its debugging endpoint');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let n = 0;
  const calls = new Map();
  const listeners = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && calls.has(msg.id)) {
      const { ok, fail } = calls.get(msg.id);
      calls.delete(msg.id);
      if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
    } else if (msg.method) {
      if (msg.method === 'Runtime.exceptionThrown') console.error('  page error:', msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
      const i = listeners.findIndex((l) => l.method === msg.method && l.session === msg.sessionId);
      if (i >= 0) listeners.splice(i, 1)[0].ok(msg.params);
    }
  };
  return {
    call: (method, params = {}, session) => new Promise((ok, fail) => {
      const id = ++n;
      calls.set(id, { ok, fail });
      ws.send(JSON.stringify({ id, method, params, sessionId: session }));
    }),
    once: (method, session) => new Promise((ok) => listeners.push({ method, session, ok })),
    close: () => ws.close(),
  };
}

async function take(dt, shot) {
  const { browserContextId } = await dt.call('Target.createBrowserContext');
  const { targetId } = await dt.call('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId: s } = await dt.call('Target.attachToTarget', { targetId, flatten: true });
  await dt.call('Page.enable', {}, s);
  await dt.call('Runtime.enable', {}, s);
  await dt.call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, s);
  const loaded = dt.once('Page.loadEventFired', s);
  await dt.call('Page.navigate', { url: `http://localhost:${PORT}/${shot.query}` }, s);
  await loaded;
  await wait(5000);
  let { data } = await dt.call('Page.captureScreenshot', { format: 'png' }, s);
  let name = shot.name;
  if (Buffer.byteLength(data, 'base64') > LIMIT) {
    ({ data } = await dt.call('Page.captureScreenshot', { format: 'jpeg', quality: 88 }, s));
    name = name.replace(/\.png$/i, '.jpg');
  }
  writeFileSync(join(out, name), Buffer.from(data, 'base64'));
  await dt.call('Target.disposeBrowserContext', { browserContextId });
  console.log(`${name.padEnd(32)} ${Buffer.byteLength(data, 'base64')} bytes`);
}

try {
  await wait(800);
  const dt = await devtools();
  for (const shot of shots) await take(dt, shot);
  dt.close();
} finally {
  browser.kill();
  server.kill();
  await wait(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
