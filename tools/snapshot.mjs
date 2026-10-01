/**
 * Schreibt die Wochen als statische Dateien – für GitHub Pages.
 *
 *   node tools/snapshot.mjs
 *
 * Pages führt kein Node aus, es kann nur Dateien ausliefern. `/api/week` gibt
 * es dort nicht, also wird dieselbe Pipeline, die auch der Server benutzt,
 * einmal vorab gelaufen und das Ergebnis abgelegt:
 *
 *   public/data/<wochenstart>.json   eine Datei je Woche, Datum als Name
 *   public/data/latest.json          die Woche, die heute gilt
 *
 * `app.js` fragt diese Dateien zuerst ab und fällt auf `/api/week` zurück –
 * dieselbe `public/`-Mappe läuft also lokal mit und auf Pages ohne Server.
 *
 * Umgebung:
 *   DISCORD_TOKEN, DISCORD_GUILD_ID   wie immer, sonst Demo-Daten
 *   TIMEZONE                          Zeitzone der Schnitte (Vorgabe Europe/Berlin)
 *   WEEKS_BACK, WEEKS_FORWARD         wie viele Wochen rückwärts/vorwärts
 *   SNAPSHOT_OUT                      Zielordner, Vorgabe public/data
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWeek } from '../src/calendar.js';
import { config, isDemoMode } from '../src/config.js';
import { explainError } from '../src/diagnose.js';
import { applyLanes } from '../src/lanes.js';
import { getEvents } from '../src/source.js';
import { dateKey, todayDayNumber, alignToWeekStart } from '../src/timezone.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.env.SNAPSHOT_OUT ?? join(HERE, '..', 'public', 'data'));
const BACK = Number.parseInt(process.env.WEEKS_BACK ?? '2', 10);
const FORWARD = Number.parseInt(process.env.WEEKS_FORWARD ?? '8', 10);

const int = (value, fallback) => (Number.isFinite(Number.parseInt(value, 10)) ? Number.parseInt(value, 10) : fallback);

/**
 * Wie der Server, nur ohne HTTP dazwischen.
 *
 * `__fetchedAt`, `__stale` und `__error` sind Notizen, die ich mir an das
 * Wochenergebnis hänge, um sie nach `meta` durchreichen zu können. Ein
 * `{...week}` würde sie mitschleppen – sie standen dann als `__fetchedAt` und
 * `__error` mitten in der veröffentlichten Datei, wo niemand sie braucht und
 * niemand sie zu deuten weiß. Sie kommen einzeln und nicht mit dem Rest.
 */
function payloadFor(week) {
  const { lanes, source } = applyLanes(week);
  const { __fetchedAt, __stale, __error, ...rest } = week;
  return {
    ...rest,
    lanes,
    meta: {
      source: isDemoMode ? 'demo' : 'discord',
      hourHeight: config.hourHeight,
      lanes: source,
      fetchedAt: new Date(__fetchedAt).toISOString(),
      stale: Boolean(__stale),
      error: __error ?? null,
      problem: explainError(__error),
      static: true,
    },
  };
}

async function main() {
  const { events, guild, fetchedAt, stale, error } = await getEvents();

  if (error) {
    // Nicht hart abbrechen: Eine halbaktuelle Seite ist besser als gar keine,
    // und das Frontend zeigt `meta.problem` dann selbst an. Nur wenn gar
    // nichts ankam, ist der Lauf sinnlos.
    console.warn(`Hinweis von der Datenquelle: ${error}`);
  }

  const now = new Date();
  const today = todayDayNumber(config.timezone, now);
  const currentStart = alignToWeekStart(today, config.weekStartsOn);
  const back = int(BACK, 2);
  const forward = int(FORWARD, 8);

  mkdirSync(OUT, { recursive: true });
  const written = [];
  let latest = null;

  for (let step = -back; step <= forward; step += 1) {
    const week = buildWeek({
      events,
      guild,
      requestedStart: dateKey(currentStart + step * 7),
      timezone: config.timezone,
      weekStartsOn: config.weekStartsOn,
      now,
    });
    week.__fetchedAt = fetchedAt;
    week.__stale = stale;
    week.__error = error;

    const body = payloadFor(week);
    const name = `${week.weekStart}.json`;
    writeFileSync(join(OUT, name), `${JSON.stringify(body, null, 2)}\n`);
    written.push({ name, termin: week.days.reduce((sum, day) => sum + day.occurrences.length, 0) });

    // `latest` zeigt auf die Woche, in der wir gerade sind – und wenn der Lauf
    // weit vor oder nach einem Wochenwechsel passiert, auf die nächste mit
    // Terminen. Sonst landet man beim Öffnen in einer leeren Woche.
    if (step <= 0) latest = body;
  }

  // Eine Woche ohne einen einzigen Termin ist für einen Blattbesucher wertlos;
  // dann rutscht `latest` vor, bis etwas zu sehen ist.
  if (!latest.days.some((day) => day.occurrences.length > 0)) {
    const date = new Date(`${latest.weekStart}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 7);
    const next = buildWeek({
      events,
      guild,
      requestedStart: dateKey(currentStart + 7),
      timezone: config.timezone,
      weekStartsOn: config.weekStartsOn,
      now,
    });
    next.__fetchedAt = fetchedAt;
    next.__stale = stale;
    next.__error = error;
    latest = payloadFor(next);
  }

  writeFileSync(join(OUT, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);

  // Das Verzeichnis, in dem die Seite blättern darf. Ohne diese Datei wüsste
  // das Frontend nicht, wo links und rechts aufhören, und liefe in einen 404.
  writeFileSync(
    join(OUT, 'index.json'),
    `${JSON.stringify(
      {
        weeks: written.map((entry) => entry.name.replace(/\.json$/, '')),
        latest: latest.weekStart,
        timezone: config.timezone,
        generatedAt: new Date(fetchedAt).toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  const quelle = isDemoMode ? 'DEMO' : 'discord';
  console.log(`Quelle: ${quelle}, Zeitzone: ${config.timezone}`);
  console.log(`${written.length} Wochen nach ${OUT}`);
  for (const entry of written) {
    console.log(`  ${entry.name}  ${entry.termin} Termine`);
  }
  console.log(`latest.json -> ${latest.weekStart}`);
  if (isDemoMode) {
    console.warn('Achtung: ohne DISCORD_TOKEN und DISCORD_GUILD_ID wurden Demo-Daten geschrieben.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
