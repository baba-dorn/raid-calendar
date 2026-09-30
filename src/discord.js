const STATUS_NAMES = { 1: 'SCHEDULED', 2: 'ACTIVE', 3: 'COMPLETED', 4: 'CANCELED' };
const ENTITY_NAMES = { 1: 'STAGE_INSTANCE', 2: 'VOICE', 3: 'EXTERNAL' };

const CDN = 'https://cdn.discordapp.com';

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Abgebrochen', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * GET /guilds/{guild.id}/scheduled-events
 * Respektiert 429-Antworten über `retry_after`.
 */
export async function fetchGuildEvents({ token, guildId, apiBase, userAgent, signal }) {
  const url = `${apiBase}/guilds/${encodeURIComponent(guildId)}/scheduled-events?with_user_count=true`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      signal,
      headers: {
        Authorization: `Bot ${token}`,
        'User-Agent': userAgent,
        Accept: 'application/json',
      },
    });

    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      const waitMs = Math.min((Number(body.retry_after) || 1) * 1000 + 100, 10_000);
      await sleep(waitMs, signal);
      continue;
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Discord API antwortete ${response.status}: ${detail || response.statusText}`);
    }

    return await response.json();
  }

  throw new Error('Discord API: Rate-Limit nach drei Versuchen ausgeschöpft.');
}

/** Guild-Metadaten für Kopfzeile und Banner. */
export async function fetchGuild({ token, guildId, apiBase, userAgent, signal }) {
  const response = await fetch(`${apiBase}/guilds/${encodeURIComponent(guildId)}?with_counts=false`, {
    signal,
    headers: {
      Authorization: `Bot ${token}`,
      'User-Agent': userAgent,
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  return await response.json();
}

/** Rohes Discord-Event -> schlankes Format für die Wochenansicht. */
export function normalizeEvent(raw, { guildId, defaultDurationMinutes }) {
  const start = new Date(raw.scheduled_start_time);
  const hasEnd = Boolean(raw.scheduled_end_time);
  const end = hasEnd
    ? new Date(raw.scheduled_end_time)
    : new Date(start.getTime() + defaultDurationMinutes * 60_000);

  const image = raw.image
    ? `${CDN}/guild-events/${raw.id}/${raw.image}.png?size=640`
    : null;

  /** Kleine Variante für das Thumbnail im Kalenderblock (ca. 15 KB statt 250 KB). */
  const imageSmall = raw.image
    ? `${CDN}/guild-events/${raw.id}/${raw.image}.png?size=160`
    : null;

  return {
    id: raw.id,
    guildId: raw.guild_id ?? guildId,
    name: raw.name,
    description: raw.description || null,
    start: start.toISOString(),
    end: end.toISOString(),
    endIsEstimated: !hasEnd,
    status: STATUS_NAMES[raw.status] ?? String(raw.status),
    entityType: ENTITY_NAMES[raw.entity_type] ?? String(raw.entity_type),
    channelId: raw.channel_id ?? null,
    location: raw.entity_metadata?.location ?? null,
    image,
    imageSmall,
    userCount: Number.isInteger(raw.user_count) ? raw.user_count : null,
    url: `https://discord.com/events/${guildId}/${raw.id}`,
    channelUrl: raw.channel_id ? `https://discord.com/channels/${guildId}/${raw.channel_id}` : null,
    recurrence: raw.recurrence_rule ?? null,
  };
}
