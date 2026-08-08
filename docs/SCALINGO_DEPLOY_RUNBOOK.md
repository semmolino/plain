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
| `Procfile` | Startkommando: `web: bash bin/start-web.sh` |
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
4. Diese Zeile **unverändert** ausführen — den Token *nicht* hineinschreiben:

```bash
read -rsp 'API-Token: ' TOKEN
```

5. Der Cursor wartet nun hinter `API-Token:`. Token einfügen mit **Rechtsklick →
   Paste** oder **Shift+Einfg** (Strg+V funktioniert in MINGW64 nicht). Es
   erscheint nichts — die Eingabe ist absichtlich unsichtbar. Dann Enter.

6. Kontrollieren und anmelden:

```bash
echo "${#TOKEN} Zeichen"          # muss ~50 sein, nicht 0
scalingo login --api-token "$TOKEN" && unset TOKEN
scalingo whoami
```

> **Häufiger Fehler:** Den Token in die `read`-Zeile schreiben
> (`read -rsp "API-Token: tk-us-…" TOKEN`). Alles zwischen den Anführungszeichen
> ist nur der *Anzeigetext* — der Token landet dadurch unverschlüsselt in
> `~/.bash_history` und `$TOKEN` bleibt leer. Die Anmeldung scheitert dann mit
> `user unauthenticated`, und der Token ist zu widerrufen.

`read -rsp` hält den Token aus der Terminalausgabe und aus `~/.bash_history`
heraus — ein direktes `scalingo login --api-token tk-us-…` täte beides.

Alternativen: ein Passwort im Profil nachtragen, oder einen SSH-Schlüssel
hinterlegen; dann funktioniert `scalingo login` direkt.

Firewall muss erlauben: `auth.scalingo.com:443`, `api.<region>.scalingo.com:443`,
`ssh.<region>.scalingo.com:22`, `one-off.<region>.scalingo.com:5000`.

### 2. App anlegen

```bash
scalingo create planandsimple
```

Region wählen: `osc-fr1` (Frankreich) oder `osc-secnum-fr1` (SecNumCloud).
Für deutsche Kundschaft ist der EU-Standort ohnehin gesetzt.

### 3. Umgebungsvariablen setzen

**Pflicht — ohne diese startet die App nicht:**

```bash
scalingo --app planandsimple env-set \
  JWT_SECRET="<derselbe Wert wie in Railway>" \
  SUPABASE_URL="<aus Railway uebernehmen>" \
  SUPABASE_SERVICE_KEY="<aus Railway uebernehmen>"
```

> Der Service-Key ist der aus dem Pentest bekannte, in der Git-Historie liegende
> Schlüssel. Falls du ihn inzwischen rotiert hast: hier den **neuen** eintragen.

**Für den Testbetrieb notwendig:**

```bash
scalingo --app planandsimple env-set \
  NODE_ENV="production" \
  DISABLE_BACKGROUND_JOBS="true" \
  PLAYWRIGHT_BROWSERS_PATH="0" \
  PLAYWRIGHT_HOST_PLATFORM_OVERRIDE="ubuntu24.04-x64"
```

`NODE_ENV=production` schaltet die Stacktrace-Ausgabe ab und deaktiviert die
localhost-Ausnahme in der CORS-Allowlist (Pentest-Befund).

`PLAYWRIGHT_BROWSERS_PATH=0` legt Chromium in `node_modules` ab. Ein absoluter
Pfad wie `/app/.playwright` funktioniert **nicht**: Scalingo baut in
`/build/<uuid>/` und verschiebt den Inhalt erst danach nach `/app` — alles
ausserhalb des Build-Verzeichnisses ist nach dem Deployment verschwunden.

`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` ist noetig, weil Scalingo auf
Ubuntu 26.04 laeuft, Playwright 1.57 aber nur bis 24.04 kennt und sonst abbricht
mit `does not support chromium on ubuntu26.04-x64`.

**Erst setzen, wenn die URL bekannt ist** (nach dem ersten Deploy, Schritt 5):

```bash
scalingo --app planandsimple env-set \
  FRONTEND_URL="https://planandsimple.osc-fr1.scalingo.io" \
  CORS_ORIGINS="https://planandsimple.osc-fr1.scalingo.io"
```

**Optional, je nachdem was du testen willst:**

| Variable | Wofür |
|---|---|
| `EMAIL_ENC_KEY` | Entschlüsselt gespeicherte SMTP-Zugangsdaten. Ohne sie schlägt der Mailversand fehl — für einen Startbarkeits-Test verzichtbar. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Mailversand über Eusend (SMTP) |
| `SMTP_*` | Mailversand über SMTP |
| `LICENSE_STATE_ENFORCEMENT` | Lizenzdurchsetzung |

**Nicht setzen:** `PORT` (setzt Scalingo selbst), `RAILWAY_*` (gilt nur für Railway).

### 4. Deployen

Scalingo ist per Auto-Deploy an das GitHub-Repository gekoppelt. **Ein Push nach
`origin/main` genügt** — der Build startet von selbst, genau wie bei Railway:

```bash
git push origin main
```

Oder mit Begleitung (wartet auf den Build, setzt Containergröße und URL):

```bash
bash scripts/scalingo/02_deploy.sh
```

Falls die Kopplung noch nicht steht:

```bash
scalingo integrations-add github
scalingo --app planandsimple integration-link-create \
  --auto-deploy --branch main https://github.com/semmolino/plain
```

> **Nicht zusätzlich direkt pushen.** Ein `git push scalingo main` neben dem
> Push nach GitHub löst einen **zweiten** Build desselben Commits aus — doppelte
> Buildzeit ohne Nutzen. Der `scalingo`-Remote wurde deshalb entfernt.

Der Build dauert deutlich länger als bei Railway: zweimal `npm ci`, Vite-Build und
der Chromium-Download (~150 MB).

### 5. Container dimensionieren

```bash
scalingo --app planandsimple scale web:1:M
```

Die Standardgröße S (512 MB) reicht für Node **plus** Chromium erfahrungsgemäß
nicht. M (1 GB) ist die realistische Untergrenze; wenn die PDF-Erzeugung ohne
erkennbare Fehlermeldung stirbt, ist Speichermangel der erste Verdacht.

### 6. Prüfen

```bash
scalingo --app planandsimple logs --lines 100
scalingo --app planandsimple logs --follow
```

Im Log erwartet:

```
✅ Backend läuft auf Port 
⏸  Hintergrund-Checker deaktiviert (DISABLE_BACKGROUND_JOBS=true)
```

Fehlt die zweite Zeile, ist `DISABLE_BACKGROUND_JOBS` nicht gesetzt — dann sofort
nachsetzen und neu starten, bevor die Checker feuern.

Dann im Browser `https://planandsimple.osc-fr1.scalingo.io` öffnen und die
Testfälle unten durchgehen.

---

## Wenn es schiefgeht

Nach Wahrscheinlichkeit sortiert:

**Build bricht ab mit „unable to locate package"**
Ein Paketname im `Aptfile` existiert auf dem Stack nicht. Häufigster Kandidat:
`libasound2` heißt auf neueren Ubuntu-Versionen `libasound2t64`. Stack prüfen mit
`scalingo --app planandsimple stacks-list`.

**App startet, aber PDF-Erzeugung schlägt fehl**
Reihenfolge zum Eingrenzen:
1. Beide Playwright-Variablen gesetzt? `PLAYWRIGHT_BROWSERS_PATH=0` und
   `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`. Sie müssen beim Build
   *und* zur Laufzeit gelten.
2. Container groß genug? Siehe Schritt 5.
3. Fehlt eine Bibliothek? Im One-off-Container nachsehen:
   ```bash
   scalingo --app planandsimple run bash
   find /app -name chrome -type f | head -1 | xargs ldd | grep "not found"
   ```
   Was dort als `not found` erscheint, gehört ins `Aptfile`.

   > Der One-off-Zugang braucht Port **5000** ausgehend. Ist der im Netz
   > gesperrt (wie im Arbeitsnetz gemessen), scheitert `scalingo run` mit einem
   > Verbindungs-Timeout — dann hilft nur ein anderes Netz, etwa ein Hotspot.

**Build läuft, aber `npm ci` findet die Unterprojekte nicht**
`scalingo-postbuild` in der Root-`package.json` prüfen — die Pfade `--prefix backend`
und `--prefix frontend-react` sind relativ zum Repository-Wurzelverzeichnis.

**App startet nicht, Log zeigt „JWT_SECRET environment variable is required"**
Variable fehlt. `scalingo --app planandsimple env` zeigt, was gesetzt ist.

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
- `https://planandsimple.osc-fr1.scalingo.io` öffnen → Login-Seite erscheint
- `scalingo --app planandsimple logs` zeigt `✅ Backend läuft auf Port …`

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
- Nach dem Test die App stoppen (`scalingo --app planandsimple scale web:0`),
  damit nichts unbeaufsichtigt gegen die Produktivdatenbank läuft
