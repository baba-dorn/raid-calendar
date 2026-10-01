/**
 * Prüft den Cloudflare-Worker, ohne Cloudflare.
 *
 * `wrangler dev` braucht ein Konto, eine installierte Wrangler-Version und ein
 * Netz – und funktioniert damit erst dann, wenn man schon weiß, ob es
 * überhaupt läuft. Dieser Test nimmt stattdessen das, was der Worker
 * wirklich braucht: ein `env` mit den Bindings, ein Objekt, das nach KV
 * aussieht, und eine Umgebung, die sich wie Cloudflare ausgibt.
 *
 * Geprüft wird der echte `src/worker.js` – Routen, Keksel, KV-Schreibzugriff,
 * der Zeitplan und das Wochenmodell, das `/api/week` zurückgibt. Nicht
 * geprüft wird, was Cloudflare daraus baut; dafür ist `wrangler dev` da.
 *
 *   node tools/worker-check.mjs
 */

let failed = 0;
let passed = 0;

function pruefe(bedingung, text) {
  if (bedingung) {
    passed += 1;
    console.log(`  ok    ${text}`);
  } else {
    failed += 1;
    console.error(`  FEHL  ${text}`);
  }
}

/**
 * Sieht aus wie ein KV-Namespace und merkt sich, was geschrieben wurde.
 * Absichtlich winzig: `get`, `put` und `delete` sind alles, was `kvStore()`
 * benutzt – mehr muesste eine Taeuschung erst recht glaubwuerdig machen.
 */
function fakeKv() {
  const inhalt = new Map();
  return {
    schreibvorgaenge: 0,
    async get(key, typ) {
      if (!inhalt.has(key)) return null;
      const wert = inhalt.get(key);
      return typ === 'json' ? JSON.parse(wert) : wert;
    },
    async put(key, wert) {
      this.schreibvorgaenge += 1;
      inhalt.set(key, wert);
    },
    async delete(key) {
      inhalt.delete(key);
    },
    hat(key) {
      return inhalt.has(key);
    },
    raw(key) {
      return inhalt.get(key);
    },
  };
}

// Der Worker erkennt sich an genau diesem Satz. Er muss gesetzt sein, *bevor*
// `src/config.js` geladen wird – dort steht die Entscheidung, ob es die
// `.env` gibt.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Cloudflare-Workers' },
  configurable: true,
  writable: true,
});

const worker = (await import('../src/worker.js')).default;
const { configure, isDemoMode, isWorkerRuntime } = await import('../src/config.js');
const { loadLaneConfig } = await import('../src/lanes.js');

console.log('\nLaufzeit');
pruefe(isWorkerRuntime === true, 'src/config.js erkennt die Cloudflare-Umgebung');

console.log('\nKonfiguration aus den Bindings');
const env = {
  DISCORD_GUILD_ID: '',
  TIMEZONE: 'Europe/Berlin',
  WEEK_STARTS_ON: '1',
  HOUR_HEIGHT: '46',
  KV: fakeKv(),
  // Nur ein Attrappen: es wird nur weitergereicht, nie wirklich gelesen.
  ASSETS: {
    async fetch(request) {
      const pfad = new URL(request.url).pathname;
      return new Response(`<html lang="de"><!-- ${pfad} --></html>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  },
};
configure(env);
pruefe(isDemoMode === true, 'ohne Token laeuft der Worker im Demo-Modus');
pruefe(env.KV.hat('week:snapshot') === false, 'die KV ist anfangs leer');

console.log('\nGET /api/week (erste Anfrage, KV noch leer)');
const erste = await worker.fetch(new Request('https://kalender.example/api/week'), env);
const ersteDaten = await erste.json();
pruefe(erste.status === 200, `antwortet mit 200 (${erste.status})`);
pruefe(ersteDaten.days?.length === 7, `liefert sieben Tage (${ersteDaten.days?.length})`);
pruefe(
  typeof ersteDaten.meta?.fetchedAt === 'string' && !Number.isNaN(Date.parse(ersteDaten.meta.fetchedAt)),
  `meta.fetchedAt ist ein Zeitpunkt (${ersteDaten.meta?.fetchedAt})`,
);
pruefe(ersteDaten.meta?.cron === true, 'meta.cron zeigt an, dass hier ein Zeitplan steht');
pruefe(env.KV.hat('week:snapshot'), 'der erste Aufruf hat den Schnappschuss in die KV geschrieben');
pruefe(env.KV.schreibvorgaenge === 1, `genau ein Schreibvorgang (${env.KV.schreibvorgaenge})`);

console.log('\nSpuren');
// `setLaneText()` passiert beim ersten Aufruf, nicht schon beim Start: Der
// Worker wird ja erst dann gefragt. Bis dahin laeuft die Vorgabe.
const spuren = loadLaneConfig();
pruefe(spuren.origin === 'bundle', 'lanes.json kam aus dem Bundle statt von der Platte');
pruefe(Array.isArray(spuren.lanes), `die Spuren wurden uebernommen (${spuren.lanes.length})`);
pruefe(ersteDaten.meta?.lanes === 'bundle', 'das Wochenmodell nennt dieselbe Herkunft');

console.log('\nGET /api/week (zweite Anfrage, gleiche Daten)');
const zweite = await worker.fetch(new Request('https://kalender.example/api/week'), env);
const zweiteDaten = await zweite.json();
pruefe(
  zweiteDaten.generatedAt === ersteDaten.generatedAt,
  `der Zeitstempel bleibt stehen – sonst erkennt die Seite nie "unveraendert" (${zweiteDaten.generatedAt})`,
);
pruefe(env.KV.schreibvorgaenge === 1, 'und es gab keinen zweiten Schreibvorgang');

console.log('\nZeitplan');
await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, env, {});
pruefe(env.KV.schreibvorgaenge === 2, `der Zeitplan schreibt (${env.KV.schreibvorgaenge} Schreibvorgaenge)`);
const nachCron = JSON.parse(env.KV.raw('week:snapshot'));
pruefe(Array.isArray(nachCron.events), `in der KV liegen ${nachCron.events?.length} Termine`);
pruefe(typeof nachCron.fetchedAt === 'number', 'der Schnappschuss traegt einen Zeitpunkt');
pruefe(nachCron.lastError === null, 'und keinen Fehler');

console.log('\nGET /api/week nach dem Zeitplan');
const dritte = await worker.fetch(new Request('https://kalender.example/api/week?tz=UTC'), env);
const dritteDaten = await dritte.json();
pruefe(dritte.status === 200, `antwortet mit 200 (${dritte.status})`);
pruefe(dritteDaten.timezone === 'UTC', `die Zeitzone wird umgerechnet (${dritteDaten.timezone})`);

console.log('\nDie Seite und der Keksel');
const dokument = await worker.fetch(new Request('https://kalender.example/'), env);
const keksel = dokument.headers.get('set-cookie') ?? '';
pruefe(
  keksel.includes('raidkalender_api=1'),
  `das HTML-Dokument bringt den Keksel mit (${keksel.split(';')[0] || 'ohne'})`,
);
const datei = await worker.fetch(new Request('https://kalender.example/app.js'), env);
pruefe(
  (datei.headers.get('set-cookie') ?? '') === '',
  'eine normale Datei bekommt ihn nicht – er gehoert dem Dokument',
);

console.log('\nDie uebrigen Routen');
const cfg = await (await worker.fetch(new Request('https://kalender.example/api/config'), env)).json();
pruefe(cfg.source === 'demo', `/api/config meldet die Quelle (${cfg.source})`);
pruefe(cfg.hourHeight === 46, `/api/config meldet die Stundenhöhe (${cfg.hourHeight})`);
const gesundheit = await (await worker.fetch(new Request('https://kalender.example/api/health'), env)).json();
pruefe(gesundheit.runtime === 'cloudflare-worker', '/api/health verraet die Laufzeit');
const ohnePost = await worker.fetch(new Request('https://kalender.example/api/refresh'), env);
pruefe(ohnePost.status === 405, `GET /api/refresh wird abgelehnt (${ohnePost.status})`);
const mitPost = await worker.fetch(new Request('https://kalender.example/api/refresh', { method: 'POST' }), env);
pruefe(mitPost.status === 200, `POST /api/refresh holt sofort neu (${mitPost.status})`);

console.log('\nVertrag mit dem Frontend');
// `public/app.js` liest genau diese Felder. Fehlt eines, faellt es nicht laut
// auf, sondern zeigt eine leere Seite – deshalb hier ausdruecklich geprueft.
const erwartet = [
  'days',
  'generatedAt',
  'guild',
  'lanes',
  'meta',
  'seriesLength',
  'timezone',
  'today',
  'weekEnd',
  'weekStart',
];
pruefe(
  erwartet.every((schluessel) => schluessel in dritteDaten),
  `das Wochenmodell traegt ${erwartet.join(', ')}`,
);
const metaErwartet = ['error', 'fetchedAt', 'hourHeight', 'lanes', 'problem', 'source', 'stale'];
pruefe(
  metaErwartet.every((schluessel) => schluessel in dritteDaten.meta),
  `meta traegt ${metaErwartet.join(', ')}`,
);
pruefe(
  dritteDaten.days.every((tag) => Array.isArray(tag.occurrences)),
  'jeder Tag hat seine Termine',
);

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);