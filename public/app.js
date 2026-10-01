const dateFromKey = (key) => new Date(`${key}T00:00:00Z`);

const fmt = (options) => new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', ...options });

const els = {
  guildIcon: document.getElementById('guildIcon'),
  guildName: document.getElementById('guildName'),
  brandMeta: document.getElementById('brandMeta'),
  brandLanes: document.getElementById('brandLanes'),
  weekRange: document.getElementById('weekRange'),
  weekSub: document.getElementById('weekSub'),
  prevWeek: document.getElementById('prevWeek'),
  nextWeek: document.getElementById('nextWeek'),
  todayBtn: document.getElementById('todayBtn'),
  timezone: document.getElementById('timezone'),
  status: document.getElementById('status'),
  boardHead: document.getElementById('boardHead'),
  boardBody: document.getElementById('boardBody'),
  legend: document.getElementById('legend'),
  detail: document.getElementById('detail'),
  detailClose: document.getElementById('detailClose'),
  detailContent: document.getElementById('detailContent'),
};

const state = {
  weekStart: null,
  timezone: null,
  data: null,
  accentById: new Map(),
  /** `file` = statische Datei (GitHub Pages), `api` = laufender Server. */
  source: null,
  /** Vorhandene Wochenstarts bei statischer Auslieferung, sonst null. */
  weeks: null,
  /** Wann der gerade gezeigte Schnappschuss erzeugt wurde. */
  generatedAt: null,
};

const MINUTES_PER_DAY = 1440;
/** Anzeigehöhe einer Stunde. Der Server liefert sie in `meta.hourHeight`. */
const HOUR_HEIGHT = 46;
const PX_PER_MIN = HOUR_HEIGHT / 60;
/**
 * Leere Zeit wird zusammengedrückt. Sie behält nur einen Bruchteil ihrer Länge
 * und einen kleinen Kopf, damit man den Sprung überhaupt sieht – sonst
 * ertrinkt die ganze Woche in Leerraum.
 */
const FREE_SCALE = 0.3;
const COLLAPSED_HEAD = 10;
const AXIS_WIDTH = 52;
/**
 * Kleinste sinnvolle Kartenhöhe. Sie entspricht `cardHeightFor(1)` – Uhr plus
 * eine Zeile Name. Wer eine Karte auf 26 px staucht, zeigt nur noch den
 * Anfang des Namens, und die Aussage geht verloren.
 */
const MIN_CARD_HEIGHT = 46;
/** Rand oben/unten in Minuten – ein Termin soll nicht am Rand kleben. */
const EDGE_PAD = 20;

const ENTITY_META = {
  VOICE: { label: 'Voice-Event', glyph: '🔊', hues: [268, 250, 210, 190] },
  STAGE_INSTANCE: { label: 'Bühne', glyph: '🎙️', hues: [300, 320, 340, 265] },
  EXTERNAL: { label: 'Extern', glyph: '📍', hues: [95, 130, 150, 78] },
};

const EMOJI_HINT = /^([\p{Extended_Pictographic}][️‍\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*)\s*/u;

/** Die Tags, die die App selbst auswertet – sie gehören nicht in die Anzeige. */
const LANE_TAGS = new Set([
  'PUBLIC', 'LATE', 'SPAET', 'SPAETSCHICHT', 'NACHT', 'RESET', 'KOMMI',
  'SPECIAL', 'ZUSATZ', 'EXTRA',
]);

const TAG_PREFIX = /^\s*[[(]\s*([^)\]]{1,24}?)\s*[)\]]/;

/* ------------------------------------------------------------------ *
 * Hilfsfunktionen
 * ------------------------------------------------------------------ */

/**
 * "[PUBLIC] Arc Abschiedsraid" -> "Arc Abschiedsraid".
 * Nur bekannte Spur-Tags werden entfernt, damit "[Beta] Turnier" lesbar bleibt.
 */
function splitEmoji(name) {
  const raw = name ?? '';
  const tag = TAG_PREFIX.exec(raw);
  const body =
    tag && LANE_TAGS.has(tag[1].normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase())
      ? raw.slice(tag[0].length).trim()
      : raw;

  const match = EMOJI_HINT.exec(body);
  if (!match) return { glyph: null, title: body.trim() || raw };
  return { glyph: match[1], title: body.slice(match[0].length).trim() || body };
}

function clock(minutes) {
  const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Woher die Endzeit stammt – Discord lässt sie bei den meisten Raids weg. */
function endSource(entry) {
  if (!entry.endIsEstimated) return '';
  if (entry.endFromAssignment) return ` · Endzeit aus der Zuordnung „${entry.endFromAssignment}“`;
  const lane = entry.endFromRule ? laneFor(entry) : null;
  return lane
    ? ` · Endzeit aus der Regel „${lane.label}“`
    : ' · Endzeit geschätzt (in Discord nicht gesetzt)';
}

function timeRange(entry) {
  return `${clock(entry.startMinute)} – ${clock(spanEndMinutes(entry))} Uhr`;
}

/** Wie `timeRange`, aber kompakt: passt in eine schmale Tagesspalte. */
function shortRange(entry) {
  const range = `${clock(entry.startMinute)} – ${clock(spanEndMinutes(entry))}`;
  return entry.endIsEstimated ? `${range} ≈` : range;
}

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/**
 * Wochentags-Kürzel -> Nummer, 0 = Sonntag (so wie JavaScript zählt).
 *
 * Beide Schreibweisen sind gültig und werden auch gemischt benutzt: Discord
 * liefert englische Kürzel ("TU", "WE", "TH", "SU"), und in `lanes.json` steht
 * nebeneinander `["MO", "TU", "WE", …]` und `["Fr"]`. Vorher fiel ein
 * unbekanntes Kürzel stillschweigend weg – eine Grundlinie, die einen
 * Wochentag nicht zuordnen kann, taucht an diesem Tag schlicht nicht auf und
 * niemand erfährt warum.
 */
const CODE_TO_WEEKDAY = {
  SU: 0, SO: 0,
  MO: 1,
  TU: 2, DI: 2,
  WE: 3, MI: 3,
  TH: 4, DO: 4,
  FR: 5,
  SA: 6,
};

/** Dieselbe Abbildung rückwärts – für die Wochentags-Kürzel aus `lanes.json`. */
const JS_DOW_CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Beschreibt den Rhythmus in Worten. Entscheidend ist `frequency` – ein
 * monatliches Event darf nicht wie ein wöchentliches beschriftet werden.
 */
function rhythmLabel(entry) {
  const rule = entry.recurrence;
  if (!rule) return null;

  const every = rule.interval > 1 ? `Alle ${rule.interval} ` : '';

  switch (rule.frequency) {
    case 3: // DAILY
      return rule.byWeekday?.length === 7 || (!rule.byWeekday?.length && rule.interval === 1)
        ? 'Täglich'
        : `${every}${rule.byWeekday?.length ? 'Tage' : 'Tag'}`;

    case 2: { // WEEKLY
      if (!rule.byWeekday?.length) return `${every}Woche`;
      const names = rule.byWeekday.map((code) => weekdayName(CODE_TO_WEEKDAY[code] ?? 1));
      if (names.length === 1) {
        return rule.interval > 1
          ? `Jeden ${rule.interval}. ${names[0]}`
          : `Jeden ${names[0]}`;
      }
      return names.join(' + ');
    }

    case 1: { // MONTHLY
      if (rule.byNWeekday) {
        const name = weekdayName(CODE_TO_WEEKDAY[rule.byNWeekday.day] ?? 1);
        const ordinal = ['', '1.', '2.', '3.', '4.', '5.'][rule.byNWeekday.n] ?? `${rule.byNWeekday.n}.`;
        return `${every}${ordinal} ${name} im Monat`;
      }
      if (rule.byMonthDay?.length) {
        return `${every}am ${rule.byMonthDay.join('. und ')}. im Monat`;
      }
      return `${every}Monat`;
    }

    case 0: { // YEARLY
      if (rule.byMonthDay?.length && rule.byMonth?.length) {
        return `Jedes Jahr am ${rule.byMonthDay[0]}. ${MONTH_NAMES[rule.byMonth[0] - 1] ?? ''}`;
      }
      return 'Jährlich';
    }

    default:
      return null;
  }
}

/** Feste Akzentfarbe je Event, damit die Blöcke wochenübergreifend gleich bleiben. */
function accentFor(eventId, entityType) {
  if (state.accentById.has(eventId)) return state.accentById.get(eventId);
  const hues = ENTITY_META[entityType]?.hues ?? [270];
  let hash = 0;
  for (const ch of String(eventId)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const value = `hsl(${hues[hash % hues.length]} 74% 63%)`;
  state.accentById.set(eventId, value);
  return value;
}

/** Die Spur hat Vorrang: Public bleibt grün, auch wenn der Typ wechselt. */
function accentForEntry(entry) {
  const lane = state.data?.lanes?.find((item) => item.id === entry.laneId);
  return lane?.accent ?? accentFor(entry.eventId, entry.entityType);
}

function laneFor(entry) {
  return state.data?.lanes?.find((item) => item.id === entry.laneId) ?? null;
}

function shiftWeek(weekStart, weeks) {
  const date = dateFromKey(weekStart);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

function weekdayName(weekday) {
  // 0 = Sonntag. Datum 1970-01-04 war ein Sonntag.
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short' }).format(
    new Date(Date.UTC(1970, 0, 4 + weekday)),
  );
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ------------------------------------------------------------------ *
 * Spaltenkopf
 * ------------------------------------------------------------------ */

function renderHead(week) {
  els.boardHead.replaceChildren();
  els.boardHead.append(el('div', 'head-corner'));

  for (const day of week.days) {
    const head = el('div', 'day-head');
    const isWeekend = day.weekday === 0 || day.weekday === 6;
    if (isWeekend) head.classList.add('day-head--weekend');
    if (day.isToday) head.classList.add('day-head--today');
    // Die Unterstreichung ist ein Hinweis, kein Rahmen – normale Tage
    // bekommen deshalb gar keine.
    if (day.isToday || isWeekend) {
      head.style.setProperty('--day-accent', day.isToday ? 'var(--violet)' : 'var(--gold)');
    }

    head.append(
      el('span', 'day-name', weekdayName(day.weekday)),
      el('span', 'day-date', fmt({ day: '2-digit', month: '2-digit' }).format(dateFromKey(day.date))),
    );
    els.boardHead.append(head);
  }
}

/* ------------------------------------------------------------------ *
 * Zeitachse
 * ------------------------------------------------------------------ */

/**
 * Belegte **Tageszeit** der Woche: das Intervall 0–1440 gilt genau dann als
 * belegt, wenn es an *irgendeinem* Tag etwas gibt. Genau so entscheidet der
 * Nutzer: „wenn an keinem Tag zwischen 12 und 17 etwas ist, kollabiert es“ –
 * und weil alle sieben Spalten dieselbe Skala teilen, bleibt der Vergleich
 * Tag für Tag möglich.
 *
 * Ein Termin über Mitternacht (23:00–01:30) belegt einfach 23:00–25:30 in der
 * Rasterzeit. Er ragt damit sichtbar unter die 24-Uhr-Linie, und seine volle
 * Länge bleibt erhalten – das ist der Punkt der ganzen Achse.
 */
function busyMinutes(week) {
  const ranges = [];
  const push = (start, end) => {
    if (end > start) ranges.push([start, end]);
  };

  for (const day of week.days) {
    for (const entry of day.occurrences) push(entry.startMinute, spanEndMinutes(entry));

    const code = JS_DOW_CODE[day.weekday];
    for (const lane of week.lanes ?? []) {
      const baseline = lane.baseline;
      if (laneRunsOn(lane, code)) push(baseline.startMinute, baseline.endMinute);
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/**
 * Die stückweise lineare Achse. Belegte Zeit behält ihre echte Länge, alles
 * Dazwischen wird zusammengedrückt und verliert seine Rasterlinien. Ergebnis
 * ist eine Funktion Tagesminute -> Pixel, damit alle sieben Spalten dieselbe
 * Skala teilen.
 *
 * Nebeneffekt, den man kostenlos bekommt: Eine Nachtschicht bis 1:30 ragt
 * sichtbar unter die 24-Uhr-Linie, statt in einem Textfeld "(+1)" zu enden.
 */
function buildTimeAxis(week) {
  const busy = busyMinutes(week);
  const first = busy.length ? busy[0][0] : 9 * 60;
  const last = busy.length ? busy[busy.length - 1][1] : 22 * 60;

  const from = Math.max(0, Math.floor((first - EDGE_PAD) / 60) * 60);
  const to = Math.min(2 * MINUTES_PER_DAY, Math.ceil((last + EDGE_PAD) / 60) * 60);

  const segments = [];
  let cursor = from;

  for (const [busyFrom, busyTo] of busy) {
    const start = Math.max(busyFrom, from);
    const end = Math.min(busyTo, to);
    if (end <= start) continue;
    if (start > cursor) segments.push({ from: cursor, to: start, free: true });
    segments.push({ from: start, to: end, free: false });
    cursor = end;
  }
  if (cursor < to) segments.push({ from: cursor, to, free: true });

  let y = 0;
  for (const segment of segments) {
    const minutes = segment.to - segment.from;
    segment.top = y;
    segment.height = segment.free
      ? COLLAPSED_HEAD + minutes * FREE_SCALE * PX_PER_MIN
      : minutes * PX_PER_MIN;
    y += segment.height;
  }

  const yAt = (minute) => {
    const m = Math.min(Math.max(minute, from), to);
    for (const segment of segments) {
      if (m <= segment.to) {
        const span = segment.to - segment.from;
        return segment.top + (span > 0 ? ((m - segment.from) / span) * segment.height : 0);
      }
    }
    return y;
  };

  /**
   * Umkehrung von `yAt`. Nötig, weil eine Karte ihre Mindesthöhe über ihre Endzeit
   * hinaus einnimmt: Ein Termin von 30 Minuten wird 46 Pixel hoch gezeichnet,
   * damit noch ein Titel hineinpasst. Für die Grundlinie darunter zählt aber,
   * wo die Karte *wirklich* aufhört – und das lässt sich nur in Pixeln rechnen.
   */
  const minuteAt = (pixel) => {
    const p = Math.min(Math.max(pixel, 0), y);
    for (const segment of segments) {
      if (p <= segment.top + segment.height) {
        if (segment.height <= 0) return segment.from;
        return segment.from + ((p - segment.top) / segment.height) * (segment.to - segment.from);
      }
    }
    return to;
  };

  return { yAt, minuteAt, segments, total: y, from, to };
}

/** Absolute Endzeit eines Termins – 1:30 am Folgetag heißt 1530. */
function spanEndMinutes(entry) {
  return entry.spansNextDay ? MINUTES_PER_DAY + entry.endClockMinute : entry.endMinute;
}

/** „1:30“ nach 24 Uhr, „23:00“ davor – ohne Zusatz, der anyone hilft. */
function axisClock(minute) {
  return clock(minute);
}

/**
 * Gewicht einer Spalte: die Dauer des Termins. Zwei Raids zur selben Zeit –
 * einer über zwei Stunden, einer über eine – dürfen beide Platz für ihren
 * Namen bekommen, und der längere braucht davon mehr.
 */
const WEIGHT_EVENT = 1;

/**
 * Kein Streifen wird schmaler als das. In einer sieben Spalten breiten Woche
 * ist eine Tagesspalte gut 155 px – 38 % davon sind 59 px, und darin passt
 * noch eine Anfangszeit, aber kein Name mehr. Statt zu schrumpfen nimmt ein
 * zu kleiner Streifen den Anteil der anderen, bis wieder etwas lesbar ist.
 */
const MIN_SHARE = 0.38;

/**
 * Verteilt die Breite einer Spaltengruppe. Eingabe sind Gewichte, Ausgabe
 * Anteile, die zusammen genau 1 ergeben.
 */
function columnShares(weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const shares = weights.map((weight) => weight / total);

  // Die Untergrenze gilt nur, solange sie überhaupt für alle erreichbar ist.
  // Bei vier gleich schweren Dingen wäre 34 % zu viel; dann teilen sie sich
  // die Breite schlicht zu viert.
  const floor = Math.min(MIN_SHARE, 1 / shares.length);

  const deficit = shares.reduce((sum, share) => (share < floor ? sum + (floor - share) : sum), 0);
  if (deficit <= 0) return shares;

  // Was die zu schmalen Streifen brauchen, holen sich die anderen anteilig –
  // proportional dazu, wie viel Spielraum jeder von ihnen hat. Weil `floor`
  // nie über 1/Anzahl liegt, reicht der Spielraum immer aus.
  const surplus = shares.reduce((sum, share) => (share > floor ? sum + (share - floor) : sum), 0);
  if (surplus <= 0) return shares;

  return shares.map((share) =>
    share < floor ? floor : share - deficit * ((share - floor) / surplus),
  );
}

/**
 * Verteilt die Termine eines Tages nebeneinander. Überlappen sich zwei, teilen
 * sie sich die Spaltenbreite wie in jedem Kalender.
 *
 * Gebuchte Grundlinien laufen hier *nicht* mit. Sie bekommen einen eigenen Weg
 * weiter unten (`freeBands`): Der Termin ist das Besondere und soll die
 * volle Spalte haben, die Grundlinie steht dort, wo sie wirklich noch läuft.
 * Beides nebeneinander zu stellen ginge nur, indem man beides schmaler macht.
 *
 * Gewichtet wird nach Dauer: Wer länger läuft, braucht mehr Platz für seinen
 * Namen. Los geht es. `items` erwartet `{ start, end, weight, ...payload }` in
 * Tagesminuten; `end` darf über 1440 hinausgehen (Nachtschicht). Zurück kommen
 * dieselben Objekte plus `column`, `columnCount`, `columnOffset` und
 * `columnShare` (0..1 der Tagspalte).
 */
function packDay(items) {
  const sorted = items.slice().sort((a, b) => a.start - b.start || b.end - a.end);

  const placed = [];
  let cluster = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;

    const columns = [];
    for (const item of cluster) {
      const free = columns.findIndex((column) => column.end <= item.start);
      const index = free === -1 ? columns.length : free;

      if (free === -1) columns.push({ end: item.end, weight: item.weight });
      else {
        columns[index].end = item.end;
        columns[index].weight = Math.max(columns[index].weight, item.weight);
      }
      placed.push({ ...item, column: index });
    }

    // Eine Spalte ist so breit wie das schwerste Ding darin. Wer daneben
    // liegt, schrumpft also nur, wenn er selbst leichter ist – nicht, wenn er
    // zufällig zuerst eingetragen wurde.
    const spans = columnShares(columns.map((column) => column.weight));

    // Der Versatz gehört zur *Spalte*, nicht zum Termin: Drei Termine auf zwei
    // Spalten nutzen Spalte 0 zweimal, und der zweite darf nicht bei 100 %
    // landen – der ist dann im nächsten Tag. Darum hier einmal je Spalte
    // durchlaufen statt je Termin.
    const offsets = [];
    let cursor = 0;
    for (const span of spans) {
      offsets.push(cursor);
      cursor += span;
    }

    for (const item of placed.slice(-cluster.length)) {
      item.columnCount = columns.length;
      item.columnShare = spans[item.column];
      item.columnOffset = offsets[item.column];
    }

    cluster = [];
    clusterEnd = -1;
  };

  for (const item of sorted) {
    if (cluster.length && item.start >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();

  return placed;
}

/**
 * Setzt die horizontale Platzierung aus `packDay`. Der 2-Pixel-Rand auf beiden
 * Seiten ist der Luft zwischen zwei Karten – ohne ihn kleben sie aneinander.
 */
function placeColumn(node, item) {
  node.style.left = `calc(${item.columnOffset * 100}% + 2px)`;
  node.style.width = `calc(${item.columnShare * 100}% - 4px)`;
}

/* ------------------------------------------------------------------ *
 * Termin-Karte
 * ------------------------------------------------------------------ */

/**
 * Innenabstand und Zeilenhöhen der Terminkarte – Platz, den der Name nicht
 * bekommt. Die Zahlen stehen in `style.css` genauso: 12 px Innenabstand
 * (6 oben + 6 unten), 17 px Zeile. Wer eine der beiden Stellen ändert, muss
 * die andere mitziehen, sonst schneidet die Karte den Namen ab.
 */
const CARD_CHROME = 29;
/** Nur der Innenabstand oben/unten, ohne die Uhrzeile – siehe CARD_CHROME. */
const CARD_PADDING_Y = 12;
const TITLE_LINE = 17;
const TITLE_LINES = 3;
/**
 * Sicherheitsnetz gegen kaputte Messungen, kein Gestaltungsdeckel: In einer
 * schmalen Karte braucht der Name gut neun Zeilen, und die Karte ist
 * hoch genug dafür. Die eigentliche Grenze ist der Platz in der Karte.
 */
const MAX_TITLE_LINES = 12;
/** Rhythmuszeile samt Abstand darüber – nur die braucht extra Platz. */
const RHYTHM_CHROME = 14;
/** Luft zwischen zwei Karten, damit gewachsene Karten nicht kleben. */
const CARD_GAP = 8;

/** Platzbedarf einer Karte, damit `lines` Zeilen Name sichtbar sind. */
const cardHeightFor = (lines) => CARD_CHROME + TITLE_LINE * lines;

/**
 * Ab hier an braucht eine Karte echten Platz: das Coverbild daneben und die
 * Rhythmuszeile darunter. Beides ist Zusatz, kein Inhalt – fehlt der Platz,
 * fliegt es raus, statt den Namen zu zerdrücken.
 */
const HEIGHT_FOR_COVER = cardHeightFor(2);
const HEIGHT_FOR_RHYTHM = cardHeightFor(2) + RHYTHM_CHROME;
/**
 * Ein Cover braucht 30 px plus 9 px Abstand. In einer schmalen Karte – eine
 * sieben Spalten breite Woche hat gut 180 px pro Tag – frisst das die halbe
 * Textbreite und übrig bleibt „Der / ulti / m…". Darum entscheidet neben der
 * Höhe auch die Breite.
 */
const WIDTH_FOR_COVER = 148;
/** Platz, den das Cover am Text abbeißt – spiegelt `.ev-cover` in style.css. */
const COVER_SIZE = 30;
const COVER_GAP = 9;
/** Durchschnittliche Zeichenbreite von `.ev-title` (13,5 px, fett). */
const TITLE_CHAR_WIDTH = 7.8;

/**
 * Wie viele Zeilen braucht ein Text bei dieser Breite? Grobe Messung – genug,
 * um zu entscheiden, ob eine Karte wachsen muss. Im Zweifel eine zu viel: Eine
 * unnötig hohe Karte stört nicht, ein abgeschnittener Name schon.
 */
function wrappedLines(text, widthPx, charWidth = TITLE_CHAR_WIDTH) {
  const perLine = Math.max(6, Math.floor(widthPx / charWidth));
  let lines = 1;
  let used = 0;

  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const len = Math.min(word.length, perLine);
    if (used === 0) used = len;
    else if (used + 1 + len <= perLine) used += 1 + len;
    else { lines += 1; used = len; }
  }
  return lines;
}

/**
 * Wie hoch eine Karte gezeichnet wird.
 *
 * Die Oberkante ist immer die echte Startzeit – daran wird nicht gerüttelt.
 * Die Unterkante darf in freien Raum darunter wachsen, damit ein langer Name
 * auf einen kurzen Termin passt: *Der ultimative Speed-Dating Raid* ist eine
 * Stunde lang und liest sich sonst wie abgeschnitten. Was wächst, behauptet
 * nichts Falsches: Die Uhrzeit steht oben in der Karte, und das Brett hat
 * keine Stunde mehr, wo nichts ist.
 *
 * `room` ist der Platz bis zum nächsten Block. Wer dort endet, behält seine
 * echte Größe und kürzt den Namen – lieber ein „…" als eine überlappende Karte.
 *
 * `timeRows` ist 1, solange die Uhrzeit in eine Zeile passt. In einer
 * schmalen Karte bricht „17:00 – 21:00 ≈" um, und die zweite Zeile gehört in
 * die Rechnung – sonst bliebe die Karte zu niedrig und der Name hinge
 * über den Rand hinaus.
 */
function cardHeight(entry, axis, room, nameLines, timeRows = 1) {
  const top = axis.yAt(entry.startMinute);
  const natural = Math.max(axis.yAt(spanEndMinutes(entry)) - top, MIN_CARD_HEIGHT);
  const lines = Math.max(1, Math.min(TITLE_LINES, nameLines));
  const wanted = CARD_CHROME + TITLE_LINE * (lines - 1 + timeRows);
  return Math.max(natural, Math.min(wanted, room));
}

/**
 * Passt die Uhrzeile an die Kartenbreite an – **gemessen, nicht geraten**.
 * Sie ist das Wichtigste auf einer Terminkarte, also wird sie kleiner, bevor
 * irgendetwas gekürzt wird: 13 px, dann 11,5 px, dann 10,5 px, und erst wenn
 * auch das nicht reicht, bricht sie auf zwei Zeilen um.
 *
 * `scrollWidth` ist ehrlicher als jede Rechnung aus der Kartenbreite: Das
 * Coverbild nimmt dem Text ein Drittel, ohne dass man das der Kartenbreite von
 * außen ansieht. Zurück kommt die Zahl der Zeilen, die die Uhrzeit am Ende
 * braucht – eine umgebrochene kostet Platz, den der Name nicht mehr hat.
 */
function fitTimeLine(node) {
  if (!node) return 1;
  const clipped = () => node.scrollWidth > node.clientWidth + 1;

  node.classList.remove('ev-time--tight', 'ev-time--tightest', 'ev-time--wrap');
  if (!clipped()) return 1;

  node.classList.add('ev-time--tight');
  if (!clipped()) return 1;

  node.classList.remove('ev-time--tight');
  node.classList.add('ev-time--tightest');
  if (!clipped()) return 1;

  node.classList.remove('ev-time--tightest');
  node.classList.add('ev-time--wrap');
  return Math.max(1, Math.round(node.offsetHeight / TITLE_LINE));
}

function renderCard(item, day, axis, room) {
  const entry = item.entry;
  const card = el('button', 'ev');
  card.type = 'button';
  card.style.setProperty('--accent', accentForEntry(entry));

  // Die Nachtschicht darf über den Tagesrand hinausrAGEN – dafür ist die
  // Achse da. Abgeschnitten wird erst am äußersten Ende des Rasters.
  const top = axis.yAt(entry.startMinute);
  card.style.top = `${Math.round(top)}px`;
  card.style.height = `${Math.round(
    Math.max(axis.yAt(spanEndMinutes(entry)) - top, MIN_CARD_HEIGHT),
  )}px`;

  // Die Breite gibt der Packer vor – Spalte, Anteil am Tag, Rand.
  placeColumn(card, item);

  if (entry.status === 'CANCELED') card.classList.add('ev--dead');
  if (entry.status === 'ACTIVE') card.classList.add('ev--active');
  if (spanEndMinutes(entry) > axis.to) card.classList.add('ev--continues');
  if (entry.spansNextDay || entry.endMinute > MINUTES_PER_DAY) card.classList.add('ev--continues');

  const lane = laneFor(entry);
  if (lane) card.classList.add('ev--lane');

  const text = el('span', 'ev-text');
  const title = splitEmoji(entry.name).title;
  text.append(el('span', 'ev-time', shortRange(entry)), el('span', 'ev-title', title));
  card.append(text);

  const rhythm = rhythmLabel(entry);
  card.title = [
    rhythm,
    `${lane ? `${lane.label} · ` : ''}${entry.name}`,
    `${weekdayName(day.weekday)}, ${fmt({ day: '2-digit', month: '2-digit' }).format(dateFromKey(day.date))}`,
    entry.location,
    entry.status === 'CANCELED' ? 'abgesagt' : null,
  ].filter(Boolean).join('\n');

  card.addEventListener('click', () => openDetail(entry, day));

  // Höhe, Cover und Rhythmus kommen in `fitCard`: Sie hängen an der Breite der
  // Karte, und die ist erst messbar, wenn sie im Brett hängt.
  return { card, entry, axis, room, title, rhythm, text };
}

/**
 * Zweiter Schritt, direkt nach dem Einhängen und noch vor dem ersten Bildschirm:
 * Wie breit ist die Karte wirklich, wie viele Zeilen braucht der Name, und wie
 * hoch darf sie deshalb werden?
 */
function fitCard({ card, entry, axis, room, title, rhythm, text }) {
  // Das Coverbild entscheidet nur über die Breite. Damit gibt es keine
  // Zirkelabhängigkeit zur Höhe – und es muss *vor* dem Messen stehen, weil
  // es den Textbereich um 39 px verengt. Wer danach misst, zählt eine zu breite
  // Zeile und schneidet den Namen ab.
  const showsCover = Boolean(entry.imageSmall) && card.clientWidth >= WIDTH_FOR_COVER;
  const cover = card.querySelector('.ev-cover');
  if (showsCover && !cover) {
    const image = document.createElement('img');
    image.className = 'ev-cover';
    image.src = entry.imageSmall;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    card.insertBefore(image, text);
  } else if (!showsCover && cover) {
    cover.remove();
  }

  // Der Textbereich ist schmaler als die Karte: Innenabstand, und wenn ein
  // Cover danebensteht noch Bild plus Abstand. Wer die Kartenbreite rechnet,
  // zählt zu viele Zeichen pro Zeile.
  const style = getComputedStyle(card);
  const inner = card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const textWidth = Math.max(24, inner - (showsCover ? COVER_SIZE + COVER_GAP : 0));

  const wanted = wrappedLines(title, textWidth, TITLE_CHAR_WIDTH);
  let height = cardHeight(entry, axis, room, wanted);
  card.style.height = `${Math.round(height)}px`;

  // Wie viele Zeilen der Name bekommt, wird *gemessen*, nicht geschätzt.
  // Zwei Gründe: `wrappedLines` zählt Zeichen statt Buchstabenbreiten und
  // bricht keine Wörter an Bindestrichen; und die Uhrzeile nimmt in einer
  // schmalen Karte zwei Zeilen statt einer. Beides daneben zu rechnen klebt
  // genau den Namen ab, um den es geht.
  const label = text.querySelector('.ev-title');
  const timeLine = text.querySelector('.ev-time');
  const timeRows = fitTimeLine(timeLine);
  let lines = Math.max(1, Math.min(wanted, MAX_TITLE_LINES));

  if (label) {
    // Kurzzeitig mit offenem Deckel messen, was der Name wirklich braucht.
    card.style.setProperty('--title-lines', String(MAX_TITLE_LINES + 1));

    // Die umgebrochene Uhrzeile war in der ersten Schätzung nicht eingeplant.
    // Einmal nachziehen, sonst rechnet die Karte mit einer Zeile weniger, als
    // sie wirklich belegt, und der Name läuft über den unteren Rand hinaus.
    if (timeRows > 1) {
      height = cardHeight(entry, axis, room, wanted, timeRows);
      card.style.height = `${Math.round(height)}px`;
    }

    const titleRows = Math.ceil(label.scrollHeight / TITLE_LINE);
    const room2 = Math.floor((height - CARD_PADDING_Y - timeRows * TITLE_LINE) / TITLE_LINE);
    lines = Math.max(1, Math.min(titleRows, room2, MAX_TITLE_LINES));
  }
  card.style.setProperty('--title-lines', String(lines));

  // Zu niedrig darf das Cover trotzdem nicht werden – dann fliegt es raus. Das
  // verbreitert den Text nur, der Zeilen-Deckel oben bleibt also gültig.
  if (showsCover && height < HEIGHT_FOR_COVER) cover?.remove();

  const shown = text.querySelector('.ev-rhythm');
  if (rhythm && height >= HEIGHT_FOR_RHYTHM && !shown) text.append(el('span', 'ev-rhythm', rhythm));
  else if ((!rhythm || height < HEIGHT_FOR_RHYTHM) && shown) shown.remove();

  return card;
}

/**
 * Wie viel des Slots an diesem Tag bereits von einem Event belegt ist. Erst ab
 * dieser Deckung verschwindet der Slot: eine Grundlinie, die ein echtes Raid
 * fast vollständig ersetzt, wäre eine doppelte Ankündigung.
 *
 * Darunter bleibt er sichtbar – eine halb belegte Grundlinie ist Information,
 * keine Doppelung. Der Packer stellt sie dann neben den Termin statt unter
 * ihn.
 */
const SLOT_SUPPRESS_AT = 0.9;

function slotCoverage(baseline, entries) {
  let covered = 0;

  for (const entry of entries) {
    covered += Math.max(
      0,
      Math.min(spanEndMinutes(entry), baseline.endMinute) - Math.max(entry.startMinute, baseline.startMinute),
    );
  }
  return covered / Math.max(1, baseline.endMinute - baseline.startMinute);
}

/**
 * Läuft die Grundlinie an diesem Wochentag?
 *
 * Verglichen wird über die Nummer, nicht über den geschriebenen Kürzel: In
 * `lanes.json` steht nebeneinander `["MO", "TU", …]` und `["Sa"]`, und ein
 * `includes('SA')` hat diese Spur stillschweigend nie laufen lassen. Wer
 * `baseline.days` nicht kennt, bekommt hier eine Warnung – eine Grundlinie,
 * die einen Wochentag nicht zuordnen kann, fällt sonst spurlos weg.
 */
const warnedDays = new Set();

function laneRunsOn(lane, weekdayCode) {
  const days = lane.baseline?.days;
  if (!days?.length) return false;

  const wanted = dayIndex(weekdayCode);
  if (wanted < 0) return false;

  for (const code of days) {
    const found = dayIndex(code);
    if (found < 0) {
      const key = String(code);
      if (!warnedDays.has(key)) {
        warnedDays.add(key);
        console.warn(`[wochenplan] Unbekanntes Wochentags-Kürzel "${key}" – erwartet z.B. MO/TU/WE/TH/FR/SA/SU oder DI/MI/DO/SO.`);
      }
      continue;
    }
    if (found === wanted) return true;
  }
  return false;
}

/** `baseline.days` kommen als Kürzel, der Rest rechnet mit 0 = Sonntag. */
const dayIndex = (code) => (typeof code === 'number' ? code : (CODE_TO_WEEKDAY[String(code).toUpperCase()] ?? -1));

/**
 * `baseline.days` als Nummern (0 = Sonntag), **ab Montag** geordnet,
 * unbekannte Kürzel fallen weg. Der Umweg über Zahlen ist nicht Kosmetik:
 * `weekdayName` rechnet `Date.UTC(1970, 0, 4 + weekday)`, und ein Kürzel wie
 * `"MO"` ergibt dort `"4MO"` – `NaN`, und `Intl.DateTimeFormat.format` wirft
 * dann mitten im Klick auf einen Slot. Deshalb wandelt nur noch diese eine
 * Funktion Kürzel in Zahlen, und niemand ruft `weekdayName` mit einem Kürzel
 * auf.
 *
 * Ab Montag zu ordnen statt ab Sonntag ist Geschmack, kein Zufall: „Gilt an:
 * So, Mo, Di …" liest sich für einen Wochenplan falsch herum. Verschoben wird
 * um eins – Sonntag wandert ans Ende statt an den Anfang.
 */
function weekdayIndices(codes) {
  const unique = [...new Set((codes ?? []).map(dayIndex).filter((index) => index >= 0))];
  return unique.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
}

/**
 * Platzschwellen für einen Grundlinien-Streifen. Ein Streifen ist manchmal nur
 * eine Stunde hoch – dann passt der volle dreizeilige Text nicht, und ein
 * abgeschnittener Name ist schlimmer als ein weggelassener. Die Zahlen
 * summieren sich aus `.slot` in style.css: 13 px Innenabstand, 11 px Rhythmus,
 * 17 px Uhrzeit, 15 px Name.
 */
const SLOT_MIN_HEIGHT = 30;
const SLOT_WITH_NAME = 45;
const SLOT_FULL_HEIGHT = 56;

/** „Täglich“, „Freitags“, „Mo, Mi“ – für die Kopfzeile des Slots. */
function slotRhythm(lane) {
  const days = weekdayIndices(lane.baseline.days);

  if (days.length >= 7) return 'Täglich';
  if (days.length === 5 && days.join() === '1,2,3,4,5') return 'Werktags';
  if (days.length === 1) return weekdayName(days[0]);
  return days.map((day) => weekdayName(day).slice(0, 2)).join(' ');
}

/**
 * Die gebuchten Slots aus `lanes.json`. Das sind keine Platzhalter, sondern
 * Raids, die wirklich stattfinden – Discord führt sie nur nicht. Sie bekommen
 * deshalb dieselbe Kartenform wie ein Event, nur mit zurückgenommener Farbe,
 * kleinerer Schrift und ohne Rhythmus-Emoji: Wer weiß, dass es ihn gibt, muss
 * ihn nicht suchen, und wer ihn nicht kennt, soll nicht darauf aufmerksam
 * werden.
 *
 * Gezeichnet wird nicht die ganze Grundlinie, sondern nur, was an diesem Tag
 * **kein Termin belegt** (`freeBands`). Steckt ein Raid in der Grundlinie,
 * behält er die volle Spaltenbreite; die Grundlinie erscheint dort, wo sie
 * wirklich noch läuft – am Freitag also ab 23:45, am Samstag von 21 bis 22 Uhr.
 * Nebeneinanderzustellen ginge nur, indem man beides schmaler macht, und
 * gerade der Termin soll ja der laute sein.
 */
function renderSlotBand(band, axis) {
  const top = axis.yAt(band.from);
  const bottom = axis.yAt(band.to);
  const height = bottom - top;
  // Für weniger als eine Zeile ist kein Streifen mehr lesbar, sondern nur noch
  // ein Farbfleck – der wäre schlimmer als gar keiner.
  if (height < SLOT_MIN_HEIGHT) return null;

  const { lane } = band;
  const overnight = band.to > MINUTES_PER_DAY;
  const card = el('button', 'slot');
  card.type = 'button';
  card.style.setProperty('--accent', lane.accent);
  card.style.top = `${Math.round(top)}px`;
  card.style.height = `${Math.round(height)}px`;
  // Immer über die volle Tagesbreite. Hier ist per Konstruktion nichts, was
  // daneben stört: ein Streifen existiert nur dort, wo kein Termin läuft.
  card.style.left = '2px';
  card.style.width = 'calc(100% - 4px)';

  if (height >= SLOT_FULL_HEIGHT) {
    card.append(el('span', 'slot-rhythm', `${slotRhythm(lane)} ${overnight ? 'ab' : 'ca.'}`));
  }
  card.append(
    el(
      'span',
      'slot-time',
      overnight
        ? `${compactClock(band.from)} Uhr`
        : `${compactClock(band.from)} – ${compactClock(band.to)} Uhr`,
    ),
  );
  if (height >= SLOT_WITH_NAME) {
    card.append(el('span', 'slot-name', lane.host ? `${lane.label} ${lane.host}` : lane.label));
  }

  const clipped = band.to - band.from < lane.baseline.endMinute - lane.baseline.startMinute;
  card.title = [
    `${lane.label}: feste Regel aus lanes.json, in Discord nicht eingetragen`,
    clipped
      ? `Hier sichtbar nur ${clock(band.from)}–${clock(band.to)} – den Rest belegt ein Termin.`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
  card.addEventListener('click', () => openSlotDetail(lane));

  return card;
}

/**
 * Die Stücke einer Grundlinie, die an diesem Tag von keinem Termin belegt
 * sind. Grundlinie minus Vereinigung aller Termine.
 *
 * Der Termin ist das Besondere und soll die volle Breite haben; die Grundlinie
 * weicht ihm und erscheint nur, wo sie wirklich noch läuft. Übrig bleibt
 * meist ein einziges Stück – typischerweise das Ende der Nachtschicht nach
 * einem Reset, oder der Public-Raid nach einem Sondertermin.
 */
function freeBands(lane, entries) {
  const { startMinute: from, endMinute: to } = lane.baseline;
  if (to <= from) return [];

  const busy = entries
    .map((entry) => [entry.startMinute, Math.min(spanEndMinutes(entry), to)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [start, end] of busy) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const bands = [];
  let cursor = from;
  for (const [start, end] of merged) {
    if (start >= to) break;
    if (start > cursor) bands.push({ lane, from: cursor, to: start });
    cursor = Math.max(cursor, end);
    if (cursor >= to) break;
  }
  if (cursor < to) bands.push({ lane, from: cursor, to });

  return bands;
}

/**
 * Wie viel Platz unter einer Karte wirklich frei ist – in Pixeln, weil nur hier
 * sichtbar wird, wie viel Raum es gibt. Auf der zusammengedrückten Achse sind
 * das andere Zahlen als in der Uhrzeit: 40 freie Minuten sind fast nichts,
 * 40 Minuten am Stück sind eine ganze Stunde.
 *
 * Gezählt wird, was einem wirklich im Weg ist: die nächste Karte **derselben
 * Spalte** – wer daneben liegt, überlappt nicht – und jeder Grundlinien-Streifen
 * unterhalb. Der zieht über die volle Tagesbreite und begrenzt darum jede Karte
 * darüber, nicht nur die, die neben ihm stünde.
 */
function roomBelow(item, cards, bands, axis, height) {
  const top = axis.yAt(item.start);
  let limit = height;

  for (const other of cards) {
    if (other === item || other.column !== item.column) continue;
    const otherTop = axis.yAt(other.start);
    if (otherTop <= top) continue;
    limit = Math.min(limit, otherTop - CARD_GAP);
  }
  for (const band of bands) {
    const bandTop = axis.yAt(band.from);
    if (bandTop > top) limit = Math.min(limit, bandTop - CARD_GAP);
  }

  return Math.max(limit - top, 0);
}

/** Kurzform für Achsenbeschriftungen: 19, 22.30, 1.30. */
function compactClock(minutes) {  const m = (((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${hours}.${String(rest).padStart(2, '0')}` : String(hours);
}

/* ------------------------------------------------------------------ *
 * Brett
 * ------------------------------------------------------------------ */

function renderBoard(week) {
  els.boardBody.replaceChildren();

  const total = week.days.reduce((sum, day) => sum + day.occurrences.length, 0);

  if (total === 0) {
    const problem = week.meta?.problem;
    const empty = el('div', 'board-empty');

    if (problem) {
      empty.classList.add('board-empty--error');
      empty.append(
        el('strong', null, problem.title),
        el('span', null, problem.hint),
        el('span', 'board-empty-note', `Technisch: ${week.meta.error ?? ''}`),
      );
      const link = el('a', 'board-empty-link', 'Diagnose öffnen');
      // Nur sinnvoll, wenn es überhaupt einen Server gibt. Auf GitHub Pages
      // gibt es `/api/health` nicht, und ein Link ins Nichts ist schlimmer
      // als gar keiner.
      if (state.source !== 'file') {
        link.href = '/api/health';
        link.target = '_blank';
        link.rel = 'noopener';
        empty.append(link);
      }
    } else {
      empty.textContent = 'Für diese Woche sind in Discord keine Events eingetragen.';
    }

    els.boardBody.append(empty);
    return;
  }

  const axis = buildTimeAxis(week);
  const height = axis.total;

  const grid = el('div', 'grid');
  grid.style.setProperty('--grid-height', `${Math.round(height)}px`);

  // Stundenlinien nur dort, wo die Zeit wirklich läuft. Im zusammengedrückten
  // Bereich würden sie etwas behaupten, das nicht stimmt – dort bleibt es leer.
  const lines = el('div', 'grid-lines');
  for (const segment of axis.segments) {
    if (segment.free) continue;
    for (let minute = Math.ceil(segment.from / 60) * 60; minute < segment.to; minute += 60) {
      const line = el('div', 'grid-line');
      if (minute % MINUTES_PER_DAY === 0) line.classList.add('grid-line--day');
      line.style.top = `${Math.round(axis.yAt(minute))}px`;
      lines.append(line);
    }
  }

  // Achsenbeschriftung nur an den Kanten der gelaufenen Abschnitte. Ohne sie
  // wäre nach dem Zusammendrücken nicht mehr unterscheidbar, wo man sich
  // gerade befindet.
  const axisColumn = el('div', 'grid-axis');
  axisColumn.style.setProperty('--grid-height', `${Math.round(height)}px`);

  // Immer der Anfang, dazu jede Kante eines gelaufenen Abschnitts und jede
  // Mitternacht. Ohne diese Beschriftung wäre nach dem Zusammendrücken nicht
  // mehr unterscheidbar, wo man sich gerade befindet – und man sähe nicht,
  // dass die Nachtschicht den Tag verlässt statt in ihm zu enden.
  const ticks = new Set([axis.from]);
  for (const segment of axis.segments) {
    if (!segment.free) ticks.add(segment.from);
  }
  for (let minute = MINUTES_PER_DAY; minute <= axis.to; minute += MINUTES_PER_DAY) ticks.add(minute);

  for (const minute of [...ticks].sort((a, b) => a - b)) {
    const tick = el('span', 'grid-tick', axisClock(minute));
    tick.style.top = `${Math.round(axis.yAt(minute) - 6)}px`;
    axisColumn.append(tick);
  }

  const days = el('div', 'grid-days');
  days.style.setProperty('--grid-height', `${Math.round(height)}px`);
  days.append(lines);

  const pending = [];

  for (const day of week.days) {
    const column = el('div', 'grid-day');
    if (day.isToday) column.classList.add('grid-day--today');
    if (day.weekday === 0 || day.weekday === 6) column.classList.add('grid-day--weekend');

    const code = JS_DOW_CODE[day.weekday];

    // Die Termine eines Tages teilen sich untereinander die Spaltenbreite. Wer
    // länger läuft, bekommt mehr davon – er hat auch mehr zu erzählen.
    const cards = packDay(
      day.occurrences.map((entry) => ({
        kind: 'ev',
        entry,
        start: entry.startMinute,
        end: spanEndMinutes(entry),
        weight: WEIGHT_EVENT * (spanEndMinutes(entry) - entry.startMinute),
      })),
    );

    // Die gebuchten Grundlinien laufen nicht mit. Sie werden auf das
    // eingekürzt, was kein Termin belegt, und ziehen über die volle Breite
    // darunter. So behält der Termin die volle Spalte – und die Grundlinie
    // steht trotzdem dort, wo sie wirklich noch läuft.
    const bands = [];
    for (const lane of week.lanes ?? []) {
      if (!laneRunsOn(lane, code)) continue;
      // Nur eine fast vollständig ersetzte Grundlinie entfällt. Alles andere
      // ist eine echte Zusatzinfo und wandert als Streifen mit.
      if (slotCoverage(lane.baseline, day.occurrences) >= SLOT_SUPPRESS_AT) continue;
      bands.push(...freeBands(lane, day.occurrences));
    }

    // `freeBands` kürzt nach Uhrzeit. Die Karten aber werden mindestens
    // `MIN_CARD_HEIGHT` hoch gezeichnet, damit ein kurzer Termin überhaupt einen
    // Titel trägt – und ragen dabei über ihre Endzeit hinaus. Ein 30-Minuten-
    // Termin ist dadurch eine Stunde hoch und schöbe sonst in den Streifen
    // darunter. Also weicht der Streifen, nicht der Termin: Die Karten haben
    // Vorrang, das ist der ganze Sinn der Zwei-Stufen-Lage.
    const belegung = cards.map((item) => {
      const top = axis.yAt(item.entry.startMinute);
      return [top, top + Math.max(axis.yAt(spanEndMinutes(item.entry)) - top, MIN_CARD_HEIGHT)];
    });
    for (const band of bands) {
      let y = axis.yAt(band.from);
      for (const [oben, unten] of belegung) {
        if (unten <= y + 0.5) continue;
        if (oben < y + 0.5) y = unten;
      }
      const echterStart = axis.minuteAt(y);
      if (echterStart < band.to - 0.5) band.from = echterStart;
    }

    for (const item of cards) {
      const built = renderCard(item, day, axis, roomBelow(item, cards, bands, axis, height));
      column.append(built.card);
      pending.push(built);
    }
    for (const band of bands) {
      const strip = renderSlotBand(band, axis);
      if (strip) column.append(strip);
    }
    days.append(column);
  }

  grid.append(axisColumn, days);
  els.boardBody.append(grid);

  // Erst jetzt sind die Karten messbar. Der Durchgang läuft vor dem ersten
  // Bildschirm, das Nachflackern bemerkt niemand.
  for (const built of pending) fitCard(built);
}

/* ------------------------------------------------------------------ *
 * Marke, Legende, Kopf
 * ------------------------------------------------------------------ */

function renderBrand(week) {
  const guild = week.guild ?? {};
  els.guildName.textContent = guild.name ?? 'Wochenplan';
  els.guildIcon.replaceChildren();

  if (guild.icon) {
    const img = document.createElement('img');
    img.src = guild.icon;
    img.alt = '';
    els.guildIcon.append(img);
  } else {
    els.guildIcon.textContent = guild.demo ? '🗡️' : '🗓️';
  }

  const count = week.days.reduce((sum, day) => sum + day.occurrences.length, 0);
  const rows = [
    ['Guild', guild.demo ? 'Demo-Daten' : (guild.id ?? '–')],
    ['Zeitzone', week.timezone],
    ['Termine', String(count)],
    ['Stand', new Date(week.generatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })],
  ];

  els.brandMeta.replaceChildren();
  for (const [label, value] of rows) {
    els.brandMeta.append(el('dt', null, label), el('dd', null, value));
  }

  renderLanes(week);
}

/**
 * Die festen Raids der Gilde. Sie stehen in `lanes.json` und nicht in Discord –
 * deshalb gehören sie in die Markenspalte: Hier steht, was jede Woche läuft,
 * mit einem Sprung direkt in den Sprachkanal.
 */
function renderLanes(week) {
  els.brandLanes.replaceChildren();

  const lanes = (week.lanes ?? []).filter((lane) => lane.baseline);
  if (!lanes.length) return;

  els.brandLanes.append(el('h2', 'brand-lanes-title', 'Feste Raids'));

  for (const lane of lanes) {
    const item = el('div', 'brand-lane');
    item.style.setProperty('--accent', lane.accent);

    const title = el('div', 'brand-lane-title');
    title.append(
      el('span', 'brand-lane-glyph', lane.glyph ?? '•'),
      el('span', 'brand-lane-name', lane.label),
    );

    const detail = [`${slotRhythm(lane)} ${baselineTime(lane)}`];
    if (lane.host) detail.push(lane.host);
    if (lane.voiceChannel) {
      const link = el('a', 'brand-lane-link', '🎙️ Kanal');
      link.href = `https://discord.com/channels/${week.guild?.id ?? '@me'}/${lane.voiceChannel}`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = 'Sprachkanal in Discord öffnen';
      item.append(title, el('div', 'brand-lane-detail', detail.join(' · ')), link);
    } else {
      item.append(title, el('div', 'brand-lane-detail', detail.join(' · ')));
    }

    if (lane.note) item.title = lane.note;
    els.brandLanes.append(item);
  }
}

/** „19 – 22.30 Uhr“ bzw. „ab 23 Uhr“, wenn der Slot über Mitternacht läuft. */
function baselineTime(lane) {
  const { startMinute, endMinute } = lane.baseline;
  return endMinute > MINUTES_PER_DAY
    ? `ab ${clock(startMinute)} Uhr`
    : `${clock(startMinute)} – ${clock(endMinute)} Uhr`;
}

function renderLegend(week) {
  els.legend.replaceChildren();

  const laneOf = (id) => week.lanes?.find((lane) => lane.id === id);
  const usedLanes = new Set(
    week.days.flatMap((day) => day.occurrences.map((entry) => entry.laneId).filter(Boolean)),
  );

  for (const id of usedLanes) {
    const lane = laneOf(id);
    if (!lane) continue;
    const item = el('div', 'legend-item');
    const dot = el('span', 'legend-dot');
    dot.style.setProperty('--accent', lane.accent);
    item.append(dot, el('strong', null, lane.label), el('span', null, lane.host ?? ''));
    els.legend.append(item);
  }

  const usedTypes = new Set(
    week.days
      .flatMap((day) => day.occurrences)
      .filter((entry) => !entry.laneId)
      .map((entry) => entry.entityType),
  );

  for (const type of usedTypes) {
    const meta = ENTITY_META[type] ?? { label: type, glyph: '📅' };
    const item = el('div', 'legend-item');
    item.append(el('span', null, meta.glyph), el('strong', null, meta.label));
    els.legend.append(item);
  }

  const hint = el('div', 'legend-item');
  hint.append(
    el('span', null, '💡'),
    el(
      'span',
      null,
      'Zurückgenommene Karte = feste Grundlinie aus lanes.json, auf das eingekürzt, was kein Termin belegt · volle Karte = Termin aus Discord · zwei Termine zur selben Zeit stehen nebeneinander · leere Zeit ist zusammengedrückt · ‹ › blättern die Woche',
    ),
  );
  els.legend.append(hint);

  if (week.meta?.source === 'demo') {
    const note = el('div', 'legend-item');
    note.append(
      el('span', null, '⚠️'),
      el('span', null, 'Demo-Modus – für den Live-Betrieb DISCORD_TOKEN und DISCORD_GUILD_ID in der .env setzen.'),
    );
    els.legend.append(note);
  }

  if (week.meta?.lanes === 'default') {
    const note = el('div', 'legend-item');
    note.append(
      el('span', null, '⚙️'),
      el('span', null, 'Keine lanes.json gefunden – die Spuren stammen aus der Vorgabe in src/lanes.js.'),
    );
    els.legend.append(note);
  }
}

function render(week) {
  state.data = week;
  const from = dateFromKey(week.weekStart);
  const to = dateFromKey(week.weekEnd);

  els.weekRange.textContent = `${fmt({ day: '2-digit', month: '2-digit' }).format(from)} – ${fmt({
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(to)}`;
  els.weekSub.textContent = `KW ${getWeekNumber(from)} · ${week.timezone}`;

  renderBrand(week);
  renderHead(week);
  renderBoard(week);
  renderLegend(week);
}

function getWeekNumber(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target - firstThursday;
  return 1 + Math.round(diff / (7 * 86_400_000));
}

/* ------------------------------------------------------------------ *
 * Detailpanel
 * ------------------------------------------------------------------ */

function statusText(status) {
  if (status === 'ACTIVE') return 'läuft gerade';
  if (status === 'CANCELED') return 'abgesagt';
  if (status === 'COMPLETED') return 'beendet';
  return 'geplant';
}

/**
 * `day` ist der Tag, in dessen Spalte die Karte steht. Ein Eintrag aus der API
 * kennt ihn nicht – er gehört zu einer Woche und kann an sieben verschiedenen
 * Tagen stehen. Ohne ihn behauptete das Panel bei jedem Termin "Montag".
 */
function openDetail(entry, day) {
  const { glyph, title } = splitEmoji(entry.name);
  const accent = accentForEntry(entry);
  const meta = ENTITY_META[entry.entityType] ?? { label: entry.entityType, glyph: '📅' };
  const lane = laneFor(entry);
  const tz = state.data?.timezone;

  const parts = [glyph ?? meta.glyph, title].filter(Boolean).join(' ');
  const rhythm = rhythmLabel(entry);

  const when = `${weekdayName(day?.weekday ?? entry.weekday ?? 1)}, ${fmt({
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(dateFromKey(day?.date ?? entry.date ?? state.data.weekStart))} · ${timeRange(entry)}`;

  const rows = [
    ['Wann', when],
    rhythm ? ['Rhythmus', rhythm] : null,
    ['Art', lane ? `${meta.label} · ${lane.label}` : meta.label],
    entry.location ? ['Ort', entry.location] : null,
    entry.userCount !== null && entry.userCount !== undefined
      ? ['Teilnehmende', `${entry.userCount}`]
      : null,
    ['Status', statusText(entry.status)],
  ].filter(Boolean);

  const rowHtml = rows
    .map(([label, value]) => `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');

  els.detailContent.innerHTML = `
    ${entry.image ? `<img class="detail-cover" src="${escapeHtml(entry.image)}" alt="">` : ''}
    <div class="detail-kind" style="--accent:${accent}">${escapeHtml(meta.label)}${entry.recurring ? ' · wiederkehrend' : ''}</div>
    <h2 class="detail-title">${escapeHtml(parts)}</h2>
    ${lane ? `<div class="detail-lane" style="--accent:${lane.accent}">${escapeHtml(lane.label)}${lane.host ? ` · ${escapeHtml(lane.host)}` : ''}</div>` : ''}
    <div class="detail-rows">${rowHtml}</div>
    ${entry.description ? `<p class="detail-description">${escapeHtml(entry.description)}</p>` : ''}
    <div class="detail-actions" style="--accent:${accent}">
      ${entry.url ? `<a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener">In Discord öffnen</a>` : ''}
      ${entry.channelUrl ? `<a href="${escapeHtml(entry.channelUrl)}" target="_blank" rel="noopener">Zum Kanal</a>` : ''}
    </div>
    <p class="detail-footnote">Zeiten in ${escapeHtml(tz ?? '')}${escapeHtml(endSource(entry))}</p>
  `;

  els.detail.dataset.open = 'true';
  els.detail.setAttribute('aria-hidden', 'false');
}

function openSlotDetail(lane) {
  const baseline = lane.baseline;
  const overnight = baseline.endMinute > MINUTES_PER_DAY;
  const tz = state.data?.timezone;

  const rows = [
    ['Rhythmus', `${slotRhythm(lane)}${overnight ? ' ab' : ''}`],
    ['Uhrzeit', overnight
      ? `ab ${clock(baseline.startMinute)} Uhr (Folgetag ${clock(baseline.endMinute)})`
      : `${clock(baseline.startMinute)} – ${clock(baseline.endMinute)} Uhr`],
    ['Gilt an', weekdayIndices(baseline.days).map(weekdayName).join(', ')],
    lane.host ? ['Von', lane.host.replace(/^mit /, '')] : null,
  ].filter(Boolean);

  els.detailContent.innerHTML = `
    <div class="detail-kind" style="--accent:${escapeHtml(lane.accent)}">Gebuchter Slot</div>
    <h2 class="detail-title">${escapeHtml(lane.glyph ? `${lane.glyph} ${lane.label}` : lane.label)}</h2>
    <div class="detail-lane" style="--accent:${escapeHtml(lane.accent)}">${escapeHtml(lane.label)}${lane.host ? ` · ${escapeHtml(lane.host)}` : ''}</div>
    <div class="detail-rows">${rows
      .map(
        ([label, value]) =>
          `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
      )
      .join('')}</div>
    <p class="detail-description">${escapeHtml(lane.note)}</p>
    <p class="detail-footnote">Zeiten in ${escapeHtml(tz ?? '')}</p>
  `;

  els.detail.dataset.open = 'true';
  els.detail.setAttribute('aria-hidden', 'false');
}

function closeDetail() {
  els.detail.dataset.open = 'false';
  els.detail.setAttribute('aria-hidden', 'true');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

/* ------------------------------------------------------------------ *
 * Datenladen und Steuerung
 * ------------------------------------------------------------------ */

function setStatus(text, stateName = 'ok') {
  els.status.textContent = text;
  els.status.dataset.state = stateName;
}

/**
 * Holt die Wochen – erst beim Server, dann aus der Datei.
 *
 * Auf GitHub Pages gibt es keinen Server, dort liegen die Wochen als Dateien
 * unter `data/` (siehe `tools/snapshot.mjs`). Dieselbe `public/`-Mappe läuft also
 * für beides, ohne dass ein Build-Schritt irgendetwas umschreibt.
 *
 * Die Reihenfolge ist Absicht und war zunächst verkehrt herum: Liegt eine
 * `public/data/`-Mappe im Arbeitsverzeichnis – etwa weil jemand lokal
 * `npm run snapshot` gelaufen hat –, dann *verdrängt* sie den laufenden Server.
 * Man sähe eine Woche voller Demo-Termine und griffe beim Nachfragen auf
 * `/api/week` doch wieder auf die echten zu. Wer eine schnellere Quelle hat,
 * muss sie zuerst nehmen; die Dateien sind der Ersatz, nicht das Ziel.
 *
 * `null` heißt „unbekannt“. Nach dem ersten 404 weiß die Seite, dass es keine
 * gibt, und fragt nicht bei jedem Blättern erneut – auf Pages ist der Fehlversuch
 * also einmal pro Sitzung, nicht einmal je Woche.
 */
let apiVorhanden = null;

async function fetchWeek(params) {
  if (apiVorhanden !== false) {
    try {
      const response = await fetch(`/api/week?${params}`);
      if (response.ok) {
        apiVorhanden = true;
        state.source = 'api';
        state.weeks = null;
        els.prevWeek.disabled = false;
        els.nextWeek.disabled = false;
        return await response.json();
      }
      if (response.status === 404) apiVorhanden = false;
    } catch {
      apiVorhanden = false;
    }
  }

  const wanted = state.weekStart ? `data/${state.weekStart}.json` : 'data/latest.json';
  try {
    const file = await fetch(`${wanted}?${params}`);
    if (file.ok) {
      state.source = 'file';
      await loadWeekIndex();
      return await file.json();
    }
  } catch {
    /* Weder Server noch Datei – gleich der Fehler unten. */
  }

  throw new Error(apiVorhanden === false
    ? 'Keine Datei für diese Woche vorhanden'
    : 'Server nicht erreichbar und keine Datei vorhanden');
}

/** Liest die Liste der erzeugten Wochen, damit die Pfeile einen Endpunkt haben. */
async function loadWeekIndex() {
  if (state.weeks) return;
  try {
    const index = await fetch('data/index.json');
    if (index.ok) {
      const body = await index.json();
      state.weeks = Array.isArray(body.weeks) ? body.weeks : null;
    }
  } catch {
    /* Ohne Liste bleiben die Pfeile frei – dann eben ein 404 im Statusfeld. */
  }
}

async function loadWeek() {
  setStatus('Lade Termine …', 'loading');
  const params = new URLSearchParams();
  if (state.weekStart) params.set('start', state.weekStart);
  if (state.timezone) params.set('tz', state.timezone);

  try {
    const week = await fetchWeek(params);

    state.weekStart = week.weekStart;
    state.timezone = week.timezone;
    // Zeitpunkt dieses Schnappschusses. `watchForFreshData` vergleicht ihn mit
    // dem von `data/latest.json` und weiß so, ob sich etwas getan hat.
    state.generatedAt = week.generatedAt ?? null;
    els.timezone.value = week.timezone;
    render(week);

    // Ohne Server lässt sich die Zeitzone nicht umrechnen – der Schnitt ist im
    // Schnappschuss für *eine* Zone erzeugt. Ein Auswahlfeld, das beim Wechsel
    // zurückspringt, wäre schlimmer als keines: Es verspricht etwas, das hier
    // nicht stattfindet.
    fillTimezones(week.timezone, state.source === 'file');
    els.timezone.disabled = state.source === 'file';
    if (state.source === 'file') {
      els.timezone.title = `Feste Schnitte in ${week.timezone} – die Dateien werden alle sechs Stunden neu erzeugt.`;
    } else {
      els.timezone.removeAttribute('title');
    }

    const note = week.meta?.stale
      ? `Stand ${new Date(week.meta.fetchedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} (veraltet)`
      : `Stand ${new Date(week.generatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    setStatus(week.meta?.error ? `Fehler: ${week.meta.error}` : note, week.meta?.error ? 'error' : 'ok');
    updateNavButtons();
  } catch (error) {
    // Sichtbar für den Nutzer *und* in der Konsole – sonst bleibt ein Fehler
    // wie „Invalid time value“ ohne Spur.
    console.error('[wochenplan] Laden fehlgeschlagen', error);
    setStatus(`Fehler beim Laden: ${error.message}`, 'error');
  }
}

function fillTimezones(selected, nurDiese = false) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['UTC', 'Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'America/New_York', 'Asia/Tokyo'];
  }
  if (nurDiese) zones = [selected];
  else if (selected && !zones.includes(selected)) zones = [selected, ...zones];
  els.timezone.replaceChildren();
  for (const zone of zones) {
    const option = document.createElement('option');
    option.value = zone;
    option.textContent = zone.replace(/_/g, ' ');
    if (zone === selected) option.selected = true;
    els.timezone.append(option);
  }
}

/**
 * Setzt die Pfeile an den Rändern des erzeugten Bereichs auf „nicht mehr“.
 * Ohne das endet der Klick auf eine nicht vorhandene Datei und die Seite
 * meldet „Server antwortete 404“ – auf GitHub Pages gibt es keinen Server,
 * die Meldung wäre doppelt falsch. Bei lokalem Betrieb bleibt die Liste leer,
 * dann darf weitergeblättert werden.
 */
function updateNavButtons() {
  const weeks = state.weeks;
  if (!weeks || !weeks.length) {
    els.prevWeek.disabled = false;
    els.nextWeek.disabled = false;
    return;
  }
  const index = weeks.indexOf(state.weekStart);
  els.prevWeek.disabled = index <= 0;
  els.nextWeek.disabled = index < 0 || index >= weeks.length - 1;
}

els.prevWeek.addEventListener('click', () => {
  state.weekStart = shiftWeek(state.weekStart, -1);
  loadWeek();
});
els.nextWeek.addEventListener('click', () => {
  state.weekStart = shiftWeek(state.weekStart, 1);
  loadWeek();
});
els.todayBtn.addEventListener('click', () => {
  state.weekStart = null;
  loadWeek();
});
els.timezone.addEventListener('change', () => {
  state.timezone = els.timezone.value;
  loadWeek();
});
els.detailClose.addEventListener('click', closeDetail);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDetail();
  if (event.target.tagName === 'SELECT') return;
  if (event.key === 'ArrowLeft') els.prevWeek.click();
  if (event.key === 'ArrowRight') els.nextWeek.click();
});

/**
 * Bei statischer Auslieferung prüft die Seite selbst, ob ein neuer Schnappschuss
 * da ist. Ohne das bliebe ein Tab, den jemand den ganzen Tag offen lässt, auf
 * dem Stand von heute Morgen stehen – nach dem Neuladen wäre plötzlich ein Raid
 * da, den vorher niemand gesehen hat. Beim lokalen Betrieb gibt es dafür nichts
 * zu tun: Der Server holt ohnehin bei jedem Aufruf frisch.
 */
async function watchForFreshData() {
  if (state.source !== 'file' || document.hidden) return;
  try {
    // `no-cache` ist hier entscheidend: Ohne das antwortet der Browser bis zu
    // zehn Minuten lang aus dem eigenen Cache, und die Prüfung bemerkt einen
    // neuen Schnappschuss erst dann, wenn jemand die Seite neu lädt. Die
    // Anfrage ist winzig und wird bei Unverändertheit mit 304 beantwortet.
    const probe = await fetch('data/latest.json', { cache: 'no-cache' });
    if (!probe.ok) return;
    const body = await probe.json();
    if (!body.generatedAt || body.generatedAt === state.generatedAt) return;

    state.generatedAt = body.generatedAt;
    if (!state.weekStart || state.weekStart === body.weekStart) {
      await loadWeek();
    } else {
      // Der Betrachter blättert gerade in einer anderen Woche. Ihn ungefragt
      // dorthin zu ziehen, wäre eine Überraschung – der Hinweis reicht.
      setStatus('Neuere Daten verfügbar – „Diese Woche" holt sie');
    }
  } catch {
    /* Kein Netz oder Seite im Übergang – beim nächsten Mal wieder. */
  }
}

fillTimezones(state.timezone);
loadWeek();
setInterval(watchForFreshData, 5 * 60_000);
// Wer den Tab aus dem Hintergrund zurückholt, soll nicht bis zum nächsten
// Fünf-Minuten-Takt warten.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) watchForFreshData();
});