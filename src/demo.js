import { alignToWeekStart, fromDayNumber, todayDayNumber, zonedTimeToUtc } from './timezone.js';

const EVERY_DAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** Discord-Wochentagsnummern: 0 = Sonntag. */
const MONDAY = 1;
const TUESDAY = 2;
const FRIDAY = 5;
const SATURDAY = 6;
const SUNDAY = 0;

/**
 * Beispieldaten, damit die Wochenübersicht ohne Bot-Token startet.
 * Gleiche Struktur wie `normalizeEvent` aus discord.js.
 * Verankert am Montag der aktuellen Woche, damit das Layout planbar bleibt.
 */
export function buildDemoEvents(guildId, timeZone, now = new Date()) {
  const weekStart = alignToWeekStart(todayDayNumber(timeZone, now), 1);

  /** Wochentag + Uhrzeit in der Anzeigezeitzone -> ISO-String. */
  const at = (weekday, hour, minute = 0) => {
    const { year, month, day } = fromDayNumber(weekStart + ((weekday + 6) % 7));
    return zonedTimeToUtc({ year, month, day, hour, minute }, timeZone).toISOString();
  };

  const make = (overrides) => ({
    id: `demo-${overrides.slug ?? overrides.name}`,
    guildId,
    status: 'SCHEDULED',
    entityType: 'VOICE',
    channelId: null,
    channelUrl: null,
    location: null,
    image: null,
    imageSmall: null,
    userCount: null,
    endIsEstimated: false,
    recurrence: null,
    description: null,
    ...overrides,
  });

  return [
    make({
      slug: 'public',
      name: '🌙 Public mit Dorn',
      description: 'Zusammenlegen, Boss-Routen üben, nette Leute kennenlernen. Offen für alle.',
      start: at(MONDAY, 19),
      end: at(MONDAY, 22, 30),
      userCount: 12,
      recurrence: { start: at(MONDAY, 19), frequency: 3, interval: 1, by_weekday: EVERY_DAY },
    }),
    make({
      slug: 'spaet',
      name: '🌀 Spätschicht mit Meow',
      description: 'Für die Nachtschicht. Kein Druck, einfach mithalten.',
      start: at(MONDAY, 23),
      end: at(TUESDAY, 1, 30),
      userCount: 4,
      entityType: 'STAGE_INSTANCE',
      recurrence: { start: at(MONDAY, 23), frequency: 3, interval: 1, by_weekday: EVERY_DAY },
    }),
    make({
      slug: 'kommi',
      name: '☀️ Kommi-Wechsel-Dich',
      description: 'Resettraid mit wechselnden Commander:innen.',
      start: at(FRIDAY, 20),
      end: at(FRIDAY, 23, 30),
      userCount: 20,
      recurrence: { start: at(FRIDAY, 20), frequency: 2, interval: 1, by_weekday: ['FR'] },
    }),
    make({
      slug: 'starter',
      name: '🗡️ Oops Starter-Session',
      description: 'Einweisung für neue Mitglieder – nach dem Relink.',
      start: at(SATURDAY, 17),
      end: at(SATURDAY, 18, 30),
      userCount: 7,
    }),
    make({
      slug: 'fightclub',
      name: '⚔️ Oops Fightclub',
      description: 'Nur mit Eventbuilds. Ankündigung läuft im Discord-Kanal.',
      start: at(SATURDAY, 18, 30),
      end: at(SATURDAY, 21),
      userCount: 9,
    }),
    make({
      slug: 'coffetag',
      name: '☕ Coffetag mit Steini',
      description: 'Langsamer Start, Kaffee in der Hand, Plaudit inklusive.',
      start: at(SUNDAY, 10),
      end: at(SUNDAY, 12),
      userCount: 5,
      entityType: 'EXTERNAL',
      location: 'Discord-Audio #coffeetalk',
    }),
  ];
}

export const DEMO_GUILD = {
  id: 'demo',
  name: 'OOPS',
  icon: null,
  banner: null,
  demo: true,
};
