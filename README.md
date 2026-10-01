# Discord Wochenkalender

Liest die Events (Discord nennt sie *Guild Scheduled Events*) einer Guild über die
Discord-REST-API und zeigt sie als **Wochen-Raid-Board** im Web an: feste Spuren
mit Grundzeilen aus der Konfiguration, alles, was diese Woche anders ist, live
aus Discord.

Ohne Konfiguration startet der Server im **Demo-Modus** mit Beispieldaten, damit
die Seite sofort läuft.

## Schnellstart

```bash
cp .env.example .env    # unter Windows: copy .env.example .env
# .env ausfuellen (siehe unten)
npm start
```

Dann <http://127.0.0.1:300> öffnen. Es sind **keine npm-Abhängigkeiten** nötig –
das Projekt nutzt nur die Node-Standardbibliothek (Node 18 oder neuer).

## Discord einrichten

1. **Application anlegen** – <https://discord.com/developers/applications> → *New Application*.
2. **Bot-Token holen** – links *Bot* → *Reset Token* → in `.env` als `DISCORD_TOKEN` eintragen.
3. **Bot zum Server einladen** – auf der OAuth2-Seite die untenstehende URL verwenden
   und `CLIENT_ID` ersetzen. `permissions=1024` ist *View Channels*, was für das Lesen
   von Voice- und Stage-Events nötig ist:

   ```
   https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&scope=bot&permissions=1024
   ```

4. **Guild-ID ermitteln** – in Discord *Benutzereinstellungen → Erweitert → Entwicklermodus*
   aktivieren, dann den Server mit Rechtsklick → *Server-ID kopieren*. Diese ID kommt
   als `DISCORD_GUILD_ID` in die `.env`.

### Welche Berechtigungen werden wirklich gebraucht?

| Aktion | Recht |
| --- | --- |
| Events **lesen** | Bot muss im Server sein; für Voice-/Stage-Events `VIEW_CHANNEL` im Event-Kanal |
| Events **anlegen/ändern/löschen** | `CREATE_EVENTS` oder `MANAGE_EVENTS` – für diesen Kalender **nicht** nötig |

Externe Events (`entity_type: EXTERNAL`) sind ohne jede Kanal-Berechtigung sichtbar.

**Der häufigste Stolperstein:** `permissions=1024` beim Einladen setzt *View Channels*
nur für die öffentlichen Kanäle. Ein Voice-Event in einem geschlossenen Kanal
fehlt dann spurlos im Kalender – Discord liefert es nicht einmal, ohne zu
meckern. Deshalb braucht die Bot-Rolle `VIEW_CHANNEL` auch auf den Kanälen, in
denen tatsächlich gespielt wird: *Kanal → Zugriffsrechte → Raid Calendar →
Kanäle ansehen*. Ein nicht sichtbarer Kanal ist die häufigste Ursache für
„der Termin fehlt im Kalender, ist aber in Discord da“.

## Konfiguration

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `DISCORD_TOKEN` | – | Bot-Token, geheim halten |
| `DISCORD_GUILD_ID` | – | Server-ID |
| `TIMEZONE` | `Europe/Berlin` | Zeitzone der Anzeige |
| `WEEK_STARTS_ON` | `1` | `1` = Montag, `0` = Sonntag |
| `HOUR_HEIGHT` | `46` | Pixel je Stunde |
| `DEFAULT_DURATION_MINUTES` | `120` | Ersatzdauer, wenn Discord keine Endzeit setzt |
| `CACHE_TTL_MS` | `60000` | Cache-Dauer der Discord-Antwort |
| `LANES_FILE` | `lanes.json` | Pfad zur Spur-Konfiguration |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Webserver |

## Spuren (Farbe, nicht Layout)

Die Wochenansicht ist eine ganz normale Kalenderwoche: sieben Tagesspalten, eine
vertikale Zeitachse, jeder Termin an seiner echten Uhrzeit. **Kein Termin
verdrängt einen anderen** – ein Termin um 17:00 ersetzt keinen um 19:00, er
steht daneben. Einzige Ausnahme: was in Discord nicht steht, aber in
`lanes.json`, wird ergänzt statt ersetzt.

Eine *Spur* ist deshalb nur noch eine Farbe und ein Etikett. Damit beantwortet
die Karte sofort die Frage, die sich im normalen Kalender nicht stellt: *was ist
das hier für ein Termin?*

Alles dazu steht in [lanes.json](lanes.json):

`baseline` beschreibt den **gebuchten Slot**: die Regel, dass an bestimmten
Tagen zu bestimmten Zeiten etwas läuft. In Discord existiert dazu nichts – der
Slot kommt nur aus dieser Datei. Er wird als eigene Karte gezeichnet, weil es
ein echtes Raid ist, und verschwindet, sobald ein Event mehr als die Hälfte des
Fensters belegt.

```json
{
  "id": "public",
  "label": "Public",
  "host": "mit Dorn",
  "glyph": "🌙",
  "accent": "#8fdc4a",
  "match": ["public"],
  "baseline": { "days": ["MO", "TU", "WE", "TH", "FR", "SA", "SU"], "start": "19:00", "end": "22:30" }
}
```

`baseline.days` nimmt Wochentags-Kürzel, `start`/`end` sind `"HH:MM"`. Liegt
`end` vor `start` (23:00 → 01:30), gilt der Slot als über Mitternacht; gezeichnet
wird er als Block, der unter die 24-Uhr-Linie ragt. Ohne `baseline` ist die Spur
eine reine Farbe ohne Slot.

> **Kürzel sind gleichgültig, verglichen wird über die Nummer.** Sowohl die
> englischen (`MO`, `TU`, `WE`, `TH`, `SU`) als auch die deutschen
> (`DI`, `MI`, `DO`, `SO`) Schreibweisen gehen. Das ist Absicht: In `lanes.json`
> steht nebeneinander `["MO", "TU", "WE", "TH", "FR", "SA", "SU"]` und `["Fr"]`,
> und ein Vergleich über den geschriebenen Kürzel (`days.includes("SA")`) hätte
> die zweite Spur stillschweigend nie laufen lassen. Ein Kürzel, das wirklich
> keinem Wochentag entspricht, meldet sich jetzt in der Konsole – vorher ist es
> einfach weggefallen, samt der Raid, die daran hing.

`voiceChannel` ist optional und nimmt die Kanal-ID als Zeichenkette:

```json
"voiceChannel": "1268920421403594832"
```

### Endzeiten, die Discord nicht kennt

`assignments` ist die Liste, in der einzelne Termine einer Spur zugeordnet
werden. Dort gibt es zusätzlich `end` – die Endzeit, falls Discord keine
hinterlegt hat:

```json
"assignments": [
  { "match": "Abschiedsraid", "lane": "public" },
  { "match": "Speed.?Dating", "lane": "public", "end": "19:00" }
]
```

Vier Regeln dazu, in dieser Reihenfolge:

| Fall | Ergebnis |
| --- | --- |
| `end` gesetzt, Discord hat keine Endzeit | Regel gilt, im Detailpanel als *Zuordnung* ausgewiesen |
| `end` gesetzt, Discord **hat** eine Endzeit | Discord gewinnt, `end` bleibt wirkungslos |
| `end` gesetzt und Slot vorhanden | `end` schlägt die Grundzeile – es ist das Genauere |
| `end` vor dem Start (23:00, `01:30`) | Endzeit liegt am Folgetag |

`end` ist eine **Uhrzeit, keine Dauer**. Der Start steht durch den Termin selbst
fest, also genügt die Uhrzeit; eine Angabe wie `"2h"` gibt es bewusst nicht.
Weil Discord die Endzeit nicht bestätigt hat, bleibt das `≈` stehen – die Regel
sagt, was wir glauben, nicht was Discord weiß.

Die Markenspalte zeigt jede Spur mit Slot unter **Feste Raids** – Rhythmus,
Uhrzeit, Hosts – und verlinkt sie direkt auf den Sprachkanal. Fehlt die ID, gibt
es den Sprung nicht.

### Woher weiß ein Discord-Event, welche Spur es hat?

Discord kennt kein Feld `lane`. Die Zuordnung entsteht deshalb in vier Stufen –
und **erst ganz zuletzt** wird auf Uhrzeiten zurückgefallen:

1. **Tag im Namen** – `[PUBLIC] Arc Abschiedsraid`. Erkannt werden `PUBLIC`,
   `LATE`, `SPAET(SCHICHT)`, `NACHT`, `RESET`, `KOMMI` sowie `SPECIAL`/`ZUSATZ`
   (ausdrücklich ohne Spur) und `ENTFAELLT`/`AUSFALL`/`CANCELED` (Ausfall). Tags
   mit Klammern `()` gehen genauso, Umlaute dürfen fehlen (`[SPAET]`). Bekannte
   Tags verschwinden aus dem Kartentitel.
2. **Zuordnung in `lanes.json`** – für Events, die sich nicht sinnvoll umbenennen
   lassen: `{ "match": "Abschiedsraid", "lane": "public" }`. `match` ist ein Regex
   auf Name, Beschreibung und Ort, `id` trifft die Discord-Event-ID.
3. **Namensmuster der Spur** – `match` in der Spur selbst, z. B. `["reset"]`.
4. **Zeitliche Überlappung** – Notfall. Nur wenn 1–3 nichts finden: überlappt der
   Termin das `baseline`-Fenster, gehört er zu dieser Spur.

Passt keine Stufe, bleibt die Karte in der Farbe des Termintyps (Voice, Bühne,
extern). Die Zuordnung kann nie eine Position, eine Größe oder eine Sichtbarkeit
verändern – sie setzt ausschließlich Farbe und Etikett.

## Wie die Daten fließen

```
Discord REST API
  GET /api/v10/guilds/{guild.id}/scheduled-events?with_user_count=true
        │
        ▼
src/discord.js      Auth, 429-Handling, Normalisierung
        │
        ▼
src/recurrence.js   klappt recurrence_rule auf einzelne Termine auf
src/timezone.js     Zeitzone, Tagesnummern, DST-sichere Umrechnung
src/calendar.js     gruppiert nach Wochentag, rechnet Wanduhr-Minuten
src/lanes.js        schreibt laneId und Status an jeden Termin
        │
        ▼
GET /api/week?start=YYYY-MM-DD&tz=Europe/Berlin
        │
        ▼
public/app.js       Zeitachse (stückweise linear), Tagesspalten, Karten
```

Derselbe Weg läuft in drei Ausprägungen: lokal aus `server.js`, auf GitHub Pages
aus `tools/snapshot.mjs` (Dateien statt API) und auf Cloudflare aus
`src/worker.js`, wo der Zeitplan in die KV schreibt und `/api/week` nur noch
liest. Unterschiedlich ist jeweils nur, wo der Schnappschuss liegt.

### API

| Route | Zweck |
| --- | --- |
| `GET /api/week?start=YYYY-MM-DD&tz=…` | Wochenmodell: `days[]`, `lanes[]` (Metadaten der Spuren) |
| `GET /api/config` | effektive Konfiguration |
| `GET /api/health` | Kurzstatus |
| `POST /api/refresh` | nur im Worker: holt sofort neu, statt auf den Zeitplan zu warten |

`start` und `tz` sind optional; ohne `start` liefert der Server die aktuelle Woche.

## Besonderheiten

- **Das Hintergrundbild ist ein Raum, kein Inhalt.** `public/raid-calendar-bg.png`
  liegt hinter allem, durch einen Schleier aus zwei dunklen Farbverläufen
  (`--scrim-top` / `--scrim-bottom`). Der Schleier ist nicht Geschmack, sondern
  die Bedingung dafür, dass Text lesbar bleibt: Ohne ihn läge Weiß auf dem hellen
  Violett oben links. Er ist mit **0,52 / 0,68** bewusst schwach gehalten –
  das Bild ist an den Rändern zu sehen, wo kein Text steht, und sonst nirgends.
  **Die großen Flächen sind deckend, nicht transparent.** Markenspalte, Brett und
  Legende mischen gegen `--surface-solid` statt gegen `transparent`; sonst
  schiene das Bild durch sie und die Schrift stünde auf einem Streifen Kunst.
  Dasselbe gilt für die Karten: Sie mischen gegen `--board`, damit die
  Stundenlinien an der Kartenkante enden statt hindurchzulaufen.
- **Die Zeitachse ist stückweise linear.** Belegte Zeit (Events und Slots, auf
  irgendeinem Tag) behält ihre echte Länge. Alles Dazwischen wird auf 30 %
  zusammengedrückt und verliert seine Rasterlinien – dort steht nichts, also
  soll das Raster auch nichts behaupten. Die Entscheidung fällt **wochenweit**:
  gibt es an *irgendeinem* Tag etwas zwischen 12 und 17 Uhr, bleibt das Fenster
  offen; gibt es nirgends etwas, kollabiert es für alle sieben Tage gleich. So
  bleibt der Tag-für-Tag-Vergleich möglich.
- **Die Nachtschicht darf über 24 Uhr hinausragen.** Die Achse endet nicht bei
  Mitternacht, sondern dort, wo der letzte Termin endet. Eine Spätschicht
  23:00–01:30 zeichnet sich als Block, der die 24-Uhr-Linie (etwas kräftiger
  gesetzt und als `00:00 +1` beschriftet) sichtbar überragt. Ein `(+1)` im Text
  ist dafür nicht mehr nötig und entfällt deshalb überall.
- **Slots sind echte Raids, keine Platzhalter.** Was in `lanes.json` steht, findet
  auch statt – Discord führt es nur nicht. Es bekommt dieselbe Kartenform wie ein
  Event, tritt aber **zurückgenommener** auf: *Täglich ca. / 19.30 – 22 Uhr /
  Public mit Dorn*. Anklickbar mit eigenem Detailpanel, in dem steht, dass die
  Regel aus `lanes.json` kommt und nicht aus Discord. Erkennbar sind beide Sorten
  am **linken Akzentbalken**: Jedes echte Discord-Event hat einen, ein gebuchter
  Slot nie – und an Schriftgröße und Farbkraft: der Termin ist lauter, der Slot
  leiser.
- **Der Termin bekommt die volle Spalte, die Grundlinie den Rest.** Steckt ein
  Raid in einer gebuchten Grundlinie, läuft die Grundlinie trotzdem weiter – nur
  sichtbar ist der Teil, den kein Termin belegt. Am Samstag steht der
  Speed-Dating-Raid (17–21 Uhr) in voller Breite darüber und darunter der
  Streifen **21 – 22 Uhr / Public mit Dorn**; am Freitag läuft der Reset bis
  23:45 und darunter **ab 23.45 Uhr / Spätschicht**.
  Nebeneinanderzustellen ginge nur, indem man beides schmaler macht, und gerade
  der Termin soll der laute sein. Kommt der Termin in der **Mitte** der
  Grundlinie, zerfällt sie in zwei Streifen – vorne und hinten –, jeder über die
  volle Breite. Erst ab 90 % Deckung entfällt eine Grundlinie ganz; ein Streifen
  unter 30 px Höhe wird nicht gezeichnet, weil ein Farbfleck ohne Text
  schlimmer ist als keiner. Die Zeitachse zählt beide Enden mit, deshalb ist so
  ein Streifen nie unter einem Termin, sondern immer daneben oder darunter.
- **Zwei Termine zur selben Zeit stehen nebeneinander.** Nur Termine laufen
  durch den Packer (`packDay`), gewichtet nach Dauer – wer länger läuft, braucht
  mehr Platz für seinen Namen. Unter 38 % wird nichts mehr schmaler, weil ein zu
  enger Streifen den anderen die Breite wegnähme.
- **Kurze Termine bekommen trotzdem ihren ganzen Namen.** Die Oberkante der
  Karte ist immer die echte Startzeit. Die Unterkante darf in den freien Raum
  darunter hineinwachsen, bis der Name passt: *Der ultimative Speed-Dating
  Raid* ist eine Stunde lang und liest sich sonst wie abgeschnitten. Was wächst,
  behauptet nichts Falsches – die Uhrzeit steht oben in der Karte, und das Brett
  hat keine Stunde mehr, in der nichts ist.
  Gezählt wird in Pixeln, nicht in Minuten: Auf der zusammengedrückten Achse
  bedeuten 40 freie Minuten fast nichts, 40 Minuten am Stück eine ganze Stunde.
  **Grenze ist der nächste Block** – in derselben Spalte, plus jeder
  Grundlinien-Streifen darunter (der zieht über die volle Breite und begrenzt
  darum jede Karte, nicht nur die daneben). Passt der Name nicht, wird mit „…"
  gekürzt, aber nie überlagert.
  Wie viele Zeilen der Name bekommt, misst `fitCard` im Browser, statt es zu
  schätzen: `-webkit-line-clamp` schneidet beim Schätzen genau den Namen ab, um
  den es geht. Dasselbe gilt für die Uhrzeile (`fitTimeLine`): Sie ist das
  Wichtigste auf der Karte, also wird sie erst kleiner (13 → 11,5 → 10,5 px)
  und ganz zum Schluss umgebrochen, statt abgeschnitten zu werden. Gemessen wird
  mit `scrollWidth` statt gerechnet – das Coverbild nimmt dem Text ein Drittel
  Breite, und das sieht keine `@container`-Abfrage von außen.
  `tools/layout-check.js` unterscheidet beim Namen zwei Fälle – ein zu kleiner
  Deckel (Fehler) und eine zu niedrige Karte (so gewollt).
- **Wiederkehrende Events** – Discord liefert dafür nur *ein* Objekt mit
  `recurrence_rule`. Der Kalender expandiert die Regeln selbst
  (WEEKLY/DAILY/MONTHLY/YEARLY inkl. `by_weekday`, `by_n_weekday`, `by_month_day`)
  und zeichnet jeden Termin an seiner Uhrzeit.
- **Fallstrick Wochentage** – Discord nummeriert Wochentage **Montag = 0 …
  Sonntag = 6** (Konvention von python-dateutil), *nicht* wie in RFC 5545,
  wo der Sonntag die 0 bekommt. Ein `by_weekday: [4]` heißt also Freitag und
  nicht Donnerstag. `normalizeWeekdays` in [src/recurrence.js](src/recurrence.js)
  berücksichtigt beides: Zahlen nach Discord-Schema, Zeichenketten wie `"FR"`
  direkt. Die Beschriftung richtet sich nach `frequency` – ein monatliches
  Event („1. Sa im Monat“) wird nicht als wöchentliches ausgegeben.
- **Zeitzonen** – Die Umrechnung läuft über `Intl` statt über feste Offsets, damit
  Sommer- und Winterzeit korrekt bleiben.
- **Endzeiten aus der Regel** – Voice- und Stage-Events haben in Discord fast
  nie eine Endzeit. Statt pauschal zu raten, fragt der Kalender zuerst die Spur:
  liegt der Termin im Slot, endet er so, wie die Regel es vorsieht. Ein
  Reset-Raid am Freitag zeigt darum 20:00 – 23:30 und nicht 20:00 – 22:00, weil
  `lanes.json` den Freitags-Slot auf 23:30 legt. Findet sich keine passende
  Regel, greift `DEFAULT_DURATION_MINUTES`. Jede so ermittelte Endzeit trägt ein
  `≈` – sie ist eine begründete Annahme, keine Discord-Angabe. Für einzelne
  Termine lässt sich eine Endzeit in `assignments` mit `end` festschreiben; die
  schlägt die Grundzeile, verlässt sich aber auf Discord, sobald dort eine
  Endzeit steht.
- **Ausfall** – Schlägt ein Discord-Abruf fehl, liefert der Server den letzten
  Stand weiter und markiert ihn in der Kopfzeile als *veraltet*.
- **Abgesagte Termine** – Events mit Status *abgesagt* werden nicht mehr
  weggefiltert, sondern durchgestrichen gezeichnet. Ein verschwundener Termin
  ist schlimmer als ein als solcher markierter.
- **Covers** – Hat ein Event ein Bild, liefert `src/discord.js` zwei CDN-URLs:
  `image` (640 px) für das Detailpanel und `imageSmall` (160 px) für ein
  Thumbnail. Ohne Bild bleibt die Icon-Spalte leer – ein Emoji-Icon wurde
  entfernt, weil es bei Voice-Events immer gleich aussieht.

## Fehlersuche

`GET <http://127.0.0.1:3000/api/health>` prüft alles Notwendige und nennt die
passende Einladungs-URL:

| `reason` | Bedeutung | Lösung |
| --- | --- | --- |
| `missing-access` | Bot ist nicht im Server (`403 Missing Access`) | Bot über die `inviteUrl` aus `/api/health` einladen |
| `unknown-guild` | `DISCORD_GUILD_ID` ist keine gültige Server-ID (`404`) | Entwicklermodus aktivieren, Server-ID neu kopieren |
| `token-invalid` | Token abgelehnt (`401`) | neuen Token im Developer Portal erzeugen |
| `ok` | Zugriff besteht | `eventCount: 0` heißt: der Server hat schlicht keine Events |

Die Liste `events` nennt jede Zeile, die Discord tatsächlich geliefert hat – mit
Status und Start des Master-Termins. Damit lässt sich die wichtigste Frage
beantworten: Fehlt ein Raid, weil **Discord ihn nicht schickt**, oder weil die
Woche ihn verwirft?

`GET /api/health?guild=<ID>` prüft einen anderen Server, ohne die Konfiguration
anzufassen. Der Bot ist oft in mehreren Gilden, und dann ist die entscheidende
Frage, in welchem das Event überhaupt steht. Der Kalender rendert weiterhin nur
`DISCORD_GUILD_ID`.

### Ein Termin fehlt, ist aber in Discord zu sehen

Zwei Zusatzprüfungen, weil die Liste allein die Frage nicht beantwortet:

| Aufruf | Bedeutung |
| --- | --- |
| `?event=<ID>` | holt **einen** Termin direkt – auch solche, die die Liste unterschlägt |
| `?channel=<ID>` | kann der Bot den Kanal sehen? |

Die Statuscodes sind genau die Unterscheidung:

| HTTP | Bedeutung |
| --- | --- |
| `200` | vorhanden und sichtbar |
| `400` | Diese Event-ID gibt es in diesem Server nicht |
| `403` | Event existiert, **der Bot darf es nicht sehen** |

Der Fall, der in der Praxis vorkommt: Das Event liegt in einem geschlossenen
Voice-Kanal. Discord blendet es dann auch aus `/scheduled-events` aus – die
Liste antwortet `200` und verschweigt es kommentarlos. Der Einzelabruf sagt
`403`, und damit ist die Sache klar. Abhilfe: dem Bot in diesem Kanal
*Kanäle ansehen* geben.

### Kein Zugriff trotz vorhandenem Token

`reason: missing-access` (403), obwohl der Bot im Server ist: dem Token fehlt der
Scope **`guilds`**. Betroffen sind Tokens, die vor dem Erteilen des Scopes
kopiert wurden – `users/@me` klappt damit noch, der Terminzugriff nicht. Neuer
Token im Developer Portal unter *Bot → Reset Token*.

## Werkzeuge

`npm run check:worker` prüft den Cloudflare-Worker, ohne Cloudflare: Der Test
nimmt den echten `src/worker.js` in Node, gibt ihm eine nachgebaute KV und prüft
Routen, Keksel, Zeitplan und Wochenmodell. Ohne Konto, Token und Netz.
Beschreibung im Abschnitt über die Workers.

`tools/shot.mjs` legt einen Screenshot der laufenden Seite ab – praktisch, um
Layout-Änderungen zu prüfen, ohne npm-Abhängigkeiten:

```bash
node tools/shot.mjs http://127.0.0.1:3000/ shot.png 1847 987
```

Optionale Argumente: Breite, Höhe, ein JavaScript-Ausdruck (wird nach dem Laden
ausgeführt, z. B. `document.querySelector('.block').click()`) und ein
Ausschnitt `x,y,b,h,skalierung`.

`tools/layout-check.js` ist kein Skript für sich, sondern ein Ausdruck für das
fünfte Argument. Es misst alle Karten und Slots und meldet jede Überlappung –
genau das, was man auf einem Bild nicht sieht. Es prüft außerdem, ob ein Name an
einer zu kleinen Kante abgeschnitten wurde, und gibt die Schriftgrößen beider
Kartenformen aus.

Ein Ausdruck mit Backticks überlebt die Kommandozeile je nach Shell nicht. Mit
`@` gibt man deshalb einen Dateinamen an:

```powershell
node tools/shot.mjs http://127.0.0.1:3000/ tools/board-live.png 1500 950 @tools/layout-check.js
```

> Aus leeren Argumenten macht PowerShell beim Aufruf fremder Programme nichts –
> übergibt man `""` als JavaScript, rutscht der Ausschnitt eine Stelle nach links.
> Für „kein JavaScript" ein beliebiges Kurzargument wie `0` einsetzen.

`tools/stress-week.js` ist derselbe Ausdruck, nur mit erfundener Woche: Er legt
eine Woche unter die echte API und misst darauf. Zweck sind die Fälle, die echte
Daten selten zeigen – drei Termine zur selben Zeit, eine Grundlinie mit einem
Termin *mitten drin*, eine Nachtschicht über Mitternacht, ein Termin ohne Bild.
Zwei Fehler sind nur dort aufgefallen und in den echten Wochen nie:

- der horizontale Versatz im Packer lief je *Termin* statt je *Spalte*. Sobald
  eine Spalte zweimal belegt war, landete der zweite Versatz bei 100 % und die
  Karte rutschte in den nächsten Tag;
- die Uhrzeile der Karte schnitt ab, sobald ein Coverbild den Text verengte –
  eine `@container`-Abfrage auf die Karte sieht das Cover nicht.

```powershell
node tools/shot.mjs http://127.0.0.1:3000/ tools/stress.png 1540 757 @tools/stress-week.js 0
```

`tools/contrast-check.mjs` ist kein Seiten-Ausdruck, sondern ein eigenes
Werkzeug. Es prüft, ob Text auf dem Hintergrundbild noch lesbar ist – und zwar
**an den Pixeln, die Chrome wirklich malt**, nicht nachgerechnet aus dem
Stylesheet. Zwei Durchgänge derselben Seite: einmal normal, um Rect und
Schriftfarbe zu holen, einmal mit unsichtbarem Text. Was übrig bleibt, ist genau
das, was hinter der Schrift liegt, und wird als Hintergrundfarbe gewertet.

```powershell
node tools/contrast-check.mjs                                  # Standardansicht
node tools/contrast-check.mjs http://127.0.0.1:3000/ 1540 1000 --vergleich
node tools/contrast-check.mjs --keep    # legt contrast-bg.png ab, die gemessene Fläche
```

`--vergleich` misst dieselben Stellen noch einmal **ohne** Hintergrundbild und
stellt die Werte daneben. Damit lässt sich die Frage beantworten, ob das Bild
überhaupt Kontrast kostet – aktuell höchstens 1,2 Stufen, und der engste Wert
liegt bei 4,9:1 gegen 4,5:1 Schwelle.

Drei Fehler stecken in diesem Werkzeug und sind typisch für selbstgebaute
Messungen; sie seien hier genannt, weil sie das Ergebnis verfälscht haben:

- **Nicht den Elementkasten messen.** Ein `.legend-item` enthält den farbigen
  Punkt; misst man den ganzen Kasten, landet der Punkt darin und die Schrift
  gilt als unlesbar (1,1:1), obwohl über ihr Schwarz steht. Gemessen wird die
  Zeile, über einen `Range` um den Textknoten.
- **Text, der als Verlauf gefüllt ist**, steckt im *Hintergrund* des Elements
  (`background-clip: text`). Ein transparentes `color` löscht ihn nicht – er
  läge als Hintergrundfarbe in exakt der Schriftfarbe da. Im Vergleichslauf
  wird er deshalb weggenommen.
- **`color-mix` liefert `color(srgb 0.46 0.48 0.76)`** mit Anteilen von 0 bis 1.
  Als 8-Bit gelesen ist 0,46 fast Schwarz, und eine helle Schrift sieht
  unsichtbar aus. Der Farbparser prüft deshalb die Schreibweise.

## Veröffentlichen auf GitHub Pages

GitHub Pages liefert **nur Dateien** aus, kein Node. `/api/week` gibt es dort
also nicht, und die Seite wäre leer. Die Lösung ist nicht ein Umbau des
Frontends, sondern ein zweiter Weg zu denselben Daten: Dieselbe Pipeline, die
auch der Server benutzt, läuft **vorab** einmal durch und schreibt ihr Ergebnis
als Dateien ab.

```
tools/snapshot.mjs  →  public/data/<wochenstart>.json
                        public/data/latest.json
                        public/data/index.json
```

`app.js` fragt `data/` zuerst ab und fällt auf `/api/week` zurück. Dieselbe
`public/`-Mappe läuft damit lokal **mit** und auf Pages **ohne** Server, ohne
dass ein Build-Schritt irgendetwas umschreibt.

```bash
npm run snapshot     # Wochen als Dateien erzeugen (Demo, wenn kein Token da ist)
npm run preview      # statisch unter /raid-calendar/ ausliefern, wie Pages
```

`npm run preview` ist absichtlich strenger als `npm start`: Es liefert unter
`/raid-calendar/` aus und hat **keine** API. Genau so verhält sich Pages. Ein
absoluter Pfad wie `/app.js` landet dort im Repo-Root – die Seite bleibt weiß,
ohne dass irgendwo ein Fehler steht. Deshalb sind alle Pfade relativ
(`./style.css`, `./app.js`, `./raid-calendar-bg.png`).

### Einrichtung (zwei Handgriffe, beide brauchen Schreibrechte)

1. **Settings → Pages → Source: „GitHub Actions“.** Ohne das gibt es keine
   Pages-Site, und der Deployment-Schritt läuft ins Leere.
2. **Settings → Secrets and variables → Actions**, zwei Secrets anlegen:
   `DISCORD_TOKEN` und `DISCORD_GUILD_ID` – dieselben Werte wie in der
   `.env`. Der Workflow bricht ab, wenn sie fehlen, statt stillschweigend eine
   Woche **Demo-Daten** zu veröffentlichen.

Danach läuft `.github/workflows/publish.yml` **stündlich** (Minute 23) sowie
bei jedem Push auf `main` und auf Zuruf (*Run workflow*). Ein Lauf dauert
wenige Sekunden.

### Wie schnell eine neue Raid auftaucht

GitHub Pages **pollt nichts**. Dort läuft kein Code, es werden nur Dateien
ausgeliefert – wer an Discord etwas einträgt, meldet das der Seite nicht. Der
einzige Weg ist der Workflow.

**Und der Zeitplan ist unzuverlässiger, als er aussieht.** GitHub schreibt in
der eigenen Doku, planmäßige Läufe könnten unter Last verzögert und
verworfen werden – *„If the load is sufficiently high, some queued jobs may be
dropped"*. Ausprobiert mit vier Läufen pro Stunde (`:07 :22 :37 :52`): In neun
Stunden kam **genau einer** durch, die Seite war sechs Stunden alt, obwohl der
Zeitplan das nicht vorsah.

Deshalb steht dort jetzt **eine** Zeitmarke statt vier. Ein einzelner Eintrag
in der Warteschlange kommt deutlich zuverlässicher durch als vier konkurrierende
– realistisch sind die Daten **etwa eine Stunde alt**, garantiert ist der
Abstand nicht. Für „jetzt sofort" gibt es *Run workflow* in der Liste der
Actions, und jeder Push auf `main` veröffentlicht ebenfalls sofort.

Wer eine Zusage statt eines Mittelwerts braucht, kommt mit GitHub Pages nicht
aus: Dann muss etwas laufen, das dauerhaft läuft – der eigene Rechner über die
Windows-Aufgabenplanung, oder ein Serverless-Cron. Beides verlagert den
Discord-Token aus dem Repo.

Die Seite prüft zusätzlich selbst nach: Alle fünf Minuten fragt sie
`data/latest.json` ab, und **nur wenn sich der Erzeugungszeitpunkt geändert
hat**, wird neu gerendert. Beim Zurückholen eines Tabs aus dem Hintergrund
passiert das sofort. Das Nachladen bewegt den Betrachter nirgends hin – es holt
nur die gerade gezeigte Woche neu, auch wenn er in einer anderen blättert.

Damit sich beurteilen lässt, ob die Kette läuft, steht in der Statuszeile nicht
nur `Stand 15:31`, sondern `Stand 15:31 · vor 18 Min.`. Ohne das Alter sieht
eine Seite um 15:35 und um 17:20 völlig gleich aus, und niemand kann
unterscheiden, ob gerade nichts anliegt oder der Plan seit zwei Stunden nichts
Neues bringt. Das Alter läuft bei jedem Prüfzyklus mit.

Zur Einordnung der Zahlen: Aus einem Änderungswunsch in Discord bis zum
sichtbaren Termin liegen bis zu etwa **eine Stunde** (bis zum nächsten Lauf) plus
etwa **zehn Minuten** (bis das CDN die neue Datei ausliefert) plus bis zu
**fünf Minuten** (bis die offene Seite nachfragt). Das ist keine Rechenaufgabe,
sondern das, was GitHub Pages hergibt.

Der Takt ist weder teuer für dich noch für Besucher: Ein öffentliches Repo
rechnet Standard-Runner umsonst ab, die 24 Läufe am Tag also gratis. Und ein
erneutes Deployment ändert `app.js`, `style.css` und das 2-MB-Bild nicht an,
ihre ETags bleiben gleich, der Browser beantwortet die Nachfrage mit 304,
ohne einen Byte neu zu holen. Neu geladen wird wirklich nur die kleine
Datendatei – und die holt sich die Seite ohnehin nur, wenn sich etwas geändert
hat.

Der Zeitplan steht bewusst auf Minute 23 und nicht auf `:00`: GitHub stellt
Läufe, die auf die volle Stunde fallen, zurück.

```bash
npm run check:workflow   # vor dem Push
```

Eine verrutschte Einrückung in `publish.yml` kostet sonst einen Lauf, der
sofort mit *„This run likely failed because of a workflow file issue"* abbricht
— ohne Zeilennummer, weil der Lauf gar nicht erst startet. Der Prüfer fängt
das ab, bevor es auf GitHub landet. Er liest außerdem den Cron-Ausdruck
**beide Felder** aus und sagt, welchen Takt er verstanden hat: Gerade das hat
hier zweimal getäuscht, einmal über „alle Viertelstunde, die in Wahrheit alle
sechs Stunden liefen" und einmal über einen Takt, den es gar nicht gab.

### Was sich auf Pages ändert

| | mit Server | auf Pages |
|---|---|---|
| Zeitzone | umrechen, Auswahlfeld vollwertig | **gesperrt** auf die eine Zone, für die geschnitten wurde |
| Blättern | beliebig | nur über den erzeugten Bereich (`data/index.json`); die Pfeile enden dort |
| Diagnose-Link | zeigt `/api/health` | weggelassen – es gibt keinen Server, den man fragen könnte |

Die gesperrte Zeitzone ist Absicht, keine Einschränkung durch die Technik: Der
Schnitt entsteht beim Erzeugen der Datei, für genau eine Zone. Ein Auswahlfeld,
das beim Wechsel zurückspringt, verspricht etwas, das dort nicht stattfindet –
lieber ehrlich festgenagelt.

`public/data/` steht in `.gitignore`: Die Dateien werden im Deployment erzeugt.
Lägen sie im Repo, schleicht sich beim lokalen Testlauf leicht eine Woche
Demo-Daten in die Seite, die dann veröffentlicht wird.

## Veröffentlichen auf Cloudflare Workers

Auf GitHub Pages läuft kein Code, sondern es werden alle **sechzig Minuten**
Dateien erzeugt – und GitHub verschluckt davon erfahrungsgemäß welche
(siehe oben). Der Worker dreht beides um: Es läuft **gar nichts** zwischen zwei
Zeitplan-Läufen, und der Takt ist **fünf Minuten** statt einer Stunde.

```
                alle 5 Minuten (Cron Trigger)
                        │
                        ▼
  scheduled()  ──►  Discord REST API
                        │  src/discord.js, src/source.js
                        ▼
                     Workers KV          ← einziger Ort, an dem Termine liegen
                        ▲
GET /api/week ───────────┘
   ▲
   │                       static assets: app.js, style.css, Hintergrundbild
browser ────────────────────► CDN (run_worker_first: nur /api/* und das Dokument)
```

**Der eine Unterschied, der alles andere erklärt:** Kein Seitenaufruf fragt
Discord ab. Auf GitHub Pages entstehen die Daten im Deploy, auf dem Worker im
Zeitplan – ein Besucherstrom kann also gar kein Rate Limit auslösen, und eine
neu angesetzte Raid taucht auch dann auf, wenn gerade niemand die Seite offen
hat.

`npm start` bleibt davon unberührt: `server.js` startet weiter, und dieselben
Module rechnen in beiden Laufzeiten dasselbe. Unterschiedlich ist nur, **wo** der
Schnappschuss liegt – im Arbeitsspeicher (`memoryStore`) oder in der KV
(`kvStore`), siehe `src/source.js`.

### Einrichtung

```bash
npm install                       # nur für wrangler; npm start läuft ohne
npx wrangler login
npx wrangler kv namespace create KV      # -> id in wrangler.jsonc eintragen
npx wrangler secret put DISCORD_TOKEN   # fragt nach dem Token, fragt nicht ins Log
```

In `wrangler.jsonc` gehören noch `DISCORD_GUILD_ID` und gegebenenfalls
`TIMEZONE` in die `vars` – dieselben Werte wie in `.env`. Der Token gehört
**nicht** dort hin: `vars` stehen im Klartext im Bundle, Secrets nicht.

```bash
npm run cf:deploy        # einmal
npm run cf:tail          # mitlesen, was der Zeitplan tut
```

Die erste eigene Domain ist über *Workers & Pages → dein Worker → Settings →
Domains & Routes* einzutragen; ohne das läuft der Worker unter
`…workers.dev`.

### Vorher prüfen

```bash
npm run check:worker
```

Der Test nimmt den **echten** `src/worker.js` in Node, gibt ihm eine
nachgebaute KV und eine Umgebung, die sich als Cloudflare ausgibt, und prüft
Routen, Keksel, Zeitplan und das Wochenmodell. Läuft ohne Konto, ohne Token und
ohne Netz – deshalb findet er Fehler, bevor etwas veröffentlicht ist. Geprüft
ist damit alles bis auf das, was erst Cloudflare beim Bauen daraus macht.

Vor dem ersten Deploy zusätzlich von Hand, weil nur dort die echte KV zählt:

```bash
npm run cf:dev          # http://127.0.0.1:8787
curl -I http://127.0.0.1:8787/            # -> Set-Cookie: raidkalender_api=1
curl -s http://127.0.0.1:8787/api/week    # -> days[7], meta.cron = true
curl -s "http://127.0.0.1:8787/cdn-cgi/local/scheduled"   # Zeitplan einmal auslösen
```

Fehlt der Keksel, hält `public/app.js` den Worker für eine Pages-Seite und
zeigt eine leere Seite – der erste Blick geht dann an den ersten Aufruf.

### Wie schnell eine neue Raid auftaucht

Bis zu **fünf Minuten** (bis zum nächsten Zeitplanlauf) plus bis zu **eine
Minute** (bis die KV den neuen Stand weltweit kennt) plus bis zu **fünf
Minuten** (bis die offene Seite nachfragt). Also in aller Regel unter einer
Stunde, meistens deutlich darunter – und anders als bei Pages mit fester
Zusage, weil ein Zeitplan hier eingeplant und nicht bestritten wird.

Zwei Feinheiten, die man kennen sollte:

- **Eine Änderung am Zeitplan braucht bis zu 15 Minuten**, bis sie im Netz
  gilt. Wer `*/5` auf `*` stellt, wartet also eine Viertelstunde.
- **Ein Fehler leert den Kalender nicht.** Scheitert der Abruf, bleibt der
  letzte gute Stand in der KV stehen; die Seite zeigt ihn mit `stale` und dem
  Klartext aus `meta.problem`.

### Was es kostet und wo die Grenzen sind

| | Free | Paid (5 $/Monat) |
| --- | --- | --- |
| CPU je Anfrage und je Zeitplan | 10 ms | 30 s |
| Anfragen | 100.000/Tag | unbegrenzt |
| Cron Trigger | 5 | 250 |
| Laufzeit eines Zeitplans | 15 min | 15 min |

Für diese Anwendung ist der **Free-Tier-Tarif der Normalfall**: 288 Zeitplan-
läufe am Tag plus der Besucherverkehr einer Gildenseite liegen weit unter den
100.000 Anfragen. Die einzige Stelle, an der es eng werden *kann*, ist die
10-ms-Grenze: Ein Zeitplanlauf macht zwei Discord-Abrufe und normalisiert die
Antwort – das sollte reichen. Wird es doch zu viel, meldet Cloudflare den
Fehler **1102** (`exceededCpu`) im Dashboard unter *Workers Logs*, und der
Paid-Tarif hebt die Grenze auf 30 Sekunden.

Die Zahlen stehen in der
[Limits-Übersicht](https://developers.cloudflare.com/workers/platform/limits/) –
sie ändern sich, wenn Cloudflare sie ändert.

### Was sich gegenüber dem lokalen Server ändert

| | `npm start` | Worker |
| --- | --- | --- |
| Discord-Abruf | bei Bedarf, gecacht | nur im Zeitplan |
| Alter der Daten | höchstens `CACHE_TTL_MS` (60 s) | höchstens der Zeitplantakt (5 min) |
| `meta.fetchedAt` | Zeitpunkt des Serverabrufs | Zeitpunkt des Zeitplans |
| Zeitzone | frei wählbar | frei wählbar |
| Blättern | unbegrenzt | unbegrenzt |
| Spurendatei | `lanes.json` von der Platte, änderbar ohne Deploy | `lanes.json` im Bundle, änderbar mit Deploy |
| `/api/health` | meldet `uptimeSeconds` | meldet `runtime: cloudflare-worker` |

Der letzte Punkt ist kein Verlust: Bei einem Worker, den es in fünf Minuten
woanders gibt, sagt „läuft seit 40 Sekunden" nichts. `npm run cf:tail` sagt
mehr.

### Neu: `/api/refresh`

```bash
curl -X POST https://DEINE-ADRESSE/api/refresh
```

Holt sofort neu und schreibt in die KV – das Gegenstück zu *Run workflow* bei
den GitHub Actions. Ohne neuen Stand wird trotzdem geantwortet, mit
`error`, wenn etwas klemmte.

### Warum die Daten nicht im Bundle liegen

`public/` ist bei einem Worker statisches Zubehör, nicht etwa ein Build-Ergebnis
– was beim Deploy einmal hochgeladen wurde, bleibt so, bis wieder etwas
deployt wird. Deshalb schreibt der Zeitplan in die KV und nicht in eine Datei:
Eine neu angesetzte Raid darf keinen Deploy brauchen, um sichtbar zu werden.

### Der Keksel

`public/app.js` erfährt an einem Keksel (`raidkalender_api`), dass hinter der
Adresse ein Server steht – sonst sucht es selbst danach und kostet bei jedem
Öffnen einen 404, den jeder im Netzwerk-Tab für einen Fehler hält. Unter Node
setzt `server.js` ihn beim Ausliefern des Dokuments. Im Worker macht das
`src/worker.js`, und deshalb läuft in `wrangler.jsonc` auch das **Dokument**
durch den Worker (`run_worker_first`), nicht nur `/api/*` – `app.js`,
`style.css` und das 2-MB-Bild kommen weiterhin direkt vom CDN.

Alternativ gäbe es `public/_headers`. Bewusst nicht benutzt: ob Static Assets
dort ein `Set-Cookie` zulassen, ist zwischen Pages und Workers nicht dasselbe,
und dieses eine Bit soll nicht an einer Ungewissheit hängen.

## Optional: Live statt pollen

Statt des TTL-Caches lassen sich die Gateway-Events
`GUILD_SCHEDULED_EVENT_CREATE`, `GUILD_SCHEDULED_EVENT_UPDATE` und
`GUILD_SCHEDULED_EVENT_DELETE` abonnieren. Für einen Wochenkalender ist Polling
alle 60 Sekunden aber in der Regel völlig ausreichend.

Auch das ginge **auf Cloudflare**, in einem Durable Object statt im Zeitplan:
Der DO hält `wss://gateway.discord.gg` offen, identifiziert sich mit dem Intent
`GUILD_SCHEDULED_EVENTS` (2^16, im Developer Portal unter *Privileged Intents*
zuschalten) und schreibt jede Änderung in dieselbe KV. Zwei Dinge wüsste man
davor aber, und beide stehen in der
[WebSocket-Doku](https://developers.cloudflare.com/workers/runtime-apis/websockets/):
Ausgehende WebSockets **hibernieren nicht** – eine offene Verbindung hält das
DO höchstens 15 Minuten wach, und jeder Deploy trennt **alle** WebSockets. Man
bräuchte also eine Reconnect-Schleife mit `RESUME` und `session_id` in der
DO-Storage, sonst stünde der Kalender nach jeder Veröffentlichung still, bis
etwas anderes den Worker anfasst. Für fünf Minuten statt fünf Sekunden ist
das der falsche Handel.
