/**
 * Prueft die Geometrie des Bretts: keine Karte darf eine andere verdecken.
 * Ueberlappungen sieht man auf einem Screenshot nur, wenn man gezielt danach
 * sucht – deshalb dieses Skript statt des Auges.
 *
 * Aufruf (JSON erscheint auf der Konsole, nebenbei entsteht ein Bild):
 *   node tools/shot.mjs http://127.0.0.1:3000/ tools/board-live.png 1500 950 @tools/layout-check.js
 *
 * Jede Ueberlappung ist ein Fehler. Vorher galt das nur zwischen zwei Karten
 * derselben Art: eine Terminkarte durfte einen Slot ueberdecken, weil die
 * Slots ueber die volle Breite unter die Karten gelegt wurden. Seit beide
 * gemeinsam durch `packDay` gehen und sich Spalten teilen, darf sich gar nichts
 * mehr ueberdecken.
 */
(() => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const overlapsX = (a, b) => a.left < b.right - 1 && b.left < a.right - 1;

  const clashes = [];
  const grown = [];

  for (const day of document.querySelectorAll('.grid-day')) {
    const nodes = [...day.querySelectorAll('.ev, .slot')].map((el) => ({
      el,
      kind: el.classList.contains('slot') ? 'slot' : 'ev',
      name: el.title?.split('\n')[1] ?? el.textContent.trim().slice(0, 30),
      ...box(el),
    }));

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (!overlapsX(a, b)) continue;
        if (!(a.top < b.bottom - 1 && b.top < a.bottom - 1)) continue;
        clashes.push(
          `${a.kind} "${a.name}" (${Math.round(a.top)}–${Math.round(a.bottom)})` +
            ` x ${b.kind} "${b.name}" (${Math.round(b.top)}–${Math.round(b.bottom)})`,
        );
      }
    }

    for (const node of nodes) {
      if (node.kind !== 'ev') continue;
      const declared = node.el.querySelector('.ev-time')?.textContent ?? '';
      const box3 = node.el.getBoundingClientRect();
      grown.push(`${declared.padEnd(20)} ${Math.round(box3.height)}px  ${node.name}`);
    }
  }

  // Abgeschnittene Namen. Zwei Faelle sind zu unterscheiden:
  //
  //   – die Karte ist schlicht zu niedrig. Dann ist das Kuerzen richtig
  //     ("lieber ein ... als eine ueberlappende Karte") und kein Fehler.
  //   – die Karte haette Platz gehabt, der Name wurde trotzdem gekappt. Das
  //     ist ein Fehler: eine zu kleine Zeilenzahl im Deckel.
  const gekappt = [];
  const zuKlein = [];
  for (const card of document.querySelectorAll('.ev')) {
    const title = card.querySelector('.ev-title');
    if (!title) continue;

    const shown = Math.round(title.scrollHeight / 17);
    if (shown <= 0) continue;
    const allowed = Number(getComputedStyle(title).getPropertyValue('--title-lines')) || 3;

    card.style.setProperty('--title-lines', '40');
    const natural = Math.round(title.scrollHeight / 17);
    card.style.setProperty('--title-lines', String(allowed));
    if (natural <= shown) continue;

    // Wie viele Zeilen hätten in dieser Karte überhaupt Platz?
    const style = getComputedStyle(card);
    const inner = card.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const time = card.querySelector('.ev-time');
    const timeRows = Math.max(1, Math.round((time?.offsetHeight ?? 17) / 17));
    const room = Math.floor((inner - timeRows * 17) / 17);

    const label = `${allowed}: ${card.querySelector('.ev-time')?.textContent ?? ''} ${title.textContent}`;
    if (allowed >= room) gekappt.push(`${label} (natur ${natural}, platz ${room})`);
    else zuKlein.push(label);
  }

  // Typografie-Hierarchie: der Termin darf nicht kleiner wirken als die
  // Grundlinie, die ohnehin jede Woche laeuft.
  const fontOf = (sel, part) => {
    const node = document.querySelector(sel);
    return node ? Number.parseFloat(getComputedStyle(node)[part]) : null;
  };

  return {
    karten: document.querySelectorAll('.ev').length,
    slots: document.querySelectorAll('.slot').length,
    ueberlappungen: clashes,
    /** Zu kleiner Zeilen-Deckel: die Karte hätte den Namen getragen. */
    falschGekappt: zuKlein,
    /** Korrekt gekappt: die Karte ist zu niedrig dafür. */
    zuKurzFuerName: gekappt,
    schrift: {
      'ev-time': fontOf('.ev .ev-time', 'fontSize'),
      'ev-title': fontOf('.ev .ev-title', 'fontSize'),
      'slot-time': fontOf('.slot .slot-time', 'fontSize'),
      'slot-name': fontOf('.slot .slot-name', 'fontSize'),
    },
    kartenliste: grown,
  };
})()