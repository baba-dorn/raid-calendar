const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

import { loadEnvFile, ROOT } from './env.js';

loadEnvFile();

export const config = {
  root: ROOT,
  port: int(process.env.PORT, 3000),
  host: process.env.HOST?.trim() || '127.0.0.1',

  discordToken: process.env.DISCORD_TOKEN?.trim() || null,
  guildId: process.env.DISCORD_GUILD_ID?.trim() || null,

  /** Zeitzone, in der die Wochenübersicht gerechnet und angezeigt wird. */
  timezone: process.env.TIMEZONE?.trim() || 'Europe/Berlin',
  /** 1 = Montag, 0 = Sonntag. */
  weekStartsOn: int(process.env.WEEK_STARTS_ON, 1),
  /** Anzeigeminuten je Stunde im Raster. */
  hourHeight: int(process.env.HOUR_HEIGHT, 46),
  /** Fallback-Dauer für Events ohne `scheduled_end_time`. */
  defaultDurationMinutes: int(process.env.DEFAULT_DURATION_MINUTES, 120),
  /** Wie lange die Discord-Antwort serverseitig gecacht wird. */
  cacheTtlMs: int(process.env.CACHE_TTL_MS, 60_000),

  apiBase: 'https://discord.com/api/v10',
  userAgent:
    'DiscordBot (https://github.com/local/discord-week-calendar, 1.0.0)',
};

/** Ohne Token oder ohne Guild-ID laufen wir mit Demo-Daten. */
export const isDemoMode = !config.discordToken || !config.guildId;
