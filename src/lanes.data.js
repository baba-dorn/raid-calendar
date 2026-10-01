/**
 * `lanes.json` für Laufzeiten ohne Dateisystem.
 *
 * Der Worker bekommt die Spurendatei mit ins Bundle geliefert; unter Node liest
 * `src/lanes.js` weiterhin von der Platte. Diese Datei wird nur vom Worker
 * importiert – und von `tools/worker-check.mjs`, das den Worker in Node
 * nachstellt und deshalb denselben Weg nehmen muss.
 *
 * Das Import-Attribut macht den JSON-Import für Node lesbar; der Bundler
 * liefert ohnehin ein Objekt. `JSON.stringify` deckt beide Fälle ab, falls
 * jemand in `wrangler.jsonc` eine `Text`-Regel für `*.json` einträgt – dann
 * käme hier ein String an, und genau den kann die Spurendatei nicht als
 * Objekt benutzen.
 */
import roh from '../lanes.json' with { type: 'json' };

export const LANES_TEXT = typeof roh === 'string' ? roh : JSON.stringify(roh, null, 2);