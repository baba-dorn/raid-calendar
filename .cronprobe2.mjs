const b = 'https://discord-week-calendar.joachim-happel.workers.dev';
const MIN = 60000, jetzt = Date.now();
// Naechstes Raster :x5, davor 25 Sekunden Luft - damit liegt der Aufruf sicher
// im 60-Sekunden-Fenster, in dem der Worker die KV unangetastet ausliefert.
const minute = Math.floor(jetzt / MIN), sek = jetzt % MIN;
let bis = (Math.floor(minute / 5) * 5 + 5) * MIN - 25000;
if (bis <= jetzt) bis += 5 * MIN;
console.log('Jetzt: %s | warte bis %s (25 s nach dem Raster)', new Date(jetzt).toISOString(), new Date(bis).toISOString());
await new Promise(r => setTimeout(r, bis - jetzt));
const abfrage = new Date();
const w = await (await fetch(b + '/api/week')).json();
const datiert = Date.parse(w.meta.fetchedAt);
const differenz = Math.round((abfrage - datiert) / 1000);
console.log('Abfrage um      : %s', abfrage.toISOString());
console.log('fetchedAt       : %s', w.meta.fetchedAt);
console.log('Differenz       : %d s', differenz);
console.log('Termine: %d | spuren=%s stale=%s fehler=%s', w.days.flatMap(d => d.occurrences).length, w.meta.lanes, w.meta.stale, w.meta.error);
if (differenz > 8 && differenz < 90) {
  console.log('=> BEWEIS: Dieser Aufruf hat nicht selbst geholt, sondern die Daten gelesen,');
  console.log('   die der Zeitplan %d Sekunden vorher geschrieben hat.', differenz);
} else if (differenz <= 8) {
  console.log('=> KEIN BEWEIS: Der Aufruf hat selbst geholt (Differenz %d s).', differenz);
} else {
  console.log('=> UNKLAER: %d s Unterschied - entweder Cron verspaetet oder KV haengt.', differenz);
}
