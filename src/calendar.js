import { expandEvent, summarizeRecurrence } from './recurrence.js';
import {
  alignToWeekStart,
  dateKey,
  dayOfWeek,
  dayKeyOf,
  isValidTimeZone,
  parseDateKey,
  toDayNumber,
  todayDayNumber,
  zonedParts,
} from './timezone.js';

const MINUTES_PER_DAY = 1440;

export function resolveTimeZone(requested, fallback) {
  const candidate = String(requested ?? '').trim();
  if (candidate && isValidTimeZone(candidate)) return candidate;
  return fallback;
}

/**
 * Baut aus der Event-Liste die Daten für genau eine Woche.
 * Termine werden bereits in Wanduhr-Zeit der Zielzeitzone zerlegt,
 * damit das Frontend nichts rechnen muss.
 */
export function buildWeek({ events, guild, requestedStart, timezone, weekStartsOn, now = new Date() }) {
  const today = todayDayNumber(timezone, now);
  const parsedStart = parseDateKey(requestedStart);
  const fromDay = alignToWeekStart(parsedStart ?? today, weekStartsOn);
  const toDay = fromDay + 6;

  const days = Array.from({ length: 7 }, (_, index) => {
    const dayNumber = fromDay + index;
    return {
      index,
      dayNumber,
      date: dateKey(dayNumber),
      weekday: dayOfWeek(dayNumber),
      isToday: dayNumber === today,
      occurrences: [],
    };
  });

  const seriesCount = new Map();

  for (const event of events) {
    for (const occurrence of expandEvent(event, { timeZone: timezone, fromDay, toDay })) {
      const parts = zonedParts(occurrence.start, timezone);
      const dayNumber = toDayNumber(parts.year, parts.month, parts.day);
      if (dayNumber < fromDay || dayNumber > toDay) continue;

      const endParts = zonedParts(occurrence.end, timezone);
      const startMinute = parts.hour * 60 + parts.minute;
      const rawEndMinute = endParts.hour * 60 + endParts.minute;
      const spansNextDay = rawEndMinute < startMinute;

      seriesCount.set(event.id, (seriesCount.get(event.id) ?? 0) + 1);

      days[dayNumber - fromDay].occurrences.push({
        key: `${event.id}@${occurrence.start.toISOString()}`,
        eventId: event.id,
        start: occurrence.start.toISOString(),
        end: occurrence.end.toISOString(),
        startMinute,
        /** Anzeigeende im Tag; über Mitternacht hinweg 1440. */
        endMinute: spansNextDay ? MINUTES_PER_DAY : Math.min(rawEndMinute, MINUTES_PER_DAY),
        /** Tatsächliche Wanduhr-Minuten des Endes – für die Beschriftung. */
        endClockMinute: rawEndMinute,
        spansNextDay,
        name: event.name,
        description: event.description,
        status: event.status,
        entityType: event.entityType,
        location: event.location,
        image: event.image,
        imageSmall: event.imageSmall,
        userCount: event.userCount,
        url: event.url,
        channelUrl: event.channelUrl,
        endIsEstimated: event.endIsEstimated,
        recurring: Boolean(event.recurrence),
        recurrence: summarizeRecurrence(event.recurrence),
      });
    }
  }

  for (const day of days) {
    day.occurrences.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  }

  return {
    timezone,
    weekStartsOn,
    weekStart: dateKey(fromDay),
    weekEnd: dateKey(toDay),
    today: dateKey(today),
    generatedAt: now.toISOString(),
    guild,
    /** Tagesanzahl je Event-Serie – der Client nutzt das für durchgehende Blöcke. */
    seriesLength: Object.fromEntries(seriesCount),
    days,
  };
}

export { dateKey, dayKeyOf };
