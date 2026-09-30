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

  return { kind: 'unknown', title: 'Discord-API-Fehler', hint: message };
}

/** Prüft Token, konfigurierte Guild und Mitgliedschaften – für die Fehlersuche. */
export async function diagnose() {
  const base = { demo: isDemoMode, configuredGuildId: config.guildId };

  if (isDemoMode) {
    return { ...base, ok: true, reason: 'demo', guilds: [] };
  }

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

  const events = await get(
    `/guilds/${config.guildId}/scheduled-events?with_user_count=true`,
  );
  const accessible = events.status === 200;

  return {
    ...base,
    ok: accessible,
    bot: { id: me.body.id, username: me.body.username, avatar: me.body.avatar },
    inviteUrl:
      'https://discord.com/api/oauth2/authorize' +
      `?client_id=${me.body.id}` +
      '&scope=bot&permissions=1024',
    guilds,
    configuredGuildInList: guilds.some((g) => g.id === config.guildId),
    eventsStatus: events.status,
    eventCount: Array.isArray(events.body) ? events.body.length : null,
    reason: accessible
      ? events.status === 200
        ? 'ok'
        : 'unknown'
      : events.status === 403
        ? 'missing-access'
        : events.status === 404
          ? 'unknown-guild'
          : 'api-error',
    detail: accessible ? null : `Events-Abfrage ergab HTTP ${events.status}.`,
  };
}
