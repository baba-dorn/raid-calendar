const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const formatterCache = new Map();

function partsFormatter(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wanduhr-Felder einer UTC-Instanz in der Zeitzone `timeZone`. */
export function zonedParts(date, timeZone) {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const out = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    // Manche Engines liefern für Mitternacht "24" – auf 0 normalisieren.
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  };
}

function offsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Wanduhr-Zeit -> UTC-Instanz. Zwei Durchläufe lösen den Fall, dass die
 * erste Annahme auf eine Sommerzeit-Umstellung fiel.
 */
export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = guess - offsetMs(new Date(guess), timeZone);
  const secondPass = guess - offsetMs(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

/* --- Rechnen mit reinen Kalendertagen (tagesnummer seit 1970-01-01) --- */

export const toDayNumber = (year, month, day) =>
  Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);

export function fromDayNumber(dayNumber) {
  const d = new Date(dayNumber * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = Sonntag … 6 = Samstag. Tag 0 der Epoche war ein Donnerstag. */
export const dayOfWeek = (dayNumber) => (((dayNumber + 4) % 7) + 7) % 7;

export const dayOfMonth = (dayNumber) => fromDayNumber(dayNumber).day;

export function dateKey(dayNumber) {
  const { year, month, day } = fromDayNumber(dayNumber);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (fromDayNumber(toDayNumber(year, month, day)).day !== day) return null;
  return toDayNumber(year, month, day);
}

/** Heute als Tagesnummer in `timeZone`. */
export function todayDayNumber(timeZone, now = new Date()) {
  const p = zonedParts(now, timeZone);
  return toDayNumber(p.year, p.month, p.day);
}

/** Verschiebt einen Tagesnummer auf den Wochenbeginn. */
export function alignToWeekStart(dayNumber, weekStartsOn) {
  const offset = (dayOfWeek(dayNumber) - weekStartsOn + 7) % 7;
  return dayNumber - offset;
}

export const dayKeyOf = (date, timeZone) => {
  const p = zonedParts(date, timeZone);
  return dateKey(toDayNumber(p.year, p.month, p.day));
};

export { MINUTE_MS, DAY_MS };
