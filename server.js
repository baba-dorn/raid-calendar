import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWeek, resolveTimeZone } from './src/calendar.js';
import { config, isDemoMode } from './src/config.js';
import { diagnose, explainError } from './src/diagnose.js';
import { applyLanes } from './src/lanes.js';
import { getEvents } from './src/source.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('./public', import.meta.url)));

/**
 * Name des Keksels, mit dem `public/app.js` einen Server erkennt. Muss mit
 * `API_MARKER` in `public/app.js` übereinstimmen – dort steht kein Import,
 * weil die Seite auch ohne Server laufen muss.
 */
export const API_MARKER = 'raidkalender_api';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const target = join(PUBLIC_DIR, relative === '' ? 'index.html' : relative);

  // Kein Ausbruch aus dem public-Verzeichnis.
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 – nicht gefunden');
    return;
  }

  const stat = statSync(target);

  // `no-cache` allein lässt den Browser ohne Validator raten: Er soll bei
  // jedem Aufruf nachfragen, hat aber nichts, womit er das beantworten kann,
  // und landet im Zweifel beim alten Stand. Genau das passiert beim
  // Arbeiten am laufenden Server – man ändert app.js, der Tab zeigt weiter
  // die alte Fassung, und eine Fehlermeldung nennt Zeilennummern, die es im
  // Quelltext nicht mehr gibt. Ein ETag aus Größe und mtime macht daraus eine
  // ehrliche Frage: Geändert? 200 mit neuem Inhalt, unverändert? 304.
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const headers = {
    'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
  };

  // Sagt der Seite, dass hinter dieser Adresse ein Server steht. Sonst
  // erforscht sie es selbst – und auf GitHub Pages kostet das jedes Mal einen
  // 404 im Netzwerk-Tab, den jeder als Fehler liest. Der Marker kommt
  // unwiderruflich ans Dokument, nicht an `/api/week`, damit beim Herumblättern
  // keine einzige Anfrage entsteht. Auch der 304 trägt ihn: Ein Browser, der
  // die Seite zwischenspeichert, würde ihn sonst beim zweiten Aufruf verlieren
  // und wieder ins Leere fragen.
  if (relative === '' || relative === 'index.html') {
    headers['Set-Cookie'] = `${API_MARKER}=1; Path=/; SameSite=Lax; Max-Age=86400`;
  }

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end();
    return;
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/week') {
    const timezone = resolveTimeZone(url.searchParams.get('tz'), config.timezone);
    const { events, guild, fetchedAt, stale, error } = await getEvents();

    const week = buildWeek({
      events,
      guild,
      requestedStart: url.searchParams.get('start'),
      timezone,
      weekStartsOn: config.weekStartsOn,
    });

    // Spuren sind nur Farbe und Beschriftung – der Zeitpunkt jedes Termins
    // bleibt allein davon unberührt.
    const { lanes, source } = applyLanes(week);

    sendJson(res, 200, {
      ...week,
      lanes,
      meta: {
        source: isDemoMode ? 'demo' : 'discord',
        hourHeight: config.hourHeight,
        lanes: source,
        fetchedAt: new Date(fetchedAt).toISOString(),
        stale: Boolean(stale),
        error: error ?? null,
        problem: explainError(error),
      },
    });
    return;
  }

  if (url.pathname === '/api/config') {
    sendJson(res, 200, {
      source: isDemoMode ? 'demo' : 'discord',
      defaultTimezone: config.timezone,
      weekStartsOn: config.weekStartsOn,
      hourHeight: config.hourHeight,
    });
    return;
  }

  if (url.pathname === '/api/health') {
    // `?guild=` prüft einen anderen Server, `?event=` einen einzelnen Termin –
    // beides ohne die Konfiguration zu ändern. Der Bot ist oft in mehreren
    // Gilden, und die Frage ist dann, wo das Event steht und in welchem Zustand.
    const asked = url.searchParams.get('guild');
    const guild = asked && /^\d{17,20}$/.test(asked) ? asked : null;
    const eventParam = url.searchParams.get('event');
    const event = eventParam && /^\d{17,20}$/.test(eventParam) ? eventParam : null;
    const channelParam = url.searchParams.get('channel');
    const channel = channelParam && /^\d{17,20}$/.test(channelParam) ? channelParam : null;
    sendJson(res, 200, {
      uptimeSeconds: Math.round(process.uptime()),
      ...(await diagnose(guild, event, channel)),
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(config.port, config.host, () => {
  const url = `http://${config.host}:${config.port}`;
  console.log(`\n  Wochenkalender läuft auf ${url}`);
  console.log(`  Zeitzone: ${config.timezone}  |  Wochenbeginn: ${config.weekStartsOn === 1 ? 'Montag' : 'Sonntag'}`);
  if (isDemoMode) {
    console.log('  Demo-Modus: DISCORD_TOKEN und/oder DISCORD_GUILD_ID fehlen – es werden Beispieldaten angezeigt.');
    console.log('  Siehe .env.example und README.md für die Einrichtung.\n');
  } else {
    console.log(`  Quelle: Discord-Guild ${config.guildId}\n`);
  }
});
