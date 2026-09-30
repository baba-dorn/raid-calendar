import { config, isDemoMode } from './config.js';

/** Grobe Einordnung der Discord-Fehler in eine hilfreiche Handlungsanweisung. */
export function explainError(message) {
  if (!message) return null;

  if (message.includes('403') && message.includes('50001')) {
    return {
      kind: 'missing-access',
      title: 'Der Bot hat keinen Zugriff auf diesen Server',
      hint:
        'Der Bot ist kein Mitglied in dieser Guild. ' +
        'Lade ihn über die Einladungs-URL aus /api/health in den Server ein ' +
        'und gib ihm „View Channels“ (Berechtigungsbit 1024).',
    };
  }

  if (message.includes('404') || message.includes('10004')) {
    return {
      kind: 'unknown-guild',
      title: 'Die Guild-ID ist unbekannt',
      hint:
        'Unter dieser ID liefert Discord keinen Server zurück. ' +
        'Prüfe DISCORD_GUILD_ID oder aktualisiere sie über /api/health.',
    };
  }

  if (message.includes('401')) {
    return {
      kind: 'unauthorized',
      title: 'Der Bot-Token wird nicht akzeptiert',
      hint: 'DISCORD_TOKEN prüfen – ggf. im Developer Portal einen neuen Token erzeugen.',
    };
  }

  if (message.includes('429')) {
    return {
      kind: 'rate-limited',
      title: 'Discord hat die Anfrage gedrosselt',
      hint: 'Zu viele Anfragen in kurzer Zeit. In wenigen Sekunden erneut laden.',
    };
  }

  return { kind: 'unknown', title: 'Discord-API-Fehler', hint: message };
}

/**
 * Jeder Aufruf kostet drei Discord-Anfragen. Damit wiederholtes Nachsehen
 * nicht selbst ein Rate Limit auslöst, wird das Ergebnis kurz gehalten.
 */
const DIAGNOSE_TTL_MS = 30_000;
let diagnoseCache = { result: null, at: 0 };
let diagnoseInflight = null;

/**
 * Prüft Token, konfigurierte Guild und Mitgliedschaften – für die Fehlersuche.
 *
 * `guildId` überschreibt die konfigurierte Guild **nur für diese Prüfung**. Der
 * Bot ist oft in mehreren Servern, und die häufigste Frage ist dann: In welchem
 * steht das Event überhaupt? `eventId` holt einen einzelnen Termin direkt – der
 * Einzelabruf liefert auch abgeschlossene Termine, die die Liste unterschlägt.
 * `channelId` prüft, ob der Bot den Kanal überhaupt sehen darf: Discord blendet
 * Events aus, deren Kanal für ihn nicht sichtbar ist. Der Kalender selbst
 * bleibt unberührt.
 */
export async function diagnose(guildId = null, eventId = null, channelId = null) {
  const key = `${guildId ?? ''}/${eventId ?? ''}/${channelId ?? ''}`;
  if (Date.now() - diagnoseCache.at < DIAGNOSE_TTL_MS && diagnoseCache.key === key) {
    return diagnoseCache.result;
  }
  if (!diagnoseInflight) {
    diagnoseInflight = runDiagnose(guildId, eventId, channelId).finally(() => {
      diagnoseInflight = null;
    });
  }
  diagnoseCache = { result: await diagnoseInflight, at: Date.now(), key };
  return diagnoseCache.result;
}

async function runDiagnose(guildId = null, eventId = null, channelId = null) {
  const base = { demo: isDemoMode, configuredGuildId: config.guildId };

  if (isDemoMode) {
    return { ...base, ok: true, reason: 'demo', guilds: [] };
  }

  const target = guildId ?? config.guildId;
  const headers = {
    Authorization: `Bot ${config.discordToken}`,
    'User-Agent': config.userAgent,
    Accept: 'application/json',
  };
  const get = async (path) => {
    const response = await fetch(`${config.apiBase}${path}`, { headers });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  const me = await get('/users/@me');
  if (me.status !== 200) {
    return {
      ...base,
      ok: false,
      reason: 'token-invalid',
      detail: `Token abgelehnt (HTTP ${me.status}).`,
      guilds: [],
    };
  }

  const guildsResult = await get('/users/@me/guilds?limit=200&with_counts=false');
  const guilds = Array.isArray(guildsResult.body)
    ? guildsResult.body.map((g) => ({ id: g.id, name: g.name, icon: g.icon }))
    : [];

  // Kanalprüfung: Discord blendet Events aus, deren Kanal der Bot nicht sehen
  // darf. Damit lässt sich nach einer Rechteänderung nachsehen, ohne raten.
  if (channelId) {
    const channel = await get(`/channels/${channelId}`);
    return {
      ...base,
      ok: channel.status === 200,
      checkedChannelId: channelId,
      channelStatus: channel.status,
      channel:
        channel.status === 200
          ? {
              name: channel.body.name,
              type: channel.body.type,
              parent: channel.body.parent_id ?? null,
              position: channel.body.position ?? null,
            }
          : null,
      guilds,
      reason: channel.status === 200 ? 'ok' : `channel-${channel.status}`,
    };
  }

  const events = eventId
    ? await get(`/guilds/${target}/scheduled-events/${eventId}?with_user_count=true`)
    : await get(`/guilds/${target}/scheduled-events?with_user_count=true`);
  const accessible = events.status === 200;
  const rateLimited = events.status === 429;

  /** Was der Kalender aus einer rohen Discord-Zeile macht. */
  const summarize = (event) =>
    event && {
      id: event.id,
      name: event.name,
      status: event.status,
      start: event.scheduled_start_time,
      end: event.scheduled_end_time,
      entityType: event.entity_type,
      userCount: event.user_count,
      recurrence: event.recurrence_rule ?? null,
    };

  return {
    ...base,
    checkedGuildId: target,
    checkedEventId: eventId,
    ok: accessible,
    bot: { id: me.body.id, username: me.body.username, avatar: me.body.avatar },
    inviteUrl:
      'https://discord.com/api/oauth2/authorize' +
      `?client_id=${me.body.id}` +
      '&scope=bot&permissions=1024',
    guilds,
    configuredGuildInList: guilds.some((g) => g.id === target),
    eventsStatus: events.status,
    eventCount: Array.isArray(events.body) ? events.body.length : null,
    // Was Discord tatsächlich geliefert hat. Ohne das ist die häufigste
    // Frage nicht beantwortbar: fehlt ein Raid, weil Discord ihn nicht
    // schickt, oder weil die Woche ihn verwirft?
    events: eventId
      ? summarize(events.body) && [summarize(events.body)]
      : Array.isArray(events.body)
        ? events.body.map(summarize)
        : null,
    reason: accessible
      ? 'ok'
      : events.status === 403
        ? 'missing-access'
        : events.status === 404
          ? 'unknown-guild'
          : rateLimited
            ? 'rate-limited'
            : 'api-error',
    detail: accessible
      ? null
      : rateLimited
        ? 'Kurzzeitig zu viele Anfragen – in einigen Sekunden erneut prüfen.'
        : `Events-Abfrage ergab HTTP ${events.status}.`,
  };
}
