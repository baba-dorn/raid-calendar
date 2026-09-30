/**
 * Kleiner Screenshot-Helfer fuer die Entwicklung:
 *   node tools/shot.mjs <url> <ziel.png> [breite] [hoehe]
 * Startet Chrome headless, laedt die Seite und legt einen Screenshot ab.
 * Benoetigt keinen npm-Screenshotbaustein.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, target, width = '1847', height = '987', evalJsArg = '', clipSpec = ''] = process.argv.slice(2);
// "@datei.js" liest den Ausdruck aus einer Datei. Mehrzeiliges JS als
// Kommandozeile mitzugeben ueberleben je nach Shell keine Backticks.
const evalJs = evalJsArg.startsWith('@') ? readFileSync(evalJsArg.slice(1), 'utf8') : evalJsArg;
if (!url || !target) {
  console.error('Aufruf: node tools/shot.mjs <url> <ziel.png> [breite] [hoehe] [js] [ausschnitt=x,y,w,h,scale]');
  process.exit(1);
}

const CHROME =
  process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shot-'))}`,
  '--no-first-run',
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  `--window-size=${width},${height}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targetSocket() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, {
        method: 'PUT',
      });
      const page = await response.json();
      if (page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* Chrome noch nicht bereit. */
    }
    await sleep(250);
  }
  throw new Error('Chrome antwortet nicht auf dem Debug-Port.');
}

const socketUrl = await targetSocket();
const ws = new WebSocket(socketUrl);
let id = 0;
const pending = new Map();

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);

  // Seitenfehler mit Stack ausgeben – sonst sucht man sie im Bild.
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    console.error('Seitenfehler:', details.exception?.description ?? details.text);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    console.error('console.error:', message.params.args.map((a) => a.description ?? a.value).join(' '));
  }

  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width),
  height: Number(height),
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url });
await sleep(2500);

if (evalJs) {
  const result = await send('Runtime.evaluate', { expression: evalJs, returnByValue: true, awaitPromise: true });
  const value = result.result?.result?.value;
  console.log('eval:', value === undefined ? JSON.stringify(result.result) : JSON.stringify(value));
  await sleep(600);
}

const clip = clipSpec
  ? (([x, y, w, h, scale = 1]) => ({ x, y, width: w, height: h, scale }))(clipSpec.split(',').map(Number))
  : undefined;

const shot = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
writeFileSync(target, Buffer.from(shot.result.data, 'base64'));
console.log(`geschrieben: ${target}`);

ws.close();
chrome.kill();
process.exit(0);