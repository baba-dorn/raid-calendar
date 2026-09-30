// Legt eine erfundene Woche unter die echte API und misst das Layout darauf.
// Gedacht für Fälle, die echte Daten selten zeigen: drei Termine zur selben
// Zeit, eine Grundlinie mit einem Termin *mitten drin*, eine Nachtschicht über
// Mitternacht, ein Termin ohne Bild.
//
// Zwei Fehler sind nur hier aufgefallen und in den echten Wochen nicht:
//   - der horizontale Versatz im Packer lief je Termin statt je Spalte, sobald
//     eine Spalte zweimal belegt war, und schob eine Karte in den nächsten Tag;
//   - die Zeitzeile der Karte schnitt ab, sobald ein Coverbild den Text
//     verengte – eine `@container`-Abfrage sieht das Cover nicht.
//
// Aufruf (die leere Zeichenkette verschwindet in PowerShell, deshalb "0"):
//   node tools/shot.mjs http://127.0.0.1:3000/ tools/stress.png 1540 757 @tools/stress-week.js 0
(async () => {
  // Montag 28.09. … Sonntag 04.10. `date` muss ISO sein, sonst bricht die
  // Kopfzeile mit "Invalid time value" ab und der alte Stand bliebe stehen.
  const dates = [
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01',
    '2026-10-02', '2026-10-03', '2026-10-04',
  ];

  const day = (index, events) => ({
    date: dates[index],
    weekday: (index + 1) % 7, // 0 = Sonntag
    occurrences: events.map((event, i) => ({
      id: `stress-${index}-${i}`,
      name: event.name,
      startMinute: event.start,
      endMinute: event.end,
      endEstimated: event.estimated ?? false,
      canceled: event.canceled ?? false,
      recurring: event.recurring ?? false,
      lane: event.lane ?? 'public',
      image: event.image ?? null,
      spanNextDay: event.end > 1440,
      startTs: Date.parse(`${dates[index]}T00:00:00+02:00`),
    })),
  });

  const week = {
    weekStart: '2026-09-28',
    weekEnd: '2026-10-04',
    timezone: 'Europe/Berlin',
    generatedAt: new Date().toISOString(),
    lanes: [
      { id: 'public', label: 'Public', accent: '#5b8d3a', baseline: { days: ['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'], startMinute: 1170, endMinute: 1320 } },
      { id: 'late', label: 'Spaetschicht', accent: '#6b5bd2', baseline: { days: ['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'], startMinute: 1380, endMinute: 1500 } },
      { id: 'reset', label: 'Reset', accent: '#c98a2b', baseline: { days: ['FR'], startMinute: 1200, endMinute: 1410 } },
      { id: 'monthly', label: 'Monatlich', accent: '#3038a3', baseline: { days: ['Sa'], startMinute: 1020, endMinute: 1080 } },
    ],
    days: [
      // MO: zwei Termine genau gleichzeitig, unterschiedlich lang -> zwei Spalten,
      //      die längere bekommt mehr Breite
      day(0, [
        { name: 'Kurzer Event', start: 1140, end: 1200 },
        { name: 'Sehr langer Event am selben Abend', start: 1140, end: 1350, lane: 'late' },
      ]),
      // DI: drei Termine, von denen zwei nebeneinander und der dritte darunter
      //     in Spalte 0 passt -> derselbe Versatz muss zweimal gelten
      day(1, [
        { name: 'A', start: 1200, end: 1260 },
        { name: 'B', start: 1230, end: 1290 },
        { name: 'C', start: 1260, end: 1320 },
      ]),
      // MI: Termin *mitten* in der Grundlinie -> die Grundlinie zerfaellt in
      //     zwei Stuecke (vorher und nachher), beide ueber die volle Breite
      day(2, [{ name: 'Querbeet', start: 1200, end: 1260 }]),
      // DO: Nachtschicht ueber Mitternacht, die in der Spätschicht endet
      day(3, [{ name: 'Ueber-Mitternacht', start: 1380, end: 1500, lane: 'late' }]),
      // FR: Reset laeuft bis 23:45, die Spaetschicht laeuft weiter -> Rest
      //     darunter, genau der Fall aus der Wochenplanung
      day(4, [{ name: 'Reset-Raid', start: 1170, end: 1425, lane: 'reset' }]),
      // SA: Termin endet genau, wo die Grundlinie weiterlaeuft
      day(5, [{ name: 'Der ultimative Speed-Dating Raid', start: 1020, end: 1260, lane: 'monthly' }]),
      // SO: nichts -> beide Grundlinien in voller Breite
      day(6, []),
    ],
  };

  const original = window.fetch;
  window.fetch = async (url, ...rest) => {
    if (String(url).includes('/api/week')) {
      return new Response(JSON.stringify(week), { headers: { 'content-type': 'application/json' } });
    }
    return original(url, ...rest);
  };

  // Über den Wochenpfeil ein Neuladen auslösen: die App holt ihre Daten dort.
  document.getElementById('nextWeek').click();

  for (let i = 0; i < 60 && document.querySelectorAll('.ev').length < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 400));

  const names = ['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'];
  const columns = [...document.querySelectorAll('.grid-day')];
  const nodes = [...document.querySelectorAll('.ev, .slot')].map((node) => ({
    kind: node.classList.contains('ev') ? 'ev' : 'slot',
    box: node.getBoundingClientRect(),
    day: names[columns.indexOf(node.parentElement)] ?? '?',
    label: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 30),
  }));

  // Jede Ueberdeckung zaehlt, auch die von Karte ueber Grundlinie. Genau die
  // Ausnahme hat den urspruenglichen Fehler durchgelassen.
  const clashes = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const x = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const y = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (x > 1 && y > 1) clashes.push(`${a.day} ${a.kind} "${a.label}" x ${b.day} ${b.kind} "${b.label}"`);
    }
  }

  // Abgeschnittene Uhrzeiten: am Zeitraum darf nichts fehlen.
  const abgeschnitten = [];
  for (const card of document.querySelectorAll('.ev')) {
    const time = card.querySelector('.ev-time');
    if (time && time.scrollWidth > time.clientWidth + 1) abgeschnitten.push(time.textContent);
  }

  return {
    ueberlappungen: clashes,
    abgeschnitteneZeiten: abgeschnitten,
    zuSchmal: nodes.filter((n) => n.box.width < 40).map((n) => `${n.day} ${n.kind} ${n.label}`),
    karten: nodes.map(
      (n) => `${n.day} ${n.kind.padEnd(4)} ${String(Math.round(n.box.width)).padStart(3)}px  y ${String(Math.round(n.box.top)).padStart(3)}..${String(Math.round(n.box.bottom)).padStart(3)}  ${n.label}`,
    ),
  };
})()