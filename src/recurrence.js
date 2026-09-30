import {
  dayOfMonth,
  dayOfWeek,
  fromDayNumber,
  toDayNumber,
  zonedParts,
  zonedTimeToUtc,
} from './timezone.js';

/**
 * Zwei verschiedene Wochentag-Konventionen – nicht verwechseln:
 * - `JS_DOW` ist der Index aus `dayOfWeek()` (JavaScript, 0 = Sonntag).
 * - `DISCORD_DOW` ist die Nummerierung in `by_weekday` / `by_n_weekday.day`
 *   aus der Discord-API, die sich an python-dateutil anlehnt (0 = Montag).
 */
const JS_DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DISCORD_DOW = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const YEARLY = 0;
const MONTHLY = 1;
const WEEKLY = 2;
const DAILY = 3;

/** Schutz gegen pathologische Regeln – reicht für rund 10 Jahre Voraus. */
const MAX_SCAN_DAYS = 3700;

const monthsBetween = (a, b) => (b.year - a.year) * 12 + (b.month - a.month);

/** Akzeptiert Discord-Kürzel ("FR") und Zahlen (4 = Freitag, 0 = Montag). */
export function normalizeWeekdays(values) {
  return (values ?? [])
    .map((value) =>
      typeof value === 'number'
        ? DISCORD_DOW[((value % 7) + 7) % 7]
        : String(value).toUpperCase(),
    )
    .filter((code) => JS_DOW.includes(code));
}

/** Kompakte Beschreibung der Regel für die Oberfläche. */
export function summarizeRecurrence(rule) {
  if (!rule) return null;
  return {
    frequency: rule.frequency,
    interval: rule.interval || 1,
    byWeekday: normalizeWeekdays(rule.by_weekday),
    byNWeekday: rule.by_n_weekday?.length
      ? { n: rule.by_n_weekday[0].n, day: normalizeWeekdays([rule.by_n_weekday[0].day])[0] }
      : null,
    byMonthDay: rule.by_month_day ?? null,
    byMonth: rule.by_month ?? null,
  };
}

/**
 * Prüft, ob der Kalendertag `dayNumber` zur Wiederholungsregel passt.
 * `ruleStart` sind die Wanduhr-Felder des Regelbeginns.
 */
function matchesRule(rule, dayNumber, ruleStart, ruleStartDay) {
  if (dayNumber < ruleStartDay) return false;

  const { year, month, day } = fromDayNumber(dayNumber);
  const interval = rule.interval || 1;
  const byWeekday = normalizeWeekdays(rule.by_weekday);

  switch (rule.frequency) {
    case WEEKLY: {
      if (byWeekday.length && !byWeekday.includes(JS_DOW[dayOfWeek(dayNumber)])) return false;
      const weeks = Math.floor((dayNumber - ruleStartDay) / 7);
      return weeks % interval === 0;
    }

    case DAILY: {
      if ((dayNumber - ruleStartDay) % interval !== 0) return false;
      return !byWeekday.length || byWeekday.includes(JS_DOW[dayOfWeek(dayNumber)]);
    }

    case MONTHLY: {
      const months = monthsBetween(ruleStart, { year, month, day });
      if (months < 0 || months % interval !== 0) return false;

      if (rule.by_n_weekday?.length) {
        const { n: nth, day: targetDay } = rule.by_n_weekday[0];
        const codes = normalizeWeekdays([targetDay]);
        if (!codes.includes(JS_DOW[dayOfWeek(dayNumber)])) return false;
        return Math.ceil(day / 7) === nth;
      }
      if (rule.by_month_day?.length) return rule.by_month_day.includes(day);
      return day === ruleStart.day;
    }

    case YEARLY: {
      const years = year - ruleStart.year;
      if (years < 0 || years % interval !== 0) return false;
      const months = rule.by_month?.length ? rule.by_month : [ruleStart.month];
      const days = rule.by_month_day?.length ? rule.by_month_day : [ruleStart.day];
      return months.includes(month) && days.includes(day);
    }

    default:
      return false;
  }
}

/**
 * Zählt, wie viele Termine der Regel bis einschließlich `dayNumber`
 * stattgefunden haben. Wird nur bei `count`/`end` gebraucht, die
 * Discord-Clients gar nicht setzen dürfen.
 */
function countMatchesUpTo(rule, ruleStart, ruleStartDay, dayNumber, timeZone, ruleEnd) {
  let count = 0;
  for (let day = ruleStartDay; day <= dayNumber; day += 1) {
    if (!matchesRule(rule, day, ruleStart, ruleStartDay)) continue;
    const { year, month, day: dom } = fromDayNumber(day);
    const start = zonedTimeToUtc(
      { year, month, day: dom, hour: ruleStart.hour, minute: ruleStart.minute },
      timeZone,
    );
    if (ruleEnd && start > ruleEnd) break;
    count += 1;
  }
  return count;
}

/**
 * Rechnet ein Event für ein sichtbares Fenster in einzelne Termine auf.
 *
 * @param event        normalisiertes Event (siehe discord.js)
 * @param options.timeZone    Zeitzone der Anzeige
 * @param options.fromDay     Tagesnummer des Fensteranfangs (inklusiv)
 * @param options.toDay       Tagesnummer des Fensterendes (inklusiv)
 * @returns Array<{ start: Date, end: Date }>
 */
export function expandEvent(event, { timeZone, fromDay, toDay }) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const rule = event.recurrence;

  if (!rule) return [{ start, end }];

  const base = zonedParts(start, timeZone);
  const ruleStart = rule.start ? zonedParts(new Date(rule.start), timeZone) : base;
  const ruleStartDay = toDayNumber(ruleStart.year, ruleStart.month, ruleStart.day);
  const durationMs = end.getTime() - start.getTime();

  const scanFrom = Math.max(ruleStartDay, fromDay - 1);
  const scanTo = Math.min(toDay + 1, ruleStartDay + MAX_SCAN_DAYS);
  const countLimit = Number.isInteger(rule.count) ? rule.count : null;
  const ruleEnd = rule.end ? new Date(rule.end) : null;

  const occurrences = [];
  for (let day = scanFrom; day <= scanTo; day += 1) {
    if (!matchesRule(rule, day, ruleStart, ruleStartDay)) continue;

    const { year, month, day: dom } = fromDayNumber(day);
    const occurrenceStart = zonedTimeToUtc(
      { year, month, day: dom, hour: base.hour, minute: base.minute },
      timeZone,
    );

    if (ruleEnd && occurrenceStart > ruleEnd) break;
    if (countLimit !== null) {
      const seen = countMatchesUpTo(
        rule, ruleStart, ruleStartDay, day, timeZone, ruleEnd,
      );
      if (seen > countLimit) break;
    }

    occurrences.push({ start: occurrenceStart, end: new Date(occurrenceStart.getTime() + durationMs) });
  }

  return occurrences;
}
