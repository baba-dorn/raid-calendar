/**
 * Dieselbe Anwendung wie `server.js`, aber als Cloudflare Worker.
 *
 * Der Unterschied ist genau einer, und er ist der entscheidende: **Kein
 * Seitenaufruf fragt Discord ab.** Der Zeitplan (`scheduled`) holt die Daten
 * alle paar Minuten und legt sie in die KV; `/api/week` liest daraus und
 * rechnet daraus die angefragte Woche. Damit kann die Seite nicht durch
 * Besucherverkehr ein Rate Limit auslösen, und der Abruf passiert auch dann,
 * wenn niemand die Seite offen hat – auf GitHub Pages war das der Punkt, an
 * dem es ohnehin nur den stündlichen Workflow gab.
 *
 * Aus demselben Grund ist `buildWeek` an den Zeitpunkt der *Daten* gepinnt:
 * Sonst hätte jeder Aufruf einen anderen `generatedAt`, die Seite könnte ihre
 * Nachfrage nie als „unverändert" erkennen, und der Rand-Cache hätte nichts
 * zu wiederverwenden.
 */
import { buildWeek, resolveTimeZone } from './calendar.js';
import { config, configure, isDemoMode } from './config.js';
import { diagnose, explainError } from './diagnose.js';
import { applyLanes, setLaneText } from './lanes.js';
import { LANES_TEXT } from './lanes.data.js';
import { createSource, kvStore } from './source.js';

/**
 * Name des Keksels, mit dem `public/app.js` einen Server erkennt. Muss mit
 * `API_MARKER` in `public/app.js` und `server.js` übereinstimmen.
 */
const API_MARKER = 'raidkalender_api';

let quelle = null;
let quelleKv = null;

/**
 * Eine Quelle je Bindung, nicht je Aufruf. Sie ist reine Logik ohne
 * Zustandsverwaltung – der Schnappschuss liegt in der KV, nicht hier –, aber
 * ein Neuanlegen bei jedem Aufruf würde auch `inflight` neu setzen und
 * gleichzeitige Besucher jede für sich nach Discord schicken lassen.
 */
function sourceFor(env) {
  if (!quelle || quelleKv !== env.KV) {
    setLaneText(LANES_TEXT);
    quelle = createSource(kvStore(env.KV));
    quelleKv = env.KV;
  }
  return quelle;
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function handleWeek(env, url) {
  const { events, guild, fetchedAt, stale, error } = await sourceFor(env).getEvents();
  const timezone = resolveTimeZone(url.searchParams.get('tz'), config.timezone);

  const now = new Date(fetchedAt);
  const week = buildWeek({
    events,
    guild,
    requestedStart: url.searchParams.get('start'),
    timezone,
    weekStartsOn: config.weekStartsOn,
    now,
  });

  // Spuren sind nur Farbe und Beschriftung – der Zeitpunkt jedes Termins
  // bleibt allein davon unberührt.
  const { lanes, source } = applyLanes(week);

  return json(200, {
    ...week,
    lanes,
    meta: {
      source: isDemoMode ? 'demo' : 'discord',
      hourHeight: config.hourHeight,
      lanes: source,
      fetchedAt: now.toISOString(),
      stale: Boolean(stale),
      error: error ?? null,
      problem: explainError(error),
      cron: true,
    },
  });
}

async function handleHealth(env, url) {
  const asked = url.searchParams.get('guild');
  const guild = asked && /^\d{17,20}$/.test(asked) ? asked : null;
  const eventParam = url.searchParams.get('event');
  const event = eventParam && /^\d{17,20}$/.test(eventParam) ? eventParam : null;
  const channelParam = url.searchParams.get('channel');
  const channel = channelParam && /^\d{17,20}$/.test(channelParam) ? channelParam : null;

  return json(200, {
    // Anders als unter Node gibt es hier keinen Prozess, dessen Laufzeit man
    // melden könnte. Der Stand des letzten Laufs sagt mehr aus als die
    // Laufzeit eines Workers, den es in fünf Minuten woanders gibt.
    runtime: 'cloudflare-worker',
    ...(await diagnose(guild, event, channel)),
  });
}

/** Wie `Run workflow` bei den GitHub Actions: sofort neu holen, ohne zu warten. */
async function handleRefresh(env) {
  const merged = await sourceFor(env).refresh();
  return json(200, {
    refreshedAt: new Date(merged.fetchedAt).toISOString(),
    events: merged.events.length,
    error: merged.lastError ?? null,
  });
}

export default {
  async fetch(request, env) {
    configure(env);

    const url = new URL(request.url);

    if (url.pathname === '/api/week') return handleWeek(env, url);
    if (url.pathname === '/api/config') {
      return json(200, {
        source: isDemoMode ? 'demo' : 'discord',
        defaultTimezone: config.timezone,
        weekStartsOn: config.weekStartsOn,
        hourHeight: config.hourHeight,
      });
    }
    if (url.pathname === '/api/health') return handleHealth(env, url);
    if (url.pathname === '/api/refresh') {
      if (request.method !== 'POST') {
        return json(405, { error: 'POST verwenden – ein GET würde jeden Aufruf neu holen.' });
      }
      return handleRefresh(env);
    }

    // Das HTML-Dokument und die API laufen hier durch, der Rest kommt direkt
    // aus dem CDN. Grund ist allein der Keksel: Ohne ihn hält `public/app.js`
    // den Worker für eine GitHub-Pages-Seite und fragt nur noch nach Dateien,
    // die es dort nicht gibt. Er wird an der Antwort gesetzt, die ohnehin
    // schon hier vorbeikommt – nicht in `public/_headers`, denn ob
    // Static Assets dort ein `Set-Cookie` zulassen, ist zwischen Pages und
    // Workers nicht dasselbe, und dieses eine Bit darf nicht daran hängen.
    const asset = await env.ASSETS.fetch(request);
    if (url.pathname !== '/' && !url.pathname.endsWith('/index.html')) return asset;

    const headers = new Headers(asset.headers);
    headers.append('Set-Cookie', `${API_MARKER}=1; Path=/; SameSite=Lax; Max-Age=86400`);
    return new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  },

  /**
   * Der Zeitplan. Schreibt den Schnappschuss in die KV; alles andere liest
   * nur noch.
   */
  async scheduled(controller, env) {
    configure(env);
    const merged = await sourceFor(env).refresh();

    if (merged.lastError) {
      // Der letzte gute Stand bleibt in der KV stehen – die Seite zeigt ihn
      // mit `stale`, statt zu leeren.
      console.warn(`[cron] ${controller.cron} → ${merged.lastError}`);
    } else {
      console.log(
        `[cron] ${controller.cron} → ${merged.events.length} Termine, Stand ${new Date(merged.fetchedAt).toISOString()}`,
      );
    }
  },
};