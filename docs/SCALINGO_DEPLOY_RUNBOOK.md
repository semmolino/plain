# Runbook: bestehende App auf Scalingo deployen (noch mit Supabase)

Ziel dieses Schritts ist **nicht** der Umzug der Datenbank, sondern die Antwort auf
eine einzige Frage: *Läuft plan&simple auf Scalingo überhaupt?*

Die Datenbank bleibt vorerst Supabase. Damit sind Hosting-Risiko und
Datenbank-Risiko getrennt — wenn hier etwas bricht, weiß man, dass es am Hoster
liegt und nicht an der Migration.

Der eigentliche Umzug steht in [SCALINGO_MIGRATION.md](SCALINGO_MIGRATION.md).

---

## ⚠ Vorab: zwei Instanzen, eine Datenbank

Die Scalingo-App zeigt auf dieselbe Supabase-Instanz wie Railway. Daraus folgt:

**Die sechs Hintergrund-Checker laufen doppelt.** Sie verschicken Mahnungen,
Fälligkeits- und Leistungsstand-Erinnerungen an echte Empfänger. Ohne
Gegenmaßnahme bekommen deine Kunden jede Mail zweimal.

Deshalb ist in `server.js` ein Schalter ergänzt. Auf der Scalingo-App **zwingend**:

```
DISABLE_BACKGROUND_JOBS=true
```

Alles Übrige (Lesen, Schreiben, Rechnungen anlegen) ist unkritisch — es ist
dieselbe Datenbank, die Railway auch benutzt. Wer ganz sauber testen will, legt
sich ein zweites Supabase-Projekt an; für einen reinen Startbarkeits-Test ist das
aber nicht nötig.

---

## Was im Repository dafür angelegt wurde

Scalingo baut über Buildpacks und ignoriert Dockerfile und `nixpacks.toml`.
Vier Dateien liefern die Informationen, die Railway heute aus dem Dockerfile zieht:

| Datei | Wozu |
|---|---|
| `package.json` (Root) | Ohne diese Datei erkennt Scalingo Node.js nicht. Enthält `engines.node` und den Build über `scalingo-postbuild`. |
| `Procfile` | Startkommando: `web: node backend/server.js` |
| `Aptfile` | Chromium-Systembibliotheken — die `apt-get`-Zeile aus dem Dockerfile |
| `.buildpacks` | apt-Buildpack vor nodejs-Buildpack |

Railway bleibt davon unberührt: `nixpacks.toml` definiert eigene Phasen und das
Dockerfile greift nicht auf die Root-`package.json` zu.

---

## Ablauf

### 1. CLI einrichten

Scalingo empfiehlt für Windows ausdrücklich Git-Bash — das hast du bereits.

```bash
# https://cli.scalingo.com/ herunterladen, scalingo.exe in den PATH legen
scalingo --version
```

**Anmeldung bei einem GitHub-Konto.** Wurde das Scalingo-Konto über GitHub
angelegt, schlägt `scalingo login` fehl: es probiert zuerst SSH (scheitert ohne
hinterlegten Schlüssel) und fragt dann nach einem Passwort, das bei OAuth nicht
existiert. Stattdessen einen API-Token verwenden:

1. https://dashboard.scalingo.com/account/tokens öffnen
2. „Create new token", Namen vergeben, erzeugen
3. Token kopieren — er wird **nur einmal** angezeigt
4. Anmelden:

```bash
read -rsp "API-Token: " TOKEN && echo && scalingo login --api-token "$TOKEN" && unset TOKEN
scalingo whoami
```

`read -rsp` hält den Token aus der Terminalausgabe und aus `~/.bash_history`
heraus — ein direktes `scalingo login --api-token abc123…` täte beides.

Alternativen: ein Passwort im Profil nachtragen, oder einen SSH-Schlüssel
hinterlegen; dann funktioniert `scalingo login` direkt.

Firewall muss erlauben: `auth.scalingo.com:443`, `api.<region>.scalingo.com:443`,
`ssh.<region>.scalingo.com:22`, `one-off.<region>.scalingo.com:5000`.

### 2. App anlegen

```bash
scalingo create plain-test
```

Region wählen: `osc-fr1` (Frankreich) oder `osc-secnum-fr1` (SecNumCloud).
Für deutsche Kundschaft ist der EU-Standort ohnehin gesetzt.

### 3. Umgebungsvariablen setzen

**Pflicht — ohne diese startet die App nicht:**

```bash
scalingo --app plain-test env-set \
  JWT_SECRET="<derselbe Wert wie in Railway>" \
  SUPABASE_URL="<aus Railway uebernehmen>" \
  SUPABASE_SERVICE_KEY="<aus Railway uebernehmen>"
```

> Der Service-Key ist der aus dem Pentest bekannte, in der Git-Historie liegende
> Schlüssel. Falls du ihn inzwischen rotiert hast: hier den **neuen** eintragen.

**Für den Testbetrieb notwendig:**

```bash
scalingo --app plain-test env-set \
  NODE_ENV="production" \
  DISABLE_BACKGROUND_JOBS="true" \
  PLAYWRIGHT_BROWSERS_PATH="/app/.playwright"
```

`NODE_ENV=production` schaltet die Stacktrace-Ausgabe ab und deaktiviert die
localhost-Ausnahme in der CORS-Allowlist (Pentest-Befund).

`PLAYWRIGHT_BROWSERS_PATH` legt fest, wohin Chromium beim Build installiert wird
und wo es zur Laufzeit gesucht wird. Ohne diese Variable landet es im
Home-Verzeichnis und ist nach dem Build unter Umständen nicht mehr auffindbar —
die häufigste Ursache dafür, dass die PDF-Erzeugung genau hier scheitert.

**Erst setzen, wenn die URL bekannt ist** (nach dem ersten Deploy, Schritt 5):

```bash
scalingo --app plain-test env-set \
  FRONTEND_URL="https://plain-test.osc-fr1.scalingo.io" \
  CORS_ORIGINS="https://plain-test.osc-fr1.scalingo.io"
```

**Optional, je nachdem was du testen willst:**

| Variable | Wofür |
|---|---|
| `EMAIL_ENC_KEY` | Entschlüsselt gespeicherte SMTP-Zugangsdaten. Ohne sie schlägt der Mailversand fehl — für einen Startbarkeits-Test verzichtbar. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Mailversand über Resend |
| `SMTP_*` | Mailversand über SMTP |
| `LICENSE_STATE_ENFORCEMENT` | Lizenzdurchsetzung |

**Nicht setzen:** `PORT` (setzt Scalingo selbst), `RAILWAY_*` (gilt nur für Railway).

### 4. Deployen

Zwei Wege — für den ersten Versuch ist Git-Push der direktere:

```bash
# Variante A: direkt pushen
scalingo --app plain-test git-setup
git push scalingo main

# Variante B: an GitHub koppeln (spaeter, fuer Auto-Deploy)
scalingo integrations-add github
scalingo --app plain-test integration-link-create \
  --auto-deploy --branch main https://github.com/semmolino/plain
```

Der Build dauert deutlich länger als bei Railway: zweimal `npm ci`, Vite-Build und
der Chromium-Download (~150 MB).

### 5. Container dimensionieren

```bash
scalingo --app plain-test scale web:1:M
```

Die Standardgröße S (512 MB) reicht für Node **plus** Chromium erfahrungsgemäß
nicht. M (1 GB) ist die realistische Untergrenze; wenn die PDF-Erzeugung ohne
erkennbare Fehlermeldung stirbt, ist Speichermangel der erste Verdacht.

### 6. Prüfen

```bash
scalingo --app plain-test logs --lines 100
scalingo --app plain-test logs --follow
```

Im Log erwartet:

```
✅ Backend läuft auf Port 
⏸  Hintergrund-Checker deaktiviert (DISABLE_BACKGROUND_JOBS=true)
```

Fehlt die zweite Zeile, ist `DISABLE_BACKGROUND_JOBS` nicht gesetzt — dann sofort
nachsetzen und neu starten, bevor die Checker feuern.

Dann im Browser `https://plain-test.osc-fr1.scalingo.io` öffnen und die
Testfälle unten durchgehen.

---

## Wenn es schiefgeht

Nach Wahrscheinlichkeit sortiert:

**Build bricht ab mit „unable to locate package"**
Ein Paketname im `Aptfile` existiert auf dem Stack nicht. Häufigster Kandidat:
`libasound2` heißt auf neueren Ubuntu-Versionen `libasound2t64`. Stack prüfen mit
`scalingo --app plain-test stacks-list`.

**App startet, aber PDF-Erzeugung schlägt fehl**
Reihenfolge zum Eingrenzen:
1. `PLAYWRIGHT_BROWSERS_PATH` gesetzt? Muss beim Build *und* zur Laufzeit gelten.
2. Container groß genug? Siehe Schritt 5.
3. Fehlt eine Bibliothek? Im One-off-Container nachsehen:
   ```bash
   scalingo --app plain-test run bash
   ldd /app/.playwright/chromium-*/chrome-linux/chrome | grep "not found"
   ```
   Was dort als `not found` erscheint, gehört ins `Aptfile`.

**Build läuft, aber `npm ci` findet die Unterprojekte nicht**
`scalingo-postbuild` in der Root-`package.json` prüfen — die Pfade `--prefix backend`
und `--prefix frontend-react` sind relativ zum Repository-Wurzelverzeichnis.

**App startet nicht, Log zeigt „JWT_SECRET environment variable is required"**
Variable fehlt. `scalingo --app plain-test env` zeigt, was gesetzt ist.

**Frontend lädt nicht, API antwortet aber**
`FRONTEND_DIST` zeigt auf `frontend-react/dist`. Wenn der Vite-Build im
`scalingo-postbuild` nicht durchlief, fehlt das Verzeichnis. Im Build-Log nach
`vite build` suchen.

**Login schlägt fehl, Netzwerk-Tab zeigt CORS-Fehler**
`CORS_ORIGINS` auf die Scalingo-URL setzen (Schritt 3, zweiter Block).

---

## Danach

Läuft die App hier stabil, ist der schwierigste Teil der Migration beantwortet:
Buildpack, Chromium und Betrieb funktionieren. Offen bleibt dann nur noch die
Frage, ob **PostgREST** unter einem Buildpack läuft — der zweite kritische Test
aus dem Migrationsplan.

Erst wenn beides steht, lohnt sich der Datenbankumzug.

---

## Testfälle

**1. App erreichbar**
- `https://plain-test.osc-fr1.scalingo.io` öffnen → Login-Seite erscheint
- `scalingo --app plain-test logs` zeigt `✅ Backend läuft auf Port …`

**2. Hintergrund-Checker sind aus** *(vor allem anderen prüfen)*
- Log enthält `⏸ Hintergrund-Checker deaktiviert`
- Falls nicht: sofort `DISABLE_BACKGROUND_JOBS=true` setzen und neu starten

**3. Anmeldung gegen Supabase**
- Mit einem bestehenden Konto anmelden → Dashboard lädt
- Damit ist bewiesen, dass Scalingo die Supabase-Instanz erreicht

**4. Lesender Zugriff**
- Projekte, Adressen, Rechnungen öffnen → Listen sind gefüllt und identisch zu Railway

**5. PDF-Erzeugung** *(der eigentliche Risikotest)*
- Eine bestehende Rechnung öffnen, PDF erzeugen → Dokument öffnet sich korrekt
- Schlägt das fehl: Abschnitt „Wenn es schiefgeht" durchgehen

**6. Schreibender Zugriff**
- Ein Testprojekt anlegen → erscheint auch in der Railway-Instanz
- Anschließend wieder löschen (es ist dieselbe Datenbank, also echte Daten)

**7. Kein Dauerbetrieb**
- Nach dem Test die App stoppen (`scalingo --app plain-test scale web:0`),
  damit nichts unbeaufsichtigt gegen die Produktivdatenbank läuft
