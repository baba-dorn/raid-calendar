# Discord Wochenkalender

Liest die Events (Discord nennt sie *Guild Scheduled Events*) einer Guild über die
Discord-REST-API und zeigt sie als Wochenübersicht im Web an.

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
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Webserver |

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
        │
        ▼
GET /api/week?start=YYYY-MM-DD&tz=Europe/Berlin
        │
        ▼
public/app.js       Wochenraster, durchgehende Blöcke für tägliche Events
```

### API

| Route | Zweck |
| --- | --- |
| `GET /api/week?start=YYYY-MM-DD&tz=…` | Alle Termine einer Woche, nach Tag gruppiert |
| `GET /api/config` | effektive Konfiguration |
| `GET /api/health` | Kurzstatus |

`start` und `tz` sind optional; ohne `start` liefert der Server die aktuelle Woche.

## Besonderheiten

- **Wiederkehrende Events** – Discord liefert dafür nur *ein* Objekt mit
  `recurrence_rule`. Der Kalender expandiert die Regeln selbst
  (WEEKLY/DAILY/MONTHLY/YEARLY inkl. `by_weekday`, `by_n_weekday`, `by_month_day`).
  Events, die an allen sieben Tagen stattfinden, werden als ein durchgehender
  Block über die ganze Woche gezeichnet.
- **Fallstrick Wochentage** – Discord nummeriert Wochentage **Montag = 0 …
  Sonntag = 6** (Konvention von python-dateutil), *nicht* wie in RFC 5545,
  wo der Sonntag die 0 bekommt. Ein `by_weekday: [4]` heißt also Freitag und
  nicht Donnerstag. `normalizeWeekdays` in [src/recurrence.js](src/recurrence.js)
  berücksichtigt beides: Zahlen nach Discord-Schema, Zeichenketten wie `"FR"`
  direkt. Die Beschriftung richtet sich nach `frequency` – ein monatliches
  Event („1. Sa im Monat“) wird nicht als wöchentliches ausgegeben.
- **Zeitzonen** – Die Umrechnung läuft über `Intl` statt über feste Offsets, damit
  Sommer- und Winterzeit korrekt bleiben.
- **Endzeiten** – Voice- und Stage-Events haben in Discord oft keine Endzeit.
  Dann greift `DEFAULT_DURATION_MINUTES`; die Schätzung wird im Detailpanel
  ausgewiesen.
- **Ausfall** – Schlägt ein Discord-Abruf fehl, liefert der Server den letzten
  Stand weiter und markiert ihn in der Kopfzeile als *veraltet*.
- **Covers** – Hat ein Event ein Bild, liefert `src/discord.js` zwei CDN-URLs:
  `image` (640 px) für das Detailpanel und `imageSmall` (160 px) für das
  Thumbnail im Kalenderblock. Ohne Bild bleibt die Icon-Spalte leer – ein
  Emoji-Icon wurde entfernt, weil es bei Voice-Events immer gleich aussieht.

## Fehlersuche

`GET <http://127.0.0.1:3000/api/health>` prüft alles Notwendige und nennt die
passende Einladungs-URL:

| `reason` | Bedeutung | Lösung |
| --- | --- | --- |
| `missing-access` | Bot ist nicht im Server (`403 Missing Access`) | Bot über die `inviteUrl` aus `/api/health` einladen |
| `unknown-guild` | `DISCORD_GUILD_ID` ist keine gültige Server-ID (`404`) | Entwicklermodus aktivieren, Server-ID neu kopieren |
| `token-invalid` | Token abgelehnt (`401`) | neuen Token im Developer Portal erzeugen |
| `ok` | Zugriff besteht | `eventCount: 0` heißt: der Server hat schlicht keine Events |

Die Liste `guilds` zeigt, in welchen Servern der Bot tatsächlich Mitglied ist –
nützlich, wenn versehentlich die falsche Server-ID in der `.env` steht.

## Werkzeuge

`tools/shot.mjs` legt einen Screenshot der laufenden Seite ab – praktisch, um
Layout-Änderungen zu prüfen, ohne npm-Abhängigkeiten:

```bash
node tools/shot.mjs http://127.0.0.1:3000/ shot.png 1847 987
```

Optionale Argumente: Breite, Höhe, ein JavaScript-Ausdruck (wird nach dem Laden
ausgeführt, z. B. `document.querySelector('.block').click()`) und ein
Ausschnitt `x,y,b,h,skalierung`.

## Optional: Live statt pollen

Statt des TTL-Caches lassen sich die Gateway-Events
`GUILD_SCHEDULED_EVENT_CREATE`, `GUILD_SCHEDULED_EVENT_UPDATE` und
`GUILD_SCHEDULED_EVENT_DELETE` abonnieren. Für einen Wochenkalender ist Polling
alle 60 Sekunden aber in der Regel völlig ausreichend.
