/**
 * Statischer Vorschau-Server, der sich wie GitHub Pages verhält.
 *
 *   node tools/serve-static.mjs [port] [basis]
 *
 * Zwei Unterschiede zum `server.js`, beide wichtig zu prüfen:
 *
 *   1. **Unterordner.** Pages-Projektseiten liegen unter /repo-name/. Ein
 *      absoluter Pfad wie "/app.js" landet dort im Repo-Root und liefert 404 –
 *      die Seite bleibt weiß, ohne dass irgendwo ein Fehler zu sehen wäre.
 *   2. **Keine API.** Es gibt kein `/api/week`. Läuft `public/data/` nicht
 *      mit, bleibt das Brett leer, und genau das sieht man nur hier.
 *
 * Kein Build-Schritt: Was GitHub bekommt, ist genau der Inhalt von `public/`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, '..', 'public');
const port = Number.parseInt(process.argv[2] ?? '3200', 10);
const base = `/${(process.argv[3] ?? 'raid-calendar').replace(/^\/+|\/+$/g, '')}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (!url.pathname.startsWith(base)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Nur unter ${base}/ ausgeliefert.\n`);
    return;
  }

  const relative = normalize(decodeURIComponent(url.pathname.slice(base.length))).replace(/^([/\\])+/, '');
  const target = join(PUBLIC_DIR, relative === '' ? 'index.html' : relative);

  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 – ${relative}\n`);
    return;
  }

  res.writeHead(200, { 'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(target).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`Statisch wie GitHub Pages: http://127.0.0.1:${port}${base}/`);
  console.log(`Ausgeliefert wird ${PUBLIC_DIR}`);
  if (!existsSync(join(PUBLIC_DIR, 'data', 'latest.json'))) {
    console.warn('public/data/latest.json fehlt – vor dem ersten Blick `node tools/snapshot.mjs` laufen lassen.');
  }
});
