import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { ROOT, loadEnvFile } from './env.js';

loadEnvFile();

/** Editor schreiben ein BOM voran; JSON.parse stolpert darueber. */
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const MINUTES_PER_DAY = 1440;

/** 0 = Sonntag … 6 = Samstag – dieselbe Nummerierung wie `dayOfWeek()` in timezone.js. */
const JS_DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const ALL_DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * Discord kennt keine Spuren. Deshalb liest die App sie aus dem Eventnamen –
 * genau die Klassifikation, die ohne App-Zuordnung niemand sieht, wenn sie
 * nur im Kalender auftaucht. Wörterbuch statt Regex: `null` = spurenlos.
 */
const TAG_ALIASES = {
  PUBLIC: 'public',
  LATE: 'late',
  SPAET: 'late',
  SPAETSCHICHT: 'late',
  NACHT: 'late',
  RESET: 'reset',
  KOMMI: 'reset',
  SPECIAL: null,
  ZUSATZ: null,
  EXTRA: null,
};

/** Vorgabe, falls keine `lanes.json` neben dem Server liegt. */
const DEFAULT_CONFIG = {
  lanes: [
    {
      id: 'public',
      label: 'Public',
      host: 'mit Dorn',
      glyph: '🌙',
      accent: '#8fdc4a',
      match: ['public'],
      baseline: { days: ALL_DAY_CODES, start: '19:00', end: '22:30' },
    },
    {
      id: 'late',
      label: 'Spätschicht',
      host: 'mit Meow',
      glyph: '🌀',
      accent: '#b06bff',
      match: ['spätschicht', 'spaetschicht', 'nachtschicht', '\\blate\\b'],
      baseline: { days: ALL_DAY_CODES, start: '23:00', end: '01:30' },
    },
    {
      id: 'reset',
      label: 'Reset',
      host: 'mit wechselnden Commander:innen',
      glyph: '☀️',
      accent: '#f0b429',
      match: ['reset', 'kommi'],
      baseline: { days: ['FR'], start: '20:00', end: '23:30' },
    },
  ],
  assignments: [],
};

/* ------------------------------------------------------------------ *
 * Konfiguration
 * ------------------------------------------------------------------ */

/** Fehlertolerante Regex-Erzeugung: ein Tippfehler darf nichts zerlegen. */
function toMatcher(value) {
  const source = String(value);
  try {
    return new RegExp(source, 'i');
  } catch {
    return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}

function clockToMinutes(value, fallback = null) {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 48 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

function normalizeBaseline(raw) {
  if (!raw) return null;

  const startMinute = clockToMinutes(raw.start);
  const endMinute = clockToMinutes(raw.end, startMinute === null ? null : startMinute + 180);
  if (startMinute === null || endMinute === null) return null;

  const days = (Array.isArray(raw.days) ? raw.days : ALL_DAY_CODES)
    .map((code) => JS_DOW.indexOf(String(code).trim().toUpperCase()))
    .filter((day) => day >= 0);

  return {
    days: new Set(days.length ? days : JS_DOW.map((_, index) => index)),
    startMinute,
    endMinute: spansNextDay(endMinute, startMinute) ? endMinute + MINUTES_PER_DAY : endMinute,
  };
}

const spansNextDay = (end, start) => end < start;

function normalizeLane(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id ?? '').trim().toLowerCase();
  if (!id) return null;

  const patterns = (Array.isArray(raw.match) ? raw.match : raw.match ? [raw.match] : [])
    .map((value) => String(value).trim())
    .filter(Boolean);

  return {
    id,
    label: String(raw.label ?? id),
    host: raw.host ? String(raw.host) : null,
    glyph: raw.glyph ? String(raw.glyph) : null,
    note: raw.note ? String(raw.note) : null,
    voiceChannel: /^\d{17,20}$/.test(String(raw.voiceChannel ?? '').trim())
      ? String(raw.voiceChannel).trim()
      : null,
    accent: /^#[0-9a-f]{6}$/i.test(String(raw.accent ?? '')) ? String(raw.accent) : '#a855f7',
    baseline: normalizeBaseline(raw.baseline),
    match: patterns.map(toMatcher),
  };
}

function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawLanes = Array.isArray(source.lanes) && source.lanes.length ? source.lanes : DEFAULT_CONFIG.lanes;

  const lanes = rawLanes.map(normalizeLane).filter(Boolean);
  const known = new Set(lanes.map((lane) => lane.id));

  const assignments = (Array.isArray(source.assignments) ? source.assignments : [])
    .filter((entry) => entry && known.has(String(entry.lane ?? '').toLowerCase()))
    .map((entry) => {
      const match = entry.match ? toMatcher(entry.match) : null;
      return {
        lane: String(entry.lane).toLowerCase(),
        id: entry.id ? String(entry.id) : null,
        match,
        /** Für die Anzeige im Detailpanel: woran erkennt man diesen Termin? */
        pattern: match ? match.source : entry.id ? String(entry.id) : null,
        /**
         * Feste Endzeit, falls Discord keine liefert – eine Uhrzeit, keine
         * Dauer. Der Start steht durch den Termin selbst fest.
         */
        endMinute: entry.end ? clockToMinutes(entry.end) : null,
      };
    })
    .filter((entry) => entry.id || entry.match);

  return { lanes, assignments };
}

let cached = null;

/**
 * Lädt `lanes.json` einmalig. Eine kaputte Datei darf den Kalender nie
 * stoppen – dann gilt die mitgelieferte Vorgabe.
 */
export function loadLaneConfig({ force = false } = {}) {
  if (cached && !force) return cached;

  const configured = process.env.LANES_FILE?.trim();
  const path = configured
    ? isAbsolute(configured)
      ? configured
      : join(ROOT, configured)
    : join(ROOT, 'lanes.json');

  let raw = null;
  let origin = 'default';

  if (existsSync(path)) {
    try {
      raw = JSON.parse(stripBom(readFileSync(path, 'utf8')));
      origin = 'file';
    } catch (error) {
      console.warn(`[lanes] ${path} ist kein gültiges JSON (${error.message}) – Vorgabe wird benutzt.`);
    }
  }

  cached = { ...normalizeConfig(raw ?? DEFAULT_CONFIG), origin, path };
  return cached;
}

/* ------------------------------------------------------------------ *
 * Klassifikation
 * ------------------------------------------------------------------ */

/**
 * `[PUBLIC] Arc Abschiedsraid` -> "PUBLIC" -> `public`.
 * Liefert `undefined`, wenn gar kein Tag vorne steht – nur dann geht es weiter
 * mit Zuordnung und Namensmustern. `null` bedeutet: bekannter Tag, aber ohne
 * Spur (`[SPECIAL]`), also bewusst spurlos.
 */
function readTag(name) {
  const match = /^\s*[[(]\s*([^)\]]{1,24}?)\s*[)\]]/.exec(String(name ?? ''));
  if (!match) return undefined;
  const key = match[1].normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  return key in TAG_ALIASES ? TAG_ALIASES[key] : undefined;
}

/** Ende in fortlaufenden Minuten – ein 01:30-Ende liegt am Folgetag. */
const spanEnd = (entry) =>
  entry.spansNextDay ? MINUTES_PER_DAY + entry.endClockMinute : entry.endMinute;

/**
 * Ordnet einen Termin einer Spur zu. Reihenfolge = Verlässlichkeit:
 * erst das, was der Mensch im Namen geschrieben hat, dann die Zuordnung in
 * `lanes.json`, dann ein Namensmuster, und erst ganz zuletzt die Uhrzeit.
 *
 * Die Zuordnung ändert nichts daran, *wann* ein Termin gezeichnet wird –
 * sie bestimmt nur Farbe und Beschriftung.
 */
function classify(entry, config) {
  if (entry.status === 'CANCELED') return { laneId: null, kind: 'cancelled' };

  const tagged = readTag(entry.name);
  if (tagged !== undefined) {
    return tagged
      ? { laneId: tagged, kind: 'lane', endMinute: null, endLabel: null }
      : { laneId: null, kind: 'plain', endMinute: null, endLabel: null };
  }

  for (const assignment of config.assignments) {
    const hit = assignment.id
      ? assignment.id === entry.eventId
      : assignment.match.test(entry.name) ||
        assignment.match.test(entry.description ?? '') ||
        assignment.match.test(entry.location ?? '');
    if (hit) {
      return {
        laneId: assignment.lane,
        kind: 'lane',
        endMinute: assignment.endMinute,
        endLabel: assignment.endMinute === null ? null : assignment.pattern,
      };
    }
  }

  for (const lane of config.lanes) {
    if (!lane.match.length) continue;
    const hit = lane.match.some(
      (pattern) =>
        pattern.test(entry.name) ||
        pattern.test(entry.description ?? '') ||
        pattern.test(entry.location ?? ''),
    );
    if (hit) return { laneId: lane.id, kind: 'lane', endMinute: null, endLabel: null };
  }

  // Notfall: zeitliche Überlappung mit einem festen Slot. Greift nur, wenn
  // die drei vorherigen Stufen nichts gefunden haben.
  for (const lane of config.lanes) {
    const baseline = lane.baseline;
    if (!baseline || !baseline.days.has(entry.weekday)) continue;
    const touches =
      entry.startMinute < baseline.endMinute && baseline.startMinute < spanEnd(entry);
    if (touches) return { laneId: lane.id, kind: 'lane', endMinute: null, endLabel: null };
  }

  return { laneId: null, kind: 'plain', endMinute: null, endLabel: null };
}

/* ------------------------------------------------------------------ *
 * Wochenmodell
 * ------------------------------------------------------------------ */

/**
 * Discord lässt bei den meisten Raids die Endzeit weg. Statt eine pauschale
 * Dauer zu erfinden, nimmt der Slot die sie auf: Ein Reset-Raid am Freitag
 * endet laut Regel um 23:30, also zeigt er 23:30 – als Schätzung markiert,
 * weil Discord das nicht bestätigt hat.
 *
 * Greift nur, wenn der Termin auch wirklich in dem Slot liegt: ein
 * Sonntags-Abend-Event wird nicht nachträglich zum Freitags-Reset erklärt.
 */
function applyRuleEnd(occurrence, weekday, lane) {
  if (!occurrence.endIsEstimated || occurrence.status === 'CANCELED') return;

  const baseline = lane?.baseline;
  if (!baseline || !baseline.days.has(weekday)) return;
  if (occurrence.startMinute < baseline.startMinute || occurrence.startMinute > baseline.endMinute) {
    return;
  }

  if (setRuleEnd(occurrence, baseline.endMinute)) occurrence.endFromRule = lane.id;
}

/** Setzt eine geregelte Endzeit. Gibt zurück, ob sich überhaupt etwas ändert. */
function setRuleEnd(occurrence, end) {
  // Eine Endzeit vor dem Start liegt am Folgetag – 23:00 mit Ende 01:30.
  const target = end <= occurrence.startMinute ? end + MINUTES_PER_DAY : end;
  if (target === spanEnd(occurrence)) return false;

  occurrence.endMinute = target;
  occurrence.endClockMinute = target % MINUTES_PER_DAY;
  occurrence.spansNextDay = target >= MINUTES_PER_DAY;
  return true;
}

/**
 * Schreibt `laneId` und `kind` in jeden Termin der Woche und liefert die
 * Spuren-Metadaten für die Oberfläche. Die Termine selbst bleiben unangetastet:
 * Wann etwas gezeichnet wird, entscheidet allein die Uhrzeit.
 */
export function applyLanes(week) {
  const config = loadLaneConfig();
  const byId = new Map(config.lanes.map((lane) => [lane.id, lane]));

  for (const day of week.days) {
    for (const occurrence of day.occurrences) {
      const { laneId, kind, endMinute, endLabel } = classify(
        { ...occurrence, weekday: day.weekday },
        config,
      );
      Object.assign(occurrence, {
        laneId,
        kind,
        endFromRule: null,
        endFromAssignment: null,
      });

      if (occurrence.endIsEstimated && occurrence.status !== 'CANCELED') {
        // Eine ausgeschriebene Endzeit ist das Genauere und schlägt die
        // Grundzeile: der Slot kennt 19:00–22:30, der Mensch 17:00–19:00.
        if (endMinute !== null) {
          if (setRuleEnd(occurrence, endMinute)) occurrence.endFromAssignment = endLabel;
        } else if (laneId) {
          applyRuleEnd(occurrence, day.weekday, byId.get(laneId));
        }
      }
    }
  }

  return {
    lanes: config.lanes.map(({ id, label, accent, glyph, host, note, voiceChannel, baseline }) => ({
      id,
      label,
      accent,
      glyph,
      host: host ?? null,
      note: note ?? null,
      voiceChannel,
      baseline: baseline
        ? {
            days: [...baseline.days].sort((a, b) => a - b).map((day) => JS_DOW[day]),
            startMinute: baseline.startMinute,
            endMinute: baseline.endMinute,
          }
        : null,
    })),
    source: config.origin,
  };
}

export const ALL_DAYS = ALL_DAY_CODES;