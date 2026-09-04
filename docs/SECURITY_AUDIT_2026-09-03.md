# Sicherheitsaudit — Erstbefund 2026-09-03

**Umfang:** Backend, Frontend, Owner-Konsole, Build und Deployment-Konfiguration — Stand `main` @ `67e382b`
**Methodik:** `docs/SECURITY_AUDIT_CONCEPT.md`, Abschnitte 4 und 7
**Nicht enthalten:** Prüfung der laufenden Instanz (siehe „Offen: Betriebsprüfungen")

---

## Stand der Behebung (2026-09-03, abends)

`POSTGREST_ENABLED=true` ist bestätigt — **RLS ist produktiv scharf.** Damit bleibt M3 bei „mittel" statt auf „hoch" zu steigen.

Der Scanner zählt **23 → 1 Befund** (der bewusst abgeschaltete CSP-Hinweis). Alle Prüfungen grün: 593 Backend-Tests in 42 Suites, 44 Frontend-Unit-Tests, `tsc` sauber, Design-Check sauber, `npm audit` in Backend **und** Frontend ohne Funde.

| | Befund | Stand |
|---|---|---|
| H1 | SVG im eigenen Origin ausführbar | **behoben** — `services/fileResponse.js` (Inline-Allowlist, `nosniff`, Sandbox-CSP), genutzt von `assets.js` und `service.js` |
| H2 | Projektzuordnung ohne Recht | **behoben** — `projects.edit`; Stundensatz zusätzlich `projects.hourly_rates.edit` |
| H3 | Zeitpläne ohne Recht änder- und auslösbar | **behoben** — `settings.notifications.edit`, Backend und Oberfläche |
| H4 | verwundbare Abhängigkeiten | **behoben** — nodemailer 9, react-router-dom 7.18.3, vitest 4; beide Bäume ohne Funde |
| M1 | Filter-Injektion in `.or()` (7 Stellen) | **behoben** — `services/pgrestFilter.js` + 11 Regressionstests |
| M2 | Reset-Token wirkt wie eine Sitzung | **behoben** — `verifySessionToken`, von Middleware und beiden Endpunkten genutzt |
| M3 | Mandant aus dem Objekt (4 Stellen) | **behoben** — `tenantId` ist Pflicht, 13 Aufrufstellen nachgezogen |
| M4 | Sitzungen nicht zurücknehmbar | **behoben und scharf** — Migration 0134 am 2026-09-03 eingespielt |
| M5 | `node_modules` versioniert | **behoben** — 1.822 Dateien aus dem Index (Platte unberührt) |
| M6 | teure Endpunkte ungedrosselt | **behoben** — Limits pro Konto, nicht pro IP (`middleware/rateLimit.js`) |
| M8 | Datenbankmeldungen erreichen den Client | **behoben** — Filter in `middleware/errorSanitizer.js`, Fehlerkennung im Protokoll |
| N1 | veralteter Sicherheitsabschnitt | **behoben** — `CLAUDE.md` neu geschrieben |
| N6 | keine Bremse je Konto | **behoben** — progressive Verzögerung (`middleware/loginAttempts.js`), bewusst keine Sperre |
| M7 | Klartext-Passwörter login-fähig | offen — braucht eine Zahl aus der Datenbank, siehe unten |
| N2 | CSP abgeschaltet | offen (bewusst) |
| N3 | Registrierung ohne E-Mail-Bestätigung | **behoben** — zwei Tore, Migration 0135 einzuspielen |

### M4 — Sitzungs-Rücknahme

Migration `0134_employee_session_epoch.sql` ist **am 2026-09-03 eingespielt**. Laufende Sitzungen enden damit sofort bei Passwortwechsel, Passwort-Reset und Rollenänderung; deaktivierte Mitarbeiter (`ACTIVE=2`) werden beim nächsten Aufruf abgewiesen statt erst nach bis zu 8 Stunden.

Beteiligte Teile: `middleware/sessionGuard.js` (Prüfung + `revokeSessions`), `middleware/auth.js` (`req.tokenIssuedAt`), `server.js` (in der authChain **hinter** `tenantScope` — davor liegt kein Mandanten-Claim an, und die Prüfung würde jeden aussperren), `routes/auth.js`, `controllers/roles.js`, `api/client.ts` (401 → abmelden), `ProfilePage.tsx`.

### Zusätzlich beim Beheben gefunden und mitbehoben

- `GET /employee2project/preset` filterte als einziger Endpunkt seiner Datei nicht auf `TENANT_ID` (RLS fing es ab, die zweite Linie fehlte).
- `POST /number-ranges/templates/preview` war ungegatet, während beide Nachbarn `settings.numbers.edit` verlangen — angeglichen.
- `POST /assets/upload` hatte kein Gate. Jetzt nach Art differenziert: `AVATAR` bleibt Selbstbedienung, `LOGO`/`SIGNATURE`/`TENANT_HERO` verlangen `settings.company.edit`, `INVOICE_ATTACHMENT` verlangt `invoices.edit`. Unbekannte Arten sind fail-closed.
- Im Frontend fehlte eine 401-Behandlung: ein zurückgenommenes Token hätte nur Fehlermeldungen erzeugt, statt zur Anmeldung zu führen.

### Manuell verifiziert (2026-09-03)

1. **Migration 0134 eingespielt** — M4 ist wirksam.
2. **Testmail zugestellt** — nodemailer 9 arbeitet im Betrieb; der Major-Sprung hat den Versand nicht gebrochen.
3. **`POSTGREST_ENABLED=true`** — RLS ist scharf, die Mandantentrennung trägt auf beiden Linien.

### Noch zu beobachten

**Rollen:** Wer Projektteams pflegt oder Benachrichtigungs-Zeitpläne stellt, braucht jetzt `projects.edit` bzw. `settings.notifications.edit`. Rollen ohne diese Rechte verlieren die Funktion — beabsichtigt, aber es sollte zum Team passen. Fällt im Alltag als 403 auf.

**Fehlerkennungen:** Serverfehler zeigen ab jetzt eine allgemeine Meldung plus eine sechsstellige Kennung. Wenn ein Nutzer „Fehler a3f9c1" meldet, steht die Originalmeldung mit Mandant und Mitarbeiter im Anwendungsprotokoll. Beim lokalen Entwickeln (`NODE_ENV=development`) bleibt die Originalmeldung in der Antwort.

---

## Die letzten offenen Punkte

### M7 — Klartext-Passwörter (braucht eine Zahl)

`routes/auth.js` vergleicht Passwörter ohne bcrypt-Präfix direkt als Zeichenkette — ein Rückfall für Konten aus der Frühphase. Ob es solche Konten überhaupt noch gibt, sagt nur die Datenbank. Der Befehl gibt eine Zahl aus, keine Passwörter:

```
scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -c "SELECT COUNT(*) FROM \"EMPLOYEE\" WHERE \"PASSWORD\" IS NOT NULL AND \"PASSWORD\" NOT LIKE '"'"'$2%'"'"';"'
```

- **Ergebnis 0:** Der Zweig kann ersatzlos entfernt werden — reine Code-Änderung.
- **Ergebnis > 0:** Die betroffenen Konten brauchen vorher einen erzwungenen Reset. Das ist eine Ansage an echte Menschen und kein reiner Code-Schritt; der Zweig fällt erst danach.

Nebenbei ist der Vergleich nicht zeitkonstant. Ohne Klartextkonten erledigt sich das mit dem Zweig.

### N3 — Registrierung: zwei Tore (behoben, Migration 0135 ausstehend)

**Nur der Signup neuer Mandanten war betroffen.** Der andere Weg — ein bestehender Mandant legt einen Mitarbeiter an — hatte den Adressnachweis schon eingebaut: der Admin legt das Konto **ohne Passwort** an, der Mitarbeiter setzt es über einen Einladungslink an seine Adresse, und eine Anmeldung ohne gesetztes Passwort ist serverseitig gesperrt ([accountInvite.js](backend/services/accountInvite.js)). Dort war nichts zu tun.

`POST /auth/signup` dagegen legte Mandant, Firma und Erst-Nutzer in einem Zug an, mit sofort nutzbarem Passwort. Jetzt zwei Tore, in dieser Reihenfolge:

1. **E-Mail-Bestätigung** — Link, 24 h gültig, landet auf `/registrierung-bestaetigen`.
2. **Freigabe durch den Betreiber** — Owner-Konsole → Tab „Registrierungen".

Bis beide durch sind, ist die Anmeldung gesperrt ([auth.js](backend/routes/auth.js), geprüft **nach** der Passwortprüfung: wer das Passwort nicht kennt, erfährt über den Zustand eines Mandanten nichts). In einem später abgelehnten Mandanten entsteht damit kein einziger Datensatz.

**Zustände** (`TENANTS.SIGNUP_STATE`): `pending_email` → `pending_approval` → `active`. Der Spaltenstandard ist `active`, nicht `pending_email` — Import, Demo-Daten und manuelles SQL sollen weiterhin benutzbare Mandanten erzeugen. Die Sperre sitzt an genau einer Stelle, nicht im Default.

**Ablehnen löscht** (Entscheidung vom 2026-09-04): Mandant, Firma und Erst-Nutzer werden unwiderruflich entfernt. Zwei Schranken:

- Gelöscht wird **nur** im Zustand *pending* — ein freigegebener Mandant mit echten Daten ist über diesen Weg nicht erreichbar, auch nicht mit von Hand gesetzter ID.
- Die Ablehnung landet im Änderungsprotokoll (Firma, Adresse, Grund, wer). Die Daten sind weg, die Entscheidung bleibt nachvollziehbar.
- In der Konsole muss der Firmenname abgetippt werden. In einer Liste gleich aussehender Zeilen wäre ein Fehlklick sonst ein Datenverlust ohne Weg zurück.

**Benachrichtigungen:** Der Anmelder bekommt Bestätigungs-, Freigabe- und Ablehnungsmail. Die Plattform-Admins werden über einen neuen Antrag informiert — Empfänger sind die aktiven `PLATFORM_ADMIN`-Adressen, keine eigene Umgebungsvariable, die man beim Betreiberwechsel vergessen könnte. Geht eine Mail nicht raus, sagt die Konsole es und die Freigabe gilt trotzdem.

**Einzuspielen:**

```
scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0135_tenant_signup_approval.sql'
```

Ohne die Migration verhält sich alles wie bisher: die Sperre greift nicht (`loginSperre` lässt einen leeren Zustand durch), und die Konsole zeigt einen Hinweis statt einer leeren Liste. Eine fehlende Migration darf niemanden aussperren.

---

## Gesamtbild

Der Stand ist **deutlich besser, als der Sicherheitsabschnitt in `CLAUDE.md` behauptet.** Die dort als offen geführten Punkte — hartkodierter JWT-Rückfall, `cors()` ohne Allowlist, fehlendes Rate-Limiting — sind erledigt: `server.js` bricht beim Start ab, wenn `JWT_SECRET` fehlt oder den Standardwert trägt; CORS läuft über eine Allowlist und nur auf `/api`; alle fünf Auth-Wege haben eigene Limiter. Die Mandantentrennung ist seit dem Scalingo-Umzug **zweilinig**: Anwendungsfilter plus RLS mit `FORCE ROW LEVEL SECURITY`, fail-closed ohne Claim.

Die verbleibenden Befunde sind fast alle **Reste desselben Musters**, das der Pentest vom 2026-08-06 aufgedeckt hat: Eine Stelle wurde behoben, die Zwillingsstelle nicht. Das ist die gute Nachricht — es gibt jeweils schon eine richtige Fassung im Code, an der sich die Korrektur orientieren kann.

| Grad | Anzahl |
|---|---|
| Kritisch | 0 |
| Hoch | 4 |
| Mittel | 8 |
| Niedrig / Hinweis | 6 |

---

## Hoch

### H1 · Hochgeladenes SVG wird im eigenen Origin ausgeführt
**Ort:** [assets.js:41](backend/routes/assets.js#L41) (Upload erlaubt `image/svg+xml`) · [assets.js:146-147](backend/routes/assets.js#L146-L147) (Auslieferung)

Der Upload lässt `image/svg+xml` zu. `GET /api/v1/assets/:id` liefert die Datei mit dem **MIME-Typ aus der Datenbank** und `Content-Disposition: inline` aus — auf derselben Origin wie die Anwendung. Die CSP ist bewusst abgeschaltet, und das JWT liegt im `localStorage` (`zustand/persist`).

**Auslöser:** Ein Mitarbeiter mit Upload-Zugang legt ein SVG mit `<script>` ab und schickt einem Kollegen den Link `…/api/v1/assets/123`. Beim Öffnen läuft das Skript im Origin der Anwendung und liest das Token des Kollegen aus. Innerhalb des Mandanten ist damit jede Rolle übernehmbar — auch der Administrator.

**Falsifikation geprüft:** Die Mandantengrenze hält (`.eq("COMPANY_ID", companyId)`), fremde Mandanten sind nicht betroffen. `X-Content-Type-Options: nosniff` setzt helmet global — das hilft gegen Sniffing, nicht gegen einen *deklarierten* `image/svg+xml`.

**Empfehlung:** [branding.js:113-118](backend/routes/branding.js#L113-L118) macht es bereits richtig und trägt die Begründung im Kommentar. Dieselbe Allowlist auf `assets.js` anwenden; `image/svg+xml` entweder aus `ALLOWED_MIME` streichen oder ausschließlich als `attachment` ausliefern. Dieselbe Prüfung gilt für [service.js:662-663](backend/routes/service.js#L662-L663).

---

### H2 · Projektzuordnung und Stundensätze ohne Rechteprüfung
**Ort:** [employee2project.js:108](backend/routes/employee2project.js#L108), [:134](backend/routes/employee2project.js#L134), [:159](backend/routes/employee2project.js#L159)

Alle drei mutierenden Endpunkte tragen **kein** Permission-Gate — weder an der Route noch im Handler noch im Controller. Die Datei importiert `requirePermission` nicht einmal (dasselbe Bild wie bei `budgetWarnings.js` im Pentest 2026-08-06).

**Auslöser:** Jeder angemeldete Mitarbeiter — auch einer mit der Rolle „Mitarbeiter", die nur `dashboard.view` und `addresses.view` hat — kann sich per `POST /api/v1/employee2project/project/:projectId` selbst jedem Projekt des Mandanten zuordnen, Rollen vergeben und über `SP_RATE` **Stundensätze setzen**. Stundensätze fließen in die Kostenrechnung; ein geänderter Satz verfälscht Reports und Nachkalkulation.

**Falsifikation geprüft:** Der `TENANT_ID`-Filter ist bei `PATCH` und `DELETE` vorhanden, die Mandantengrenze hält also. Es fehlt ausschließlich RBAC.

**Empfehlung:** `projects.edit` (oder `employees.edit` für die Zuordnung) — Katalog in `0062_rbac_foundation.sql` prüfen, keine neue Permission nötig.

---

### H3 · Benachrichtigungs-Zeitpläne änderbar und auslösbar ohne Recht
**Ort:** [notificationSchedule.js:11-12](backend/routes/notificationSchedule.js#L11-L12)

`PUT /:typeKey` und `POST /:typeKey/run-now` haben kein Gate; der Controller ebenfalls nicht.

**Auslöser:** Jeder angemeldete Nutzer kann die Zeitpläne des Mandanten umstellen (Erinnerungen abschalten — still, niemand bemerkt fehlende Mahnungen) und mit `run-now` einen sofortigen Lauf auslösen, der **E-Mails an echte Empfänger** verschickt. Wiederholt aufgerufen ist das zugleich ein Weg, den Mandanten beim Mailversender in Verruf zu bringen.

**Empfehlung:** `settings.notifications.edit` an den Router (`router.use(...)`), analog zu `routes/emailSettings.js:11`.

---

### H4 · Verwundbare Abhängigkeiten im produktiven Baum
**Ort:** `backend/package.json`, `frontend-react/package.json`

`npm audit --omit=dev` meldet im Backend **5 hohe** Schwachstellen. Am unmittelbarsten:

| Paket | Kurz | Warum hier relevant |
|---|---|---|
| **nodemailer** | CRLF-Injection in `List-*`-Header | Rechnungs- und Mahnungsmails werden aus Nutzerdaten gebaut — Header-Injection ist ein realer Pfad |
| **ip-address** | Oktal-Interpretation → SSRF-Umgehung | über `@aws-sdk/client-s3` im Baum |
| **ws**, **brace-expansion**, **path-to-regexp** | Speicher-/DoS | Erreichbarkeit im Betrieb prüfen |

Frontend: **react-router-dom** (high, Laufzeit) und **vitest** (critical, nur Entwicklung — kein Produktionsrisiko, aber CI-relevant).

**Empfehlung:** `npm audit fix` im Backend, `react-router-dom` aktualisieren; `vitest` beim nächsten Major mitziehen. Danach `--deps` in den täglichen CI-Lauf.

---

## Mittel

### M1 · Filter-Injektion in `.or()` — 7 Stellen
**Ort:** [mitarbeiter.js:636](backend/routes/mitarbeiter.js#L636), [projekte.js:507](backend/services/projekte.js#L507), [:521](backend/services/projekte.js#L521), [stammdaten.js:1080](backend/controllers/stammdaten.js#L1080), [:1238](backend/controllers/stammdaten.js#L1238), [arbzg.js:169](backend/services/arbzg.js#L169), [abwesenheit.js:17](backend/routes/abwesenheit.js#L17)

PostgREST liest den `.or()`-Ausdruck als **Struktur**, nicht als Wert. Ein Komma in der Sucheingabe erweitert die Bedingung.

**Auslöser:** `GET /api/v1/mitarbeiter/search?q=x%2CPASSWORD.ilike.$2a$10$a*` fügt eine zusätzliche Oder-Bedingung ein. Über Treffer/kein-Treffer lässt sich der bcrypt-Hash eines Kollegen zeichenweise ausfragen — ein Orakel innerhalb des eigenen Mandanten.

**Falsifikation geprüft:** Die Mandantengrenze hält, das `.eq("TENANT_ID", …)` bleibt per AND davor. RLS greift ebenfalls. Es geht um Rechteausweitung *innerhalb* eines Mandanten.

**Empfehlung:** Das Muster gibt es bereits zweimal richtig: `esc` in [invoices.js:433](backend/services/invoices.js#L433) und `likeEscape` in [auth.js:36-38](backend/routes/auth.js#L36-L38). Eine gemeinsame Hilfsfunktion, die zusätzlich `,` `(` `)` neutralisiert, und alle sieben Stellen darauf ziehen.

### M2 · Reset-Token wirkt in `/auth/me` wie eine Sitzung
**Ort:** [auth.js:285](backend/routes/auth.js#L285), [auth.js:324](backend/routes/auth.js#L324)

`middleware/auth.js:23` weist Token mit `purpose` bewusst ab — ein Passwort-Reset-Token darf keine Sitzung sein. Die beiden Endpunkte in `routes/auth.js` rufen `jwt.verify` jedoch **selbst** auf und prüfen `purpose` nicht.

**Auslöser:** Wer einen Reset-Link abfängt (Mail-Weiterleitung, geteiltes Postfach), kann damit `/auth/me` abfragen und — mit Kenntnis des aktuellen Passworts — `/auth/me/password` aufrufen, statt den Link nur einmal zu verbrauchen. Kein vollständiger Übernahmepfad, aber eine Zweckvermischung, die es an genau einer Stelle im Code schon nicht gibt.

**Empfehlung:** Eine gemeinsame `verifySession(token)`-Funktion, die `purpose` ablehnt, in `middleware/auth.js` *und* in beiden Endpunkten verwenden.

### M3 · Mandant aus dem Objekt statt aus der Sitzung — 4 Stellen
**Ort:** [invoices.js:307](backend/services/invoices.js#L307), [:356](backend/services/invoices.js#L356), [partialPayments.js:321](backend/services/partialPayments.js#L321), [:379](backend/services/partialPayments.js#L379)

`applyPerformanceAmount` leitet den Mandanten aus dem angefragten `PROJECT` ab, wenn der Aufrufer keinen mitgibt. Genau das Muster, gegen das `services/tenantGuard.js` geschrieben wurde — dessen Kopfkommentar diese Fälle sogar benennt.

**Wirkung heute:** Unter RLS entschärft (die `PROJECT`-Abfrage liefert nur eigene Zeilen, `tenantId` wird `null`). **Ohne** PostgREST — lokale Entwicklung, oder ein Rückfall auf den Service-Key-Weg — ist es voll wirksam. Die zweite Verteidigungslinie fehlt.

**Empfehlung:** `assertInTenant` aus `tenantGuard.js` benutzen; `tenantId` zur Pflichtangabe machen. `tenantGuard` wird bisher nur in 3 Dateien verwendet.

### M4 · Sitzungen sind nicht zurücknehmbar
JWT, 8 h, im `localStorage`. Abmelden löscht nur den Client-Zustand; ein abgeflossenes Token bleibt bis zum Ablauf gültig. Rollenentzug, Deaktivierung (`ACTIVE=2`) und Passwortwechsel wirken erst nach bis zu 8 Stunden.
**Empfehlung:** Das Gegenstück existiert bereits in der Owner-Konsole: `SESSION_EPOCH` + 30-Sekunden-Prüfcache in `owner-console/middleware/consoleAuth.js`. Dasselbe für `EMPLOYEE` — kleiner Eingriff, große Wirkung auf H1 und H2.

### M5 · `node_modules` ist versioniert — 1.822 Dateien
Sie machen 71 % des Git-Index aus, weichen laut `git status` **lokal modifiziert** vom Ursprungszustand ab und laufen an `package-lock.json` vorbei. Eine untergeschobene Änderung in einer Abhängigkeit wäre in diesem Rauschen nicht zu erkennen; der Build überschreibt sie ohnehin per `npm ci`.
**Empfehlung:** `git rm -r --cached backend/node_modules frontend-react/node_modules owner-console/node_modules` — `.gitignore` deckt sie bereits ab.

### M6 · Rate-Limits nur auf den Auth-Wegen
Teure Endpunkte sind ungedrosselt: PDF-Erzeugung startet je Aufruf **Playwright-Chromium**; Reports aggregieren über den ganzen Mandanten. Ein einzelnes Konto kann den Container erschöpfen — beide Prozesse (PostgREST und Node) sterben dann gemeinsam (`bin/start-web.sh`).
**Empfehlung:** Ein moderater globaler Limiter auf `/api` plus ein engerer auf die PDF-/Report-Pfade.

### M7 · Klartext-Passwörter sind weiterhin möglich
**Ort:** [auth.js:217](backend/routes/auth.js#L217) — `stored === (password || "")` als Rückfall für Konten ohne bcrypt-Hash. Der Vergleich ist zudem nicht zeitkonstant.
**Empfehlung:** Bestand zählen (siehe Betriebsprüfungen), betroffene Konten auf Reset zwingen, Zweig entfernen.

### M8 · Datenbankmeldungen erreichen den Client
176 Stellen antworten mit `error.message` aus PostgREST/Postgres. Das verrät Tabellen- und Spaltennamen, Constraint-Namen und Policy-Verletzungen und erleichtert das Sondieren.
**Empfehlung:** Im Controller-`catch` eine allgemeine Meldung ausgeben und das Original protokollieren. Das Fehlermuster in `CLAUDE.md` ist dafür schon der richtige Ort.

---

## Niedrig / Hinweis

- **N1 · `CLAUDE.md` führt behobene Lücken als offen**. Wer den Abschnitt liest, sucht an den falschen Stellen. → **behoben**, Abschnitt neu geschrieben.
- **N2 · CSP abgeschaltet** (`server.js:52`) — bewusste Entscheidung wegen SPA-Bundles und PDF-Auslieferung. Folge: Befunde wie H1 wiegen schwerer. Mittelfristig eine CSP mit `script-src 'self'` prüfen.
- **N3 · Registrierung ohne E-Mail-Bestätigung** — 10 Mandanten pro Stunde und IP sind anlegbar. Kein Sicherheits-, aber ein Missbrauchs- und Kostenrisiko. → **behoben**, siehe „Die letzten offenen Punkte".
- **N4 · `routes_gates.test.js` prüft nur zwei Dateien** — genau die aus dem Pentest. Neue Router fielen nicht auf. → **behoben** durch `scripts/security-scan.mjs` (Check G1 über alle Router).
- **N5 · Reset-Link im Klartext im Log**, wenn kein Mailversand konfiguriert ist ([auth.js:413](backend/routes/auth.js#L413)). Bewusst, aber Log-Zugriff = Kontoübernahme.
- **N6 · Keine Kontosperre** — der Limiter zählt pro IP; verteilte Versuche über viele Adressen laufen weiter. → **behoben** als progressive Verzögerung je Konto (bewusst keine Sperre, `middleware/loginAttempts.js`).

---

## Was gut ist (und so bleiben soll)

Damit eine spätere Änderung nicht versehentlich Schutz entfernt:

- **`db.js`** — Mandant als signierter Claim je Request, fail-closed ohne Claim, Token-Erneuerung auch in langlebigen Timern.
- **`05_rls_scalingo.sql`** — `FORCE ROW LEVEL SECURITY`, verifiziert gegen die migrierte Datenbank, mit eingebauter Selbstprüfung („ohne Claim → 0 Zeilen").
- **`assetAccess.js`** — zentrale Besitzprüfung, `404` statt `403`, damit fremde IDs nicht ermittelbar sind.
- **`routes/auth.js`** — `likeEscape` plus exakter Zweitvergleich, One-Time-Reset über Passwort-Fingerabdruck, keine Existenzpreisgabe.
- **Owner-Konsole** — eigenes Secret, eigene Audience, 2 h TTL, TOTP, Audit-Log auch für Fehlversuche, `SESSION_EPOCH`.
- **`server.js`** — Startabbruch statt stiller Fehlkonfiguration bei JWT, Objektspeicher und Datenbankweg.

---

## Offen: Betriebsprüfungen

Aus dem Repository nicht beantwortbar; entscheiden aber, ob der Schutz scharf ist. Vorgehen und Erwartungswerte: `docs/SECURITY_AUDIT_CONCEPT.md`, Abschnitt 4.8.

1. Sind `POSTGREST_ENABLED` und `POSTGREST_URL` produktiv gesetzt? **Ohne sie wirkt RLS nicht** — dann trägt die Trennung allein die Anwendungsschicht, und M3 wird zu einem hohen Befund.
2. Ist `05_rls_scalingo.sql` gegen die Scalingo-Datenbank eingespielt?
3. `NODE_ENV=production`? Sonst gilt die localhost-CORS-Ausnahme.
4. `DISABLE_BACKGROUND_JOBS` **nicht** gesetzt?
5. `CONSOLE_REQUIRE_TOTP=true`, und ist die Owner-Konsole von außen erreichbar?
6. Wie viele `EMPLOYEE.PASSWORD` beginnen nicht mit `$2` (Klartext, siehe M7)?

> Geprüft wird, **ob** eine Variable gesetzt ist — nie ihr Wert.

---

## Reihenfolge

1. **Sofort:** H2, H3 (je ein `requirePermission`, wenige Zeilen)
2. **Diese Woche:** H1 (Allowlist aus `branding.js` übernehmen), H4 (`npm audit fix`), Betriebsprüfungen 1–4
3. **Nächster Zyklus:** M1 (gemeinsame Escape-Funktion), M2, M4 (`SESSION_EPOCH`), M5
4. **Wenn die Stelle ohnehin angefasst wird:** M3, M6, M7, M8, N1–N6

Jeder behobene Befund verschwindet beim nächsten `node scripts/security-scan.mjs --update-baseline` aus der Baseline — das ist die Fortschrittsanzeige.
