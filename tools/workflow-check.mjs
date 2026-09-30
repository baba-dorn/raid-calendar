// Prüft die Workflow-Datei, bevor sie auf GitHub landet. Dort kostet ein
// Tippfehler in der Einrückung einen Lauf, der mit „workflow file issue“
// abbricht – ohne Zeilennummer, weil der Lauf gar nicht erst startet.
//
// Erfundener Fehler in dieser Datei: `env:` stand um zwei Leerzeichen
// eingerückt und hing damit an `permissions:` statt auf oberster Ebene.
// Genau das fängt die erste Regel ab.
import { readFileSync } from 'node:fs';

const pfad = process.argv[2] ?? '.github/workflows/publish.yml';
const zeilen = readFileSync(pfad, 'utf8').split(/\r?\n/);
const fehler = [];
const sichtbar = (s) => s.trim().length > 0 && !s.trim().startsWith('#');

/** Alle Schlüssel auf Spalte 0 – dort beginnen die Bausteine eines Laufs. */
const top = [];
for (const [i, roh] of zeilen.entries()) {
  if (!sichtbar(roh)) continue;
  const einrueckung = roh.length - roh.trimStart().length;
  if (einrueckung !== 0) continue;
  const treffer = roh.trim().match(/^([\w-]+):/);
  if (treffer) top.push({ zeile: i + 1, schluessel: treffer[1] });
}

const pflicht = ['on', 'permissions', 'jobs', 'env'];
for (const key of pflicht) {
  if (!top.some((t) => t.schluessel === key)) fehler.push(`Es fehlt ein Baustein auf Spalte 0: "${key}"`);
}

const envZeile = top.find((t) => t.schluessel === 'env');
if (envZeile) {
  for (let n = envZeile.zeile; n < zeilen.length; n += 1) {
    if (!sichtbar(zeilen[n])) continue;
    const roh = zeilen[n];
    if (roh.length - roh.trimStart().length === 0) break;
    // Jede Zeile unter `env:` bis zur nächsten Spalte-0-Zeile gehört dazu.
    if (!/^\s+[\w-]+:\s*.+$/.test(roh) && !/^\s+- /.test(roh)) {
      fehler.push(`Zeile ${n + 1}: steht unter "env:", gehoert aber nicht dorthin.`);
    }
  }
}

// Was GitHub am meisten ablehnt: eine unbekannte Fusselzeile.
const bekannt = new Set(['name', 'on', 'permissions', 'concurrency', 'env', 'jobs', 'defaults', 'run-name']);
for (const t of top) {
  if (!bekannt.has(t.schluessel)) fehler.push(`Zeile ${t.zeile}: unbekannter Baustein "${t.schluessel}".`);
}

// Jeder Schritt braucht `uses` oder `run`, sonst tut er nichts.
const text = zeilen.join('\n');
for (const pflichtteil of ['workflow_dispatch:', 'schedule:', 'actions/deploy-pages', 'tools/snapshot.mjs', 'upload-pages-artifact']) {
  if (!text.includes(pflichtteil)) fehler.push(`Fehlt: ${pflichtteil}`);
}
for (const [i, roh] of zeilen.entries()) {
  if (!/^\s+- name:/.test(roh)) continue;
  const weiter = zeilen.slice(i + 1, i + 12).join('\n');
  if (!/\b(uses|run):/.test(weiter)) fehler.push(`Zeile ${i + 1}: Schritt "${roh.trim()}" hat weder uses noch run.`);
}

const cron = text.match(/cron:\s*'([^']+)'/)?.[1] ?? '(keine)';

// Takt aus den Minutenangaben ableiten, nicht raten: "7,22,37,52" bedeutet
// alle 15 Minuten, "*/6" alle sechs Stunden. Für die Anzeige genügt der
// kleinste Abstand benachbarter Einträge – samt Sprung über die volle Stunde.
function takt(text) {
  const direkt = text.match(/^(\*|\d+)\/(\d+)/);
  if (direkt) return direkt[1] === '*' ? `alle ${direkt[2]} Minuten` : `jede ${direkt[2]}. Stunde`;
  const liste = text.split(/\s+/)[0].split(',').map(Number);
  if (liste.length < 2 || liste.some((n) => !Number.isInteger(n))) return 'unbekannt';
  const abstaende = liste.map((m, i) => (liste[(i + 1) % liste.length] - m + 60) % 60).filter((a) => a > 0);
  const kleinster = Math.min(...abstaende);
  return kleinster === 60 ? 'stuendlich' : `alle ${kleinster} Minuten`;
}

console.log(`Bausteine auf Spalte 0: ${top.map((t) => t.schluessel).join(', ')}`);
console.log(`cron "${cron}" -> ${takt(cron)}`);

if (fehler.length) {
  console.error(`\n${fehler.length} Problem(e):`);
  for (const f of fehler) console.error(`  ${f}`);
  process.exit(1);
}
console.log('Struktur in Ordnung.');
