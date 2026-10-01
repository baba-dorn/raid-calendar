import { config, isDemoMode } from './config.js';
import { buildDemoEvents, DEMO_GUILD } from './demo.js';
import { fetchGuild, fetchGuildEvents, normalizeEvent } from './discord.js';

const CDN = 'https://cdn.discordapp.com';

function guildIconUrl(guild) {
  return guild?.icon ? `${CDN}/icons/${guild.id}/${guild.icon}.png?size=256` : null;
}

function guildBannerUrl(guild) {
  return guild?.banner ? `${CDN}/banners/${guild.id}/${guild.banner}.png?size=1024` : null;
}

/**
 * Schnappschuss ohne brauchbare Daten: trägt ID und Namen, damit Kopfzeile und
 * Banner etwas anzeigen, und sonst nichts.
 */
function placeholderGuild() {
  return {
    id: config.guildId,
    name: `Guild ${config.guildId}`,
    icon: null,
    banner: null,
    memberCount: null,
    demo: false,
  };
}

/**
 * Holt Termine und Gildenmetadaten aus Discord.
 *
 * Scheitert der Abruf, kommt `lastError` zurück und `events` bleibt `null` –
 * den letzten guten Schnappschuss zieht `getEvents()` nach. Das ist genau das
 * Verhalten, das vorher der Cache im Arbeitsspeicher hatte.
 */
async function fetchSnapshot() {
  if (isDemoMode) {
    const events = buildDemoEvents(DEMO_GUILD.id, config.timezone);
    return { events, guild: DEMO_GUILD, fetchedAt: Date.now(), lastError: null };
  }

  try {
    const [rawEvents, guild] = await Promise.all([
      fetchGuildEvents({
        token: config.discordToken,
        guildId: config.guildId,
        apiBase: config.apiBase,
        userAgent: config.userAgent,
      }),
      fetchGuild({
        token: config.discordToken,
        guildId: config.guildId,
        apiBase: config.apiBase,
        userAgent: config.userAgent,
      }).catch(() => null),
    ]);

    // Status 4 = abgesagt. Solche Termine bleiben drin: nur so kann die
    // Grundzeile "entfällt" anzeigen, statt still zu bleiben.
    const events = rawEvents
      .filter((raw) => raw.status === 1 || raw.status === 2 || raw.status === 4)
      .map((raw) =>
        normalizeEvent(raw, {
          guildId: config.guildId,
          defaultDurationMinutes: config.defaultDurationMinutes,
        }),
      );

    return {
      events,
      guild: {
        id: config.guildId,
        name: guild?.name ?? `Guild ${config.guildId}`,
        icon: guildIconUrl(guild),
        banner: guildBannerUrl(guild),
        memberCount: guild?.member_count ?? null,
        demo: false,
      },
      fetchedAt: Date.now(),
      lastError: null,
    };
  } catch (error) {
    return { events: null, guild: null, fetchedAt: Date.now(), lastError: error.message };
  }
}

/* ------------------------------------------------------------------ *
 * Wo der Schnappschuss liegt
 * ------------------------------------------------------------------ */

/**
 * Im Arbeitsspeicher – für den lokalen Server. Ein Isolate lebt genau eine
 * Weile, aber das ist hier Absicht: Der Prozess soll beenden, wenn er
 * beendet wird, und nicht erst eine Minute später.
 */
export function memoryStore() {
  let snapshot = null;
  return {
    async read() {
      return snapshot;
    },
    async write(next) {
      snapshot = next;
    },
  };
}

/**
 * In der Cloudflare-KV – für den Worker. Damit fragt **kein** Seitenaufruf
 * Discord ab: Der Zeitplan schreibt, alle lesen nur noch.
 *
 * Ein Key, nicht zwei. Der Fehler gehört in denselben Schnappschuss wie die
 * Daten, denn beides wird gemeinsam gelesen – ein zweiter Key würde eine
 * zweite Runde KV-Zugriffe kosten und die Sichtbarkeit beider Vorgänge
 * auseinanderlaufen lassen.
 */
export function kvStore(kv, { key = 'week:snapshot' } = {}) {
  return {
    async read() {
      const raw = await kv.get(key, 'json');
      if (!raw || !Array.isArray(raw.events)) return null;
      return raw;
    },
    async write(snapshot) {
      await kv.put(key, JSON.stringify(snapshot));
    },
  };
}

/** Wie lange ein Fehlschlag gehalten wird, bevor erneut versucht wird. */
const RETRY_AFTER_ERROR_MS = 5_000;

/**
 * Die Datenquelle: Schnappschuss holen, cachen, und das, was da ist,
 * zurückgeben – in beiden Laufzeiten gleich.
 *
 * `store` entscheidet nur, **wo** der Schnappschuss liegt (Arbeitsspeicher
 * oder KV), nicht, wie er zustande kommt. Dadurch bleibt der lokale Server
 * und der Worker dieselbe Anwendung.
 */
export function createSource(store) {
  /** Ein laufender Abruf, an den sich parallele Aufrufe halten. */
  let inflight = null;

  /**
   * Holt einen neuen Schnappschuss, ohne den Cache zu befragen – das macht der
   * Zeitplan im Worker alle fünf Minuten.
   */
  async function refresh() {
    if (!inflight) {
      inflight = fetchSnapshot().finally(() => {
        inflight = null;
      });
    }
    const fresh = await inflight;
    const cached = await store.read();

    // Ein erfolgreicher Stand wird nicht durch einen späteren Fehlschlag
    // ersetzt – sonst leert sich der Kalender bei jedem 429 für ein ganzes
    // Cache-Fenster. Der Zeitpunkt der *Daten* bleibt der alte, nur der
    // Versuch wird vermerkt.
    const merged =
      fresh.lastError && cached?.events?.length
        ? {
            events: cached.events,
            guild: cached.guild,
            fetchedAt: cached.fetchedAt,
            attemptedAt: fresh.fetchedAt,
            lastError: fresh.lastError,
          }
        : {
            events: fresh.events ?? [],
            guild: fresh.guild ?? placeholderGuild(),
            fetchedAt: fresh.fetchedAt,
            attemptedAt: fresh.fetchedAt,
            lastError: fresh.lastError ?? null,
          };

    await store.write(merged);
    return merged;
  }

  async function getEvents() {
    const cached = await store.read();
    const age = cached ? Date.now() - cached.fetchedAt : Infinity;
    const sinceAttempt = cached ? Date.now() - (cached.attemptedAt ?? cached.fetchedAt) : Infinity;

    if (cached?.events?.length && age < config.cacheTtlMs) {
      return { ...cached, stale: false, error: null, cached: true };
    }
    if (cached?.lastError && sinceAttempt < RETRY_AFTER_ERROR_MS) {
      return { ...cached, stale: true, error: cached.lastError, cached: true };
    }

    const merged = await refresh();

    return {
      ...merged,
      stale: Boolean(merged.lastError && cached?.events?.length),
      error: merged.lastError ?? null,
      cached: false,
    };
  }

  return { getEvents, refresh };
}

/** Die Quelle des lokalen Servers: Arbeitsspeicher, sofort befüllt. */
export const defaultSource = createSource(memoryStore());

/** Wie bisher – der lokale Server und `tools/snapshot.mjs` bleiben unberührt. */
export const getEvents = () => defaultSource.getEvents();