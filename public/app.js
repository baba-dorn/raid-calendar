const dateFromKey = (key) => new Date(`${key}T00:00:00Z`);

const fmt = (options) => new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', ...options });

const els = {
  guildIcon: document.getElementById('guildIcon'),
  guildName: document.getElementById('guildName'),
  brandMeta: document.getElementById('brandMeta'),
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
};

const PX_PER_MIN = 46 / 60;
const LANE_PADDING = 4;
const MIN_BLOCK_HEIGHT = { span: 66, day: 46 };

const ENTITY_META = {
  VOICE: { label: 'Voice-Event', glyph: '🔊', hues: [268, 250, 210, 190] },
  STAGE_INSTANCE: { label: 'Bühne', glyph: '🎙️', hues: [300, 320, 340, 265] },
  EXTERNAL: { label: 'Extern', glyph: '📍', hues: [95, 130, 150, 78] },
};

const EMOJI_HINT = /^([\p{Extended_Pictographic}][️‍\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*)\s*/u;

/* ------------------------------------------------------------------ *
 * Hilfsfunktionen
 * ------------------------------------------------------------------ */

function splitEmoji(name) {
  const match = EMOJI_HINT.exec(name);
  if (!match) return { glyph: null, title: name };
  return { glyph: match[1], title: name.slice(match[0].length).trim() || name };
}

function clock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function timeRange(block) {
  const end = block.spansNextDay ? block.endClockMinute : block.endMinute;
  const suffix = block.spansNextDay ? ' Uhr (+1 Tag)' : ' Uhr';
  return `${clock(block.startMinute)} – ${clock(end)}${suffix}`;
}

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** Discord-Kürzel ("FR") -> Anzeigename; die Zählung folgt dem Event-Datum. */
const CODE_TO_WEEKDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Beschreibt den Rhythmus in Worten. Entscheidend ist `frequency` – ein
 * monatliches Event darf nicht wie ein wöchentliches beschriftet werden.
 */
function rhythmLabel(block) {
  const rule = block.recurrence;
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

/** Oberzeile eines Blocks: Rhythmus, wenn vorhanden – sonst die Uhrzeit. */
function blockTimeLine(block) {
  const rhythm = rhythmLabel(block);
  return rhythm ? `${rhythm} · ${timeRange(block)}` : timeRange(block);
}

function accentFor(eventId, entityType) {
  if (state.accentById.has(eventId)) return state.accentById.get(eventId);
  const hues = ENTITY_META[entityType]?.hues ?? [270];
  let hash = 0;
  for (const ch of eventId) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const value = `hsl(${hues[hash % hues.length]} 74% 63%)`;
  state.accentById.set(eventId, value);
  return value;
}

function firstSentence(text) {
  if (!text) return null;
  const trimmed = text.trim().split(/\s+/).join(' ');
  const cut = trimmed.search(/[.!?](\s|$)/);
  return cut > 0 ? trimmed.slice(0, cut + 1) : trimmed.slice(0, 90);
}

function shiftWeek(weekStart, weeks) {
  const date = dateFromKey(weekStart);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Layout: Ereignisse zu Spuren (Lanes) gruppieren
 * ------------------------------------------------------------------ */

/** Termine, die an allen sieben Tagen stattfinden, werden zu einem Block. */
function buildBlocks(week) {
  const byEvent = new Map();

  for (const day of week.days) {
    for (const occurrence of day.occurrences) {
      const list = byEvent.get(occurrence.eventId) ?? [];
      list.push({ ...occurrence, dayIndex: day.index, weekday: day.weekday, date: day.date });
      byEvent.set(occurrence.eventId, list);
    }
  }

  const blocks = [];
  for (const [eventId, items] of byEvent) {
    items.sort((a, b) => a.startMinute - b.startMinute);

    if (items.length === 7) {
      const first = items[0];
      blocks.push({
        kind: 'span',
        eventId,
        name: first.name,
        description: first.description,
        status: first.status,
        entityType: first.entityType,
        location: first.location,
        image: first.image,
        userCount: first.userCount,
        url: first.url,
        channelUrl: first.channelUrl,
        endIsEstimated: first.endIsEstimated,
        startMinute: first.startMinute,
        endMinute: first.spansNextDay ? 1440 : first.endMinute,
        endClockMinute: first.endClockMinute,
        spansNextDay: first.spansNextDay,
        recurring: true,
        recurrence: first.recurrence,
        alwaysDaily: true,
        occurrences: items,
      });
      continue;
    }

    for (const item of items) {
      blocks.push({ ...item, kind: 'day' });
    }
  }

  return blocks;
}

function conflicts(a, b) {
  const overlap = a.startMinute < b.endMinute && b.startMinute < a.endMinute;
  if (!overlap) return false;
  if (a.kind === 'span' || b.kind === 'span') return true;
  return a.dayIndex === b.dayIndex;
}

function assignLanes(blocks) {
  blocks.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

  const lanes = [];
  for (const block of blocks) {
    const lane = lanes.find((candidate) => candidate.every((other) => !conflicts(other, block)));
    if (lane) lane.push(block);
    else lanes.push([block]);
  }
  return lanes;
}

/* ------------------------------------------------------------------ *
 * Darstellung
 * ------------------------------------------------------------------ */

function renderBlock(block) {
  const { glyph, title } = splitEmoji(block.name);
  const accent = accentFor(block.eventId, block.entityType);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `block block--${block.kind}`;
  button.style.setProperty('--accent', accent);
  if (block.kind === 'day') {
    const width = 100 / 7;
    button.style.left = `calc(${block.dayIndex * width}% + 3px)`;
    button.style.width = `calc(${width}% - 6px)`;
  }
  if (block.status === 'ACTIVE') button.classList.add('block--active');

  const time = document.createElement('span');
  time.className = 'block-time';
  time.textContent = block.alwaysDaily
    ? `Täglich ca. ${timeRange(block)}`
    : blockTimeLine(block);

  const titleEl = document.createElement('span');
  titleEl.className = 'block-title';
  titleEl.textContent = title;

  const noteText = block.location ?? firstSentence(block.description);
  let note = null;
  if (noteText) {
    note = document.createElement('span');
    note.className = 'block-note';
    note.textContent = noteText;
  }

  const badge = block.userCount !== null && block.userCount !== undefined
    ? `${block.userCount} dabei`
    : block.status === 'ACTIVE'
      ? 'läuft'
      : null;

  const icon = document.createElement('span');
  icon.className = 'block-icon';
  icon.textContent = glyph ?? ENTITY_META[block.entityType]?.glyph ?? '📅';

  const text = document.createElement('span');
  text.className = 'block-text';
  text.append(time, titleEl);
  if (note) text.append(note);

  button.append(icon, text);
  if (badge) {
    const badgeEl = document.createElement('span');
    badgeEl.className = 'block-badge';
    badgeEl.textContent = badge;
    button.append(badgeEl);
  }

  button.addEventListener('click', () => openDetail(block));
  return button;
}

function weekdayName(weekday) {
  // 0 = Sonntag. Datum 1970-01-04 war ein Sonntag.
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short' }).format(
    new Date(Date.UTC(1970, 0, 4 + weekday)),
  );
}

function renderBoard(week) {
  const blocks = buildBlocks(week);
  els.boardBody.replaceChildren();

  if (blocks.length === 0) {
    const problem = week.meta?.problem;
    const empty = document.createElement('div');
    empty.className = 'block-empty';

    if (problem) {
      empty.classList.add('block-empty--error');
      empty.innerHTML = `
        <strong>${escapeHtml(problem.title)}</strong>
        <span>${escapeHtml(problem.hint)}</span>
        <span class="block-empty-note">Technisch: ${escapeHtml(week.meta.error ?? '')}</span>
        <a class="block-empty-link" href="/api/health" target="_blank" rel="noopener">Diagnose öffnen</a>
      `;
    } else {
      empty.textContent = 'Für diese Woche sind in Discord keine Events eingetragen.';
    }

    els.boardBody.append(empty);
    return;
  }

  for (const lane of assignLanes(blocks)) {
    const laneTop = Math.min(...lane.map((b) => b.startMinute));
    const laneBottom = Math.max(...lane.map((b) => b.endMinute));
    let laneHeight = Math.max((laneBottom - laneTop) * PX_PER_MIN, 30) + LANE_PADDING * 2;

    for (const block of lane) {
      block.height = Math.max(
        (block.endMinute - block.startMinute) * PX_PER_MIN,
        MIN_BLOCK_HEIGHT[block.kind],
      );
      laneHeight = Math.max(
        laneHeight,
        (block.endMinute - laneTop) * PX_PER_MIN + block.height + LANE_PADDING,
      );
    }

    const laneEl = document.createElement('div');
    laneEl.className = 'lane';
    laneEl.style.height = `${Math.round(laneHeight)}px`;

    for (const block of lane) {
      const el = renderBlock(block);
      const top = Math.min(
        (block.startMinute - laneTop) * PX_PER_MIN,
        laneHeight - block.height,
      );
      el.style.top = `${Math.max(0, Math.round(top))}px`;
      el.style.height = `${Math.round(block.height)}px`;
      laneEl.append(el);
    }
    els.boardBody.append(laneEl);
  }
}

function renderHead(week) {
  els.boardHead.replaceChildren();

  for (const day of week.days) {
    const head = document.createElement('div');
    const isWeekend = day.weekday === 0 || day.weekday === 6;
    head.className = `day-head${isWeekend ? ' day-head--weekend' : ''}${day.isToday ? ' day-head--today' : ''}`;
    head.style.setProperty('--day-accent', day.isToday ? 'var(--violet)' : isWeekend ? 'var(--gold)' : 'var(--line)');

    const name = document.createElement('span');
    name.className = 'day-name';
    name.textContent = weekdayName(day.weekday);

    const date = document.createElement('span');
    date.className = 'day-date';
    date.textContent = fmt({ day: '2-digit', month: '2-digit' }).format(dateFromKey(day.date));

    head.append(name, date);
    els.boardHead.append(head);
  }
}

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
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    els.brandMeta.append(dt, dd);
  }
}

function renderLegend(week) {
  const used = new Set(week.days.flatMap((day) => day.occurrences.map((o) => o.entityType)));
  els.legend.replaceChildren();

  for (const type of used) {
    const meta = ENTITY_META[type] ?? { label: type, glyph: '📅', hues: [270] };
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span>${meta.glyph}</span><strong>${meta.label}</strong>`;
    els.legend.append(item);
  }

  const hint = document.createElement('div');
  hint.className = 'legend-item';
  hint.innerHTML = '<span>💡</span><span>Termin anklicken für Details · ‹ › blättern die Woche</span>';
  els.legend.append(hint);

  if (week.meta?.source === 'demo') {
    const note = document.createElement('div');
    note.className = 'legend-item';
    note.innerHTML =
      '<span>⚠️</span><span><strong>Demo-Modus</strong> – zum Live-Betrieb <code>DISCORD_TOKEN</code> und <code>DISCORD_GUILD_ID</code> in der <code>.env</code> setzen.</span>';
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

function openDetail(block) {
  const { glyph, title } = splitEmoji(block.name);
  const accent = accentFor(block.eventId, block.entityType);
  const meta = ENTITY_META[block.entityType] ?? { label: block.entityType, glyph: '📅' };
  const tz = state.data?.timezone;

  const parts = [glyph ?? meta.glyph, title].filter(Boolean).join(' ');

  const when = block.kind === 'span'
    ? `Täglich · ${timeRange(block)}`
    : `${weekdayName(block.weekday ?? 1)}, ${fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(dateFromKey(block.date ?? state.data.weekStart))} · ${timeRange(block)}`;

  const rows = [
    ['Wann', when],
    rhythmLabel(block) ? ['Rhythmus', rhythmLabel(block)] : null,
    ['Art', meta.label],
    block.location ? ['Ort', block.location] : null,
    block.userCount !== null && block.userCount !== undefined
      ? ['Teilnehmende', `${block.userCount}`]
      : null,
    ['Status', block.status === 'ACTIVE' ? 'läuft gerade' : 'geplant'],
  ].filter(Boolean);

  const rowHtml = rows
    .map(([label, value]) => `<div class="detail-row"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');

  els.detailContent.innerHTML = `
    ${block.image ? `<img class="detail-cover" src="${block.image}" alt="">` : ''}
    <div class="detail-kind" style="--accent:${accent}">${meta.label}${block.recurring ? ' · wiederkehrend' : ''}</div>
    <h2 class="detail-title">${escapeHtml(parts)}</h2>
    <div class="detail-rows">${rowHtml}</div>
    ${block.description ? `<p class="detail-description">${escapeHtml(block.description)}</p>` : ''}
    <div class="detail-actions" style="--accent:${accent}">
      ${block.url ? `<a href="${block.url}" target="_blank" rel="noopener">In Discord öffnen</a>` : ''}
      ${block.channelUrl ? `<a href="${block.channelUrl}" target="_blank" rel="noopener">Zum Kanal</a>` : ''}
    </div>
    <p class="block-note" style="margin-top:18px">Zeiten in ${escapeHtml(tz ?? '')}${block.endIsEstimated ? ' · Endzeit geschätzt (in Discord nicht gesetzt)' : ''}</p>
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

async function loadWeek() {
  setStatus('Lade Termine …', 'loading');
  const params = new URLSearchParams();
  if (state.weekStart) params.set('start', state.weekStart);
  if (state.timezone) params.set('tz', state.timezone);

  try {
    const response = await fetch(`/api/week?${params}`);
    if (!response.ok) throw new Error(`Server antwortete ${response.status}`);
    const week = await response.json();

    state.weekStart = week.weekStart;
    state.timezone = week.timezone;
    els.timezone.value = week.timezone;
    render(week);

    const note = week.meta?.stale
      ? `Stand ${new Date(week.meta.fetchedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} (veraltet)`
      : `Stand ${new Date(week.generatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    setStatus(week.meta?.error ? `Fehler: ${week.meta.error}` : note, week.meta?.error ? 'error' : 'ok');
  } catch (error) {
    setStatus(`Fehler beim Laden: ${error.message}`, 'error');
  }
}

function fillTimezones(selected) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['UTC', 'Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'America/New_York', 'Asia/Tokyo'];
  }
  if (selected && !zones.includes(selected)) zones = [selected, ...zones];
  els.timezone.replaceChildren();
  for (const zone of zones) {
    const option = document.createElement('option');
    option.value = zone;
    option.textContent = zone.replace(/_/g, ' ');
    if (zone === selected) option.selected = true;
    els.timezone.append(option);
  }
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

fillTimezones(state.timezone);
loadWeek();
setInterval(loadWeek, 5 * 60_000);
