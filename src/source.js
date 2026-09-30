import { config, isDemoMode } from './config.js';
import { buildDemoEvents, DEMO_GUILD } from './demo.js';
import { fetchGuild, fetchGuildEvents, normalizeEvent } from './discord.js';

const CDN = 'https://cdn.discordapp.com';

let cache = { events: null, guild: null, fetchedAt: 0 };
let inflight = null;

function guildIconUrl(guild) {
  return guild?.icon ? `${CDN}/icons/${guild.id}/${guild.icon}.png?size=256` : null;
}

function guildBannerUrl(guild) {
  return guild?.banner ? `${CDN}/banners/${guild.id}/${guild.banner}.png?size=1024` : null;
}

async function loadOnce() {
  if (isDemoMode) {
    const events = buildDemoEvents(DEMO_GUILD.id, config.timezone);
    return { events, guild: DEMO_GUILD, fetchedAt: Date.now(), error: null };
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

    const events = rawEvents
      .filter((raw) => raw.status === 1 || raw.status === 2)
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
      error: null,
    };
  } catch (error) {
    // Letzter Stand bleibt nutzbar, das Frontend markiert ihn als veraltet.
    if (cache.events) {
      return { ...cache, stale: true, error: error.message };
    }
    return {
      events: [],
      guild: {
        id: config.guildId,
        name: `Guild ${config.guildId}`,
        icon: null,
        banner: null,
        memberCount: null,
        demo: false,
      },
      fetchedAt: Date.now(),
      stale: false,
      error: error.message,
    };
  }
}

/** Events mit einfachem TTL-Cache; parallele Aufrufe teilen sich einen Abruf. */
export async function getEvents() {
  if (cache.events && Date.now() - cache.fetchedAt < config.cacheTtlMs && !cache.error) {
    return { ...cache, cached: true };
  }
  if (!inflight) {
    inflight = loadOnce().finally(() => {
      inflight = null;
    });
  }
  const result = await inflight;
  cache = { events: result.events, guild: result.guild, fetchedAt: result.fetchedAt };
  return { ...result, cached: false };
}
