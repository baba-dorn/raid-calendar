const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Cloudflare stellt sich selbst so vor; alles andere ist Node.
 *
 * Nur unter Node gibt es ein Dateisystem, also wird der `.env`-Loader auch nur
 * dort nachgeladen. Ein *statischer* Import von `env.js` würde im Worker
 * `fileURLToPath(import.meta.url)` ausführen – und genau daran scheitert die
 * Dateisystem-Variante von workerd. Der Test muss außerdem vor dem ersten
 * `await` stehen: ES-Module führen sonst den Loader aus, bevor jemand
 * `configure(env)` aufrufen kann, und die Bindings kämen zu spät.
 */
export const isWorkerRuntime =
  globalThis.navigator?.userAgent === 'Cloudflare-Workers';

/** Wurzelverzeichnis des Projekts – unter Node von Bedeutung, sonst `null`. */
let root = null;
if (!isWorkerRuntime) {
  const { loadEnvFile, ROOT } = await import('./env.js');
  loadEnvFile();
  root = ROOT;
}

/**
 * Liest die Konfiguration aus den Prozessvariablen (Node) oder aus den Bindings
 * eines Workers.
 *
 * Im Worker kommt der Token ausschließlich über `wrangler secret put
 * DISCORD_TOKEN` herein – als Secret im Bindings, nicht im Bundle.
 */
function readConfig(env) {
  const get = (key) => (env ? env[key] : process.env[key]);
  const text = (key) => get(key)?.trim() || null;

  return {
    root,
    port: int(get('PORT'), 3000),
    host: text('HOST') ?? '127.0.0.1',

    discordToken: text('DISCORD_TOKEN'),
    guildId: text('DISCORD_GUILD_ID'),

    /** Zeitzone, in der die Wochenübersicht gerechnet und angezeigt wird. */
    timezone: text('TIMEZONE') ?? 'Europe/Berlin',
    /** 1 = Montag, 0 = Sonntag. */
    weekStartsOn: int(get('WEEK_STARTS_ON'), 1),
    /** Anzeigeminuten je Stunde im Raster. */
    hourHeight: int(get('HOUR_HEIGHT'), 46),
    /** Fallback-Dauer für Events ohne `scheduled_end_time`. */
    defaultDurationMinutes: int(get('DEFAULT_DURATION_MINUTES'), 120),
    /** Wie lange der Schnappschuss serverseitig gecacht wird. */
    cacheTtlMs: int(get('CACHE_TTL_MS'), 60_000),
    /** Spurendatei – unter Node gelesen, im Worker aus dem Bundle. */
    lanesFile: text('LANES_FILE'),

    apiBase: 'https://discord.com/api/v10',
    userAgent:
      'DiscordBot (https://github.com/local/discord-week-calendar, 1.0.0)',
  };
}

export const config = readConfig(null);

/** Ohne Token oder ohne Guild-ID laufen wir mit Demo-Daten. */
export let isDemoMode = !config.discordToken || !config.guildId;

/**
 * Legt die Bindings eines Workers über die Konfiguration – einmal je Aufruf.
 *
 * Das ist absichtlich ein `Object.assign` auf ein vorhandenes Objekt statt einer
 * zweiten, parallelen Konfiguration: `calendar.js`, `source.js` und
 * `diagnose.js` lesen `config` zur Laufzeit, und die Module werden lange vor
 * dem ersten `fetch` ausgewertet. Ein Austausch des Objekts würde dort nicht
 * ankommen, ein veränderliches Objekt schon.
 */
export function configure(env) {
  Object.assign(config, readConfig(env));
  isDemoMode = !config.discordToken || !config.guildId;
  return config;
}