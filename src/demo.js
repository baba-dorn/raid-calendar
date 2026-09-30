import { alignToWeekStart, fromDayNumber, todayDayNumber, zonedTimeToUtc } from './timezone.js';

const EVERY_DAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** Discord-Wochentagsnummern: 0 = Sonntag. */
const MONDAY = 1;
const WEDNESDAY = 3;
const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;
const SUNDAY = 0;

/**
 * Beispieldaten, damit die Wochenübersicht ohne Bot-Token startet.
 * Gleiche Struktur wie `normalizeEvent` aus discord.js.
 * Verankert am Montag der aktuellen Woche, damit das Layout planbar bleibt.
 *
 * Alles steht hier an seiner echten Uhrzeit – die Wochenansicht hat eine
 * Zeitachse, da wird nichts überschrieben oder zusammengefasst:
 *
 *   – eine tägliche Serie (Public) als Wiederholung, sie belegt den Slot
 *   – Spätschicht bewusst **ohne** Event, damit der Slot aus `lanes.json`
 *     sichtbar bleibt; dazu ein abgesagter Termin auf demselben Fenster
 *   – eine einmalige Veranstaltung am Donnerstag, mitten im Public-Fenster
 *   – ein Reset-Raid am Freitag mit Bonusrunde davor
 *   – drei Termine ohne Slot
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
      slug: 'ruhetag',
      name: '😴 Ruhetag',
      description: 'Meow ist krank – die Nachtschicht faellt aus.',
      status: 'CANCELED',
      start: at(WEDNESDAY, 23),
      end: at(THURSDAY, 1, 30),
    }),

    make({
      slug: 'kommi',
      name: '☀️ Kommi-Wechsel-Dich',
      description: 'Resettraid mit wechselnden Commander:innen.',
      start: at(FRIDAY, 20),
      end: at(FRIDAY, 23, 30),
      userCount: 20,
      // So sieht Discord die meisten Raids: ohne Endzeit. Die Endzeit holt
      // sich die Regel aus `lanes.json`, das „≈“ sagt, dass es eine Annahme ist.
      endIsEstimated: true,
    }),

    make({
      slug: 'reset-bonus',
      name: '⚡ Reset-Bonusrunde',
      description: 'Kurze Runde vor dem Reset, wer Zeit hat.',
      start: at(FRIDAY, 18),
      end: at(FRIDAY, 19),
      userCount: 8,
    }),

    make({
      slug: 'starter',
      name: '🗡️ Oops Starter-Session',
      description: 'Einweisung für neue Mitglieder – nach dem Relink.',
      start: at(SATURDAY, 17),
      end: at(SATURDAY, 18, 30),
      userCount: 7,
      // Endzeit fehlt und es gibt keine passende Regel: hier bleibt nur die
      // pauschale Annahme aus `DEFAULT_DURATION_MINUTES`.
      endIsEstimated: true,
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