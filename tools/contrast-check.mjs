/**
 * Misst, wie lesbar der Text wirklich ist – nicht nach Gefühl, sondern an den
 * Pixeln, die Chrome tatsächlich malt.
 *
 *   node tools/contrast-check.mjs [url] [breite] [hoehe]
 *
 * Zwei Durchgänge derselben Seite:
 *
 *  1. Einmal normal, um Rect und Schriftfarbe jedes Textblocks zu erfahren.
 *  2. Einmal mit unsichtbarem Text. Übrig bleibt genau das, was *hinter*
 *     dem Text liegt – Hintergrundbild, Schleier, Panel, Raster. Genau das
 *     wird als Hintergrundfarbe gewertet, statt es aus dem Stylesheet zu
 *     rechnen: die Deckkraft eines Panels über einem Bild stimmt sonst nur
 *     ungefähr, und "ungefähr lesbar" ist keine Angabe.
 *
 * Berichtet werden die WCAG-Kontraste. Unter 4,5:1 ist Fließtext zu dünn
 * (Großtext ab 18,66 px oder 14 px fett braucht 3:1), unter 3:1 fällt auch
 * eine große Überschrift durch.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
// Schalter wie --keep abfiltern, damit sie nicht als Breite gelesen werden.
const [url = 'http://127.0.0.1:3000/', width = '1540', height = '757'] = process.argv
  .slice(2)
  .filter((value) => !value.startsWith('--'));

const temp = mkdtempSync(join(tmpdir(), 'contrast-'));

/* ------------------------------------------------------------------ *
 * PNG lesen – nur was Chrome bei `Page.captureScreenshot` liefert
 * ------------------------------------------------------------------ */

/**
 * Gibt `{ width, height, pixel(x, y) }` zurück. Bewusst ohne Bibliothek:
 * `zlib` ist dabei, und alles andere (8 Bit, keine Verschränkung) ist eine
 * Schleife über die Scanlines.
 */
function readPng(file) {
  const bytes = readFileSync(file);
  let offset = 8; // die PNG-Signatur
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts = [];

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`PNG mit ${data[8]} Bit – nicht unterstützt.`);
      if (data[12] !== 0) throw new Error('Verschränktes PNG – nicht unterstützt.');
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[data[9]];
      if (!channels) throw new Error(`PNG-Farbtyp ${data[9]} – nicht unterstützt.`);
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let source = 0;

  // Zeile für Zeile rückwärts aufbauen. Jede Zeile nennt ihren Filter und
  // bezieht sich dabei auf die Zeile darüber und auf das Pixel links daneben –
  // deshalb lässt sich das nicht zeilenweise überspringen.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source];
    source += 1;
    const line = out.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x];
      const left = x >= channels ? line[x - channels] : 0;
      const up = prior ? prior[x] : 0;
      const upLeft = prior && x >= channels ? prior[x - channels] : 0;

      if (filter === 0) line[x] = value;
      else if (filter === 1) line[x] = (value + left) & 0xff;
      else if (filter === 2) line[x] = (value + up) & 0xff;
      else if (filter === 3) line[x] = (value + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        // Paeth: von linkem, oberem und diagonalem Nachbarn denjenigen
        // waehlen, der dem linearen Schaetzwert am naechsten liegt. Die drei
        // Abstaende sind je *ein* Vergleich, keine Summe – mit einer Summe
        // kommen bunte Zufallswerte heraus, wo das Bild dunkel ist.
        const estimate = left + up - upLeft;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toUpLeft = Math.abs(estimate - upLeft);
        const nearest = toLeft <= toUp && toLeft <= toUpLeft
          ? left
          : (toUp <= toUpLeft ? up : upLeft);
        line[x] = (value + nearest) & 0xff;
      } else throw new Error(`Unbekannter PNG-Filter ${filter}.`);
    }
    source += stride;
  }

  return {
    width,
    height,
    pixel(x, y) {
      const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
      const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
      const at = cy * stride + cx * channels;
      return [out[at], out[at + 1], out[at + 2]];
    },
  };
}

/* ------------------------------------------------------------------ *
 * Farbe
 * ------------------------------------------------------------------ */

/** WCAG 2.1 relative Leuchtdichte. */
function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [lighter, darker] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Farbe aus einem computed style. Deckt zwei Schreibweisen ab:
 *   `rgb(105, 158, 57)`            – Anteile 0…255
 *   `color(srgb 0.46 0.48 0.76)`  – Anteile 0…1
 * Die zweite Form entsteht, sobald ein `color-mix` im Spiel ist, und war
 * zunächst der Grund fuer vier kaputte Messungen: 0,46 als 8-Bit-Wert ist
 * fast schwarz, und die Schrift schien unsichtbar, obwohl sie hell war.
 */
const parseRgb = (value) => {
  const text = String(value).trim();
  const parts = text.match(/[\d.]+/g);
  if (!parts) return null;
  // Bei `color(...)` stehen die Anteile zwischen 0 und 1 und müssen auf 0…255
  // hochgerechnet werden; bei `rgb(...)` sind sie es schon.
  const toByte = (part) => {
    const number = Number(part);
    // Hier – ausserhalb der PROBE-Vorlage – ist ein einfacher Backslash richtig.
    // In der Vorlage muss er doppelt, sonst ist die Klammer unescaped.
    return Math.max(0, Math.min(255, Math.round(/^color\(/.test(text) ? number * 255 : number)));
  };
  return parts.slice(0, 3).map(toByte);
};

/* ------------------------------------------------------------------ *
 * Die beiden Ausdrücke, die in die Seite laufen
 * ------------------------------------------------------------------ */

const PROBE = `(() => {
  // Text, der nicht auf einer Fläche sitzt, sondern frei über dem Hintergrund –
  // genau der ist durch ein Bild gefährdet. Karten sind deckend, ihre Schrift
  // kann sich nicht aufdrängen, also prüft die Liste nur, was wirklich offen liegt.
  const SEL = [
    '.brand-name', '.brand-tagline', '.brand-meta dt', '.brand-meta dd', '.brand-lane-title',
    '.brand-lane-name', '.brand-lane-detail', '.brand-lane-link', '.brand-lanes-title',
    '.week-range', '.week-sub', '.tz-field select', '.status',
    '.day-name', '.day-date', '.grid-tick', '.legend', '.legend-item', '.legend strong',
    '.board-empty strong', '.board-empty span', '.board-empty-note',
    '.detail-kind', '.detail-title', '.detail-lane', '.detail-row dt', '.detail-row dd',
  ];

  // Beide Hilfen laufen in der Seite, nicht in Node – deshalb hier, nicht
  // weiter oben. Sonst meldet der Ausdruck \`parseRgb is not defined\`.
  // \`color-mix\` liefert \`color(srgb 0.46 0.48 0.76)\` mit Anteilen von 0 bis 1;
  // wer die als 8-Bit liest, haelt eine helle Schrift fuer schwarz.
  const parseRgb = (value) => {
    const text = String(value).trim();
    const parts = text.match(/[\\d.]+/g);
    if (!parts) return null;
    const toByte = (part) => {
      const number = Number(part);
      return Math.max(0, Math.min(255, Math.round(/^color\\(/.test(text) ? number * 255 : number)));
    };
    return parts.slice(0, 3).map(toByte);
  };
  const luminance = ([r, g, b]) => {
    const ch = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };

  // Erst alle gemessenen Elemente sammeln – weiter unten braucht die Liste,
  // um doppelt zu zaehlen zu vermeiden.
  const marked = new Set();
  for (const selector of SEL) for (const node of document.querySelectorAll(selector)) marked.add(node);

  const seen = [];
  for (const node of marked) {
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.opacity === '0') continue;

    // Gemessen wird die Zeile, nicht das Element. Der Kasten eines
    // \`.legend-item\` enthaelt den farbigen Punkt – und dieser Punkt liegt
    // mit 1,1:1 natuerlich immer unter der Schwelle, obwohl ueber ihm kein
    // Text steht. Ein Range um den Textknoten liefert genau die Zeilenboxen,
    // auf denen die Schrift wirklich sitzt.
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const rects = [];
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (text.parentElement !== node && marked.has(text.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (box.width > 1 && box.height > 1) rects.push({ x: box.x, y: box.y, w: box.width, h: box.height });
      }
    }
    if (!rects.length) continue;

    // Text, der als Verlauf gefuellt wird (.brand-name), gibt eine transparente
    // Fuellfarbe zurueck. Dann zaehlt die dunkelste Stufe des Verlaufs – sie
    // hat den schlechtesten Kontrast gegen ein dunkles Bild.
    let color = parseRgb(style.color);
    const fill = style.webkitTextFillColor;
    if (fill && !/^rgba\\(0, 0, 0, 0\\)$/.test(fill) && !/transparent/.test(fill)) {
      color = parseRgb(fill) ?? color;
    } else if (style.backgroundImage !== 'none') {
      const stops = [...style.backgroundImage.matchAll(/rgba?\\([^)]+\\)/g)].map((m) => parseRgb(m[0]));
      if (stops.length) color = stops.sort((a, b) => luminance(a) - luminance(b))[0];
    }
    if (!color) continue;

    seen.push({
      label: node.textContent.replace(/\\s+/g, ' ').trim().slice(0, 28) || node.className,
      selector: node.className,
      rects,
      color,
      size: parseFloat(style.fontSize),
      weight: Number(style.fontWeight) || 400,
    });
  }
  return seen;
})()`;

const HIDE = `(() => {
  // Nur die Schrift unsichtbar machen: Flaechen, Kanten und Bilder bleiben
  // stehen, damit genau das zurueckbleibt, was hinter dem Text liegt.
  const style = document.createElement('style');
  style.textContent = '* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }';
  document.head.append(style);

  // Sonderfall: Text, der als Verlauf gefuellt ist (.brand-name), steckt im
  // *Hintergrund* des Elements, per background-clip auf die Buchstaben
  // geschnitten. Ein transparentes color loescht ihn nicht - er laege danach
  // noch da und wuerde als Hintergrundfarbe gemessen, exakt in der Farbe der
  // Schrift. Also dort die Hintergrundebene wegnehmen.
  for (const node of document.querySelectorAll('*')) {
    if (getComputedStyle(node).webkitBackgroundClip === 'text') {
      node.style.setProperty('background-image', 'none', 'important');
      node.style.setProperty('background', 'none', 'important');
    }
  }
  return 'Text aus';
})()`;

/* ------------------------------------------------------------------ *
 * Durchlauf
 * ------------------------------------------------------------------ */

const OHNE_BILD = `
  // Vergleichslauf: Bild und Schleier weg, sonst alles unveraendert. Damit
  // laesst sich die Frage beantworten, ob das Hintergrundbild ueberhaupt
  // Kontrast kostet – oder ob ein Text auch ohne Bild zu dunkel waere.
  const style = document.createElement('style');
  style.textContent = 'body { background-image: none !important; background-color: var(--bg) !important; }';
  document.head.append(style);
`;

/** Ein Durchgang: Ausdruck in die Seite, Ergebnis zurück – und wahlweise ein Bild. */
const shoot = (name, expression) => {
  const js = join(temp, `${name}.js`);
  writeFileSync(js, expression);
  const output = execFileSync(
    process.execPath,
    // Leerer Ausschnitt statt "0": In Node ist ein leeres Argument wirklich
    // leer. Das "0" aus der PowerShell-Doku ist nur ein Ersatz dort, wo die
    // Shell leere Argumente verschluckt – hier käme es als 0×0-Ausschnitt an.
    [join(HERE, 'shot.mjs'), url, join(temp, `${name}.png`), width, height, `@${js}`, ''],
    { encoding: 'utf8' },
  );
  const line = output.split('\n').find((entry) => entry.startsWith('eval: '));
  if (!line) throw new Error(`Kein Ergebnis von shot.mjs:\n${output}`);
  const raw = line.slice(6);
  if (raw.includes('"className":"Error"') || raw.includes('exceptionDetails')) {
    throw new Error(`Ausdruck ${name} ist gescheitert:\n${raw}`);
  }
  return { value: JSON.parse(raw), file: join(temp, `${name}.png`) };
};

const probe = shoot('probe', PROBE).value;
const blocks = (Array.isArray(probe) ? probe : [probe]).filter((entry) => entry && typeof entry === 'object');
const hiddenFile = shoot('hidden-text', HIDE).file;
const background = readPng(hiddenFile);
if (process.argv.includes('--keep')) {
  // Das Bild ansehen, statt der Zahlen zu glauben: mit unsichtbarem Text ist
  // es genau die Fläche, gegen die gemessen wurde.
  copyFileSync(hiddenFile, join(HERE, 'contrast-bg.png'));
  console.log(`Bild mit unsichtbarem Text: ${join(HERE, 'contrast-bg.png')}`);
}

/** Misst dieselben Textbloecke gegen ein Bild. */
const measure = (image) => {
  const background = readPng(image);
  return blocks.map((block) => {
    // Was unterhalb oder rechts ausserhalb des Bildes liegt, wurde nicht
    // aufgenommen und darf nicht als "unendlich gut" durchgehen.
    const inside = block.rects.filter(
      (box) => box.x >= 0 && box.y >= 0 && box.x + box.w <= background.width + 1 && box.y + box.h <= background.height + 1,
    );
    if (!inside.length) return { ...block, worst: null, ratio: null, need: 0, ok: null };

    // Der ungünstigste Pixel in der Zeile: heller Hintergrund bei heller
    // Schrift ist der Fall, an dem die Zeile verschwindet.
    let worst = null;
    let worstRatio = Infinity;
    for (const box of inside) {
      const x0 = Math.max(0, Math.floor(box.x));
      const x1 = Math.min(background.width, Math.ceil(box.x + box.w));
      const y0 = Math.max(0, Math.floor(box.y));
      const y1 = Math.min(background.height, Math.ceil(box.y + box.h));

      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const backgroundColor = background.pixel(x, y);
          const ratio = contrast(block.color, backgroundColor);
          if (ratio < worstRatio) {
            worstRatio = ratio;
            worst = backgroundColor;
          }
        }
      }
    }

    // WCAG: grosses Fett >= 18,66 px, alles andere >= 24 px gilt als grosser Text.
    const large = block.size >= 24 || (block.size >= 18.66 && block.weight >= 700);
    return { ...block, worst, ratio: worstRatio, need: large ? 3 : 4.5, ok: worstRatio >= (large ? 3 : 4.5) };
  });
};

const results = measure(hiddenFile);
if (process.argv.includes('--vergleich')) {
  // Beide Läufe gehen über dieselbe `blocks`-Liste in derselben Reihenfolge,
  // also lässt sich nach Position vergleichen – nicht nach Objektidentität,
  // die sind zwei verschiedene Durchläufe.
  const ohneBild = measure(shoot('ohne-bild', HIDE + OHNE_BILD).file);
  results.forEach((entry, index) => {
    entry.ohne = ohneBild[index].ratio;
  });
}

const measured = results.filter((entry) => entry.ratio !== null);
const failed = measured.filter((entry) => !entry.ok);
const outside = results.length - measured.length;
measured.sort((a, b) => a.ratio - b.ratio);

const format = (ratio) => `${ratio.toFixed(2)}:1`.padStart(8);

console.log(`\nGeprüft: ${measured.length} Textblöcke bei ${width}×${height}` + (outside ? ` (${outside} außerhalb des Bildes, nicht gemessen)` : ''));
if (process.argv.includes('--vergleich')) console.log('Letzte Spalte: derselbe Text ohne Hintergrundbild, zum Vergleich.');
console.log('Schlechtester Kontrast zuerst\n');
for (const entry of measured) {
  const mark = entry.ok ? '  ' : '!!';
  const hintergrund = `rgb(${entry.worst.join(',')})`;
  // `== null` deckt undefined *und* null ab: Ohne --vergleich wurde `ohne`
  // nie gesetzt, und `=== null` waere dann wahr und raeume genau daran
  // wieder auf.
  const vergleich = typeof entry.ohne === 'number' ? `  (ohne Bild ${entry.ohne.toFixed(2)}:1)` : '';
  console.log(
    `${mark} ${format(entry.ratio)}  (nötig ${entry.need}:1)  ${String(entry.size).padStart(5)} px  ` +
    `${String(entry.selector).padEnd(16)} ${entry.label.padEnd(28)} ${entry.color.join(',').padEnd(13)} auf ${hintergrund}${vergleich}`,
  );
}
console.log(
  failed.length
    ? `\n${failed.length} von ${measured.length} unter der Schwelle.`
    : `\nAlle ${measured.length} über der Schwelle.`,
);
process.exit(failed.length ? 1 : 0);
