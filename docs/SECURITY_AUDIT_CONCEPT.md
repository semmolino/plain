# Sicherheitsaudit — Konzept

**Stand:** 2026-09-03 · **Gilt für:** plan&simple (Backend, Frontend, Owner-Konsole, Scalingo-Betrieb)
**Zugehörig:** `docs/SECURITY_AUDIT_2026-09-03.md` (Erstbefund) · `scripts/security-scan.mjs` (automatischer Teil) · `.claude/agents/security-auditor.md` (wiederkehrende Prüfung)

---

## 1. Warum dieses Konzept so aussieht

plan&simple verwaltet Honorare, Verträge, Rechnungen und Mitarbeiterdaten mehrerer Architekturbüros in **einer** Datenbank. Der teuerste denkbare Fehler ist deshalb nicht ein Ausfall, sondern **eine Zeile, die im falschen Mandanten sichtbar wird**.

Die Befunde des Pentests vom **2026-08-06** waren keine exotischen Lücken, sondern **Wiederholungen desselben Musters**:

- ein vergessenes `requirePermission` an einem mutierenden Endpunkt,
- der Mandant aus dem *angefragten Objekt* statt aus der *Sitzung* abgeleitet,
- eine Datei mit dem MIME-Typ aus der Datenbank ausgeliefert.

Ein Mensch findet solche Muster beim dritten Mal nicht mehr zuverlässig. Deshalb ist dieses Konzept in zwei Hälften geteilt: **was ein Skript prüfen kann, prüft ein Skript** — und die menschliche bzw. agentische Prüfung konzentriert sich auf das, was Urteilsvermögen braucht.

---

## 2. Geltungsbereich

| Im Umfang | Nicht im Umfang |
|---|---|
| Backend (Express, Routen, Services, Middleware) | Penetrationstest gegen die Live-Instanz (separat zu beauftragen) |
| Mandantentrennung: Anwendungsfilter **und** RLS | Physische Sicherheit / Scalingo-Infrastruktur |
| RBAC- und Lizenz-Gates | Vollständige DSGVO-Prüfung (nur technische Schnittmenge) |
| Authentifizierung, Sitzungen, Passwortwege | Code Dritter unterhalb von `node_modules` (nur per `npm audit`) |
| Datei-Upload und -Auslieferung, Objektspeicher | Fachliche Richtigkeit von HOAI/E-Rechnung (eigene Reviewer-Agenten) |
| Frontend: Token-Ablage, XSS-Flächen | |
| Owner-Konsole (läuft mit `sys`-Claim — höchstes Risiko) | |
| Abhängigkeiten (Backend produktiv, Frontend Laufzeit) | |
| Betriebskonfiguration auf Scalingo (Env, RLS scharf?) | |

---

## 3. Schweregrade

Bewertet wird **Wirkung × Erreichbarkeit**, nicht CVSS.

| Grad | Bedeutung | Frist |
|---|---|---|
| **Kritisch** | Mandantengrenze fällt, Fremdzugriff ohne Anmeldung, Geheimnis öffentlich | sofort, vor dem nächsten Deploy |
| **Hoch** | Rechteausweitung innerhalb eines Mandanten, Sitzungsübernahme, Datenabfluss mit Konto | 14 Tage |
| **Mittel** | Zweite Verteidigungslinie fehlt; ausnutzbar nur in Kombination | nächster Zyklus |
| **Niedrig/Hinweis** | Härtung, Doku-Drift, Betriebshygiene | wenn die Stelle ohnehin angefasst wird |

**Doku-Drift zählt mit.** Ein Sicherheitsabschnitt, der behebbare Lücken als offen führt (oder umgekehrt), lenkt Aufmerksamkeit von den echten weg. Er wird wie ein Befund behandelt.

---

## 4. Prüfbereiche

Jeder Bereich nennt die Frage, den Ort und — wo vorhanden — den automatischen Check.

### 1. Mandantentrennung (höchste Priorität)
Halten **beide** Linien? Anwendungsfilter (`.eq('TENANT_ID', …)`) *und* RLS in der Datenbank.
Orte: `backend/db.js`, `backend/scripts/migration/05_rls_scalingo.sql`, `services/tenantGuard.js`.
Automatisch: **T1** (Mandant aus dem Objekt statt aus der Sitzung).
Von Hand: Ist die `sys`-Claim-Liste noch kurz? Jede Erweiterung schwächt die Trennung — heute: Signup, sechs Hintergrund-Checker, Owner-Konsole, plus die öffentlichen Router.

### 2. Rechte (RBAC) und Lizenz-Gates
Trägt jeder mutierende Endpunkt eine Prüfung — an der Route, am Router, im Handler oder im Controller?
Automatisch: **G1**.
Von Hand: Passt die *gewählte* Permission zur Wirkung? Ein Gate mit dem falschen Recht besteht G1 und schützt trotzdem nichts.

### 3. Authentifizierung und Sitzungen
JWT-Prüfung, Token-Zweck (`purpose`), Ablauf, Rücknahme, Passwortwege, Rate-Limits.
Orte: `middleware/auth.js`, `routes/auth.js`, `middleware/rateLimit.js`, Owner-Konsole `middleware/consoleAuth.js`.
Von Hand: Prüft **jeder** Pfad, der selbst `jwt.verify` aufruft, auch den Zweck? Reset-Token dürfen keine Sitzung sein.

### 4. Datei-Upload und -Auslieferung
MIME-Allowlist beim Hochladen **und** beim Ausliefern, `inline` vs. `attachment`, `nosniff`, Besitzprüfung über `assetAccess.js`.
Automatisch: **F1** (Content-Type aus der Datenbank), **S1** (Dateisystem statt Objektspeicher).
Wichtig: Die CSP ist bewusst abgeschaltet (SPA-Bundles, PDF-Auslieferung). Damit ist jede Datei, die im eigenen Origin als Dokument ausgeführt werden kann, ein Weg zum Token im `localStorage`. `routes/branding.js` ist die Vorlage, wie es richtig aussieht.

### 5. Eingaben und Abfragen
PostgREST liest `.or()`-Ausdrücke als **Struktur** — ein Komma aus einer Nutzereingabe erweitert die Bedingung.
Automatisch: **I1**.
Von Hand: Nunjucks-Autoescape (`services_pdf_render.js`), Header-Bau beim Mailversand.

### 6. Geheimnisse und Konfiguration
Startsicherungen, die schon existieren, dürfen nicht leise verschwinden.
Automatisch: **E1** (JWT-Startabbruch, helmet, CORS-Allowlist, `trust proxy`, `authChain`), **X1** (Geheimnisse und `node_modules` im Git-Index).

### 7. Abhängigkeiten
Automatisch: **D1** (`npm audit`, Backend produktiv + Frontend). Bewusst **nicht** in der Baseline — eine eingefrorene Advisory-Liste hieße, künftige Meldungen stumm zu schalten.

### 8. Betrieb auf Scalingo — nur dort prüfbar
Diese Punkte entscheiden, ob der Schutz **scharf** ist. Aus dem Repository sind sie nicht beantwortbar:

| Prüfung | Erwartung | Wirkung, wenn falsch |
|---|---|---|
| `POSTGREST_ENABLED` / `POSTGREST_URL` | beide gesetzt | ohne sie läuft alles über den Service-Key, **RLS wirkt nicht** |
| `05_rls_scalingo.sql` eingespielt | ja, auf allen Tabellen mit `TENANT_ID` | Trennung hängt allein an ~1.571 Anwendungsfiltern |
| `JWT_SECRET`, `PGRST_JWT_SECRET` | gesetzt, lang, verschieden | Tokens fälschbar |
| `NODE_ENV` | `production` | sonst gilt die localhost-CORS-Ausnahme |
| `CORS_ORIGINS` / `FRONTEND_URL` | echte Domains | offene Origin-Liste |
| `DISABLE_BACKGROUND_JOBS` | **nicht gesetzt** | keine Benachrichtigung wird je zugestellt |
| `PLATFORM_ENC_KEY`, `STORAGE_KEY` | gesetzt | SMTP-Zugangsdaten bzw. Dateiablage unbrauchbar |
| `CONSOLE_REQUIRE_TOTP` (Owner-Konsole) | `true` | Plattformadmin ohne zweiten Faktor |
| Owner-Konsole erreichbar? | nur intern | sie arbeitet mandantenübergreifend |

> **Geheimnisse nie ausgeben.** `scalingo env` zeigt Werte im Klartext. Geprüft wird, **ob** eine Variable gesetzt ist (`scalingo env | cut -d= -f1`), nie ihr Inhalt. Kein Wert gehört in ein Protokoll, einen Chatverlauf oder ein Ticket.

---

## 5. Der automatische Teil: `scripts/security-scan.mjs`

Geprüft wird die **Quelle**, nicht die laufende Anwendung — so fällt auch auf, was *später* dazukommt.

```bash
node scripts/security-scan.mjs              # Bestand gegen Baseline
node scripts/security-scan.mjs --all        # alles zeigen, auch Bekanntes
node scripts/security-scan.mjs --deps       # zusätzlich npm audit
node scripts/security-scan.mjs --json       # maschinenlesbar
node scripts/security-scan.mjs --update-baseline
```

| ID | Prüft | Grad |
|---|---|---|
| G1 | mutierender Endpunkt ohne Permission-Prüfung | hoch |
| I1 | Nutzereingabe unescaped im `.or()`-Ausdruck | mittel |
| F1 | `Content-Type` ungeprüft aus der Datenbank | hoch |
| T1 | Mandant aus dem Objekt statt aus der Sitzung | mittel |
| S1 | direkter Dateisystemzugriff statt Objektspeicher | mittel |
| E1 | Startsicherungen in `server.js` verschwunden | hoch |
| X1 | Geheimnisse / `node_modules` im Git-Index | kritisch/mittel |
| D1 | verwundbare Abhängigkeiten (`--deps`) | hoch/kritisch |

**Ratschenprinzip.** Der Bestand steht in `scripts/security-baseline.json`; fehlschlagen lässt nur **Neues**. Damit ist der Lauf ab heute grün, ohne die Altlast unsichtbar zu machen — sie steht im Erstbefund. Behobenes verschwindet von selbst. **Die Baseline soll schrumpfen.** Sie wächst nur mit einer Begründung im Commit.

Grenzen, die dem Skript bewusst bleiben: es kennt keine Laufzeit, kein Datenmodell und keine Absicht. Ob die *gewählte* Permission die richtige ist, ob ein Endpunkt fachlich zu viel preisgibt, ob RLS produktiv scharf ist — das entscheidet der Mensch bzw. der Agent.

---

## 6. Kadenz

| Auslöser | Was läuft | Wer |
|---|---|---|
| **Jeder Push auf `main`** | `security-scan.mjs` (ohne `--deps`) im CI-Job `security` | GitHub Actions |
| **Täglich 06:00 UTC** | derselbe Job im vorhandenen Cron der Test-Suite, **mit** `--deps` | GitHub Actions |
| **Bei sicherheitsnahen Änderungen** | Agent `security-auditor` — Routen, Auth, Uploads, `db.js`, Migrationen mit RLS | manuell angestoßen |
| **Monatlich** | Agent mit vollem Prüfumfang inkl. Betriebsprüfungen (Abschnitt 4.8) | manuell angestoßen |
| **Quartalsweise** | Konzept und Erstbefund gegenlesen: stimmen Bereiche und Grade noch? | Mensch |

---

## 7. Was ein Befund enthalten muss

Ein Befund ohne Ort und ohne Auslöser ist eine Meinung. Verbindlich sind:

1. **Ort** — `datei.js:zeile`, klickbar.
2. **Auslöser** — was ein Angreifer konkret tut, mit welchem Konto und welchem Ergebnis. Wer das nicht ausformulieren kann, hat keinen Befund, sondern ein Unbehagen.
3. **Wirkung** — welche Daten, welcher Mandantenkreis.
4. **Schweregrad** nach Abschnitt 3, mit Begründung.
5. **Empfehlung** — die kleinste Änderung, die das Muster schließt; wenn es die Stelle im Code schon richtig gibt, mit Verweis darauf.
6. **Falsifikation** — was den Befund entkräften würde (vorhandenes Gate weiter oben, RLS, Besitzprüfung).

Nicht gemeldet werden: theoretische Risiken ohne Pfad, Stilfragen, und alles, was bereits in der Baseline steht — es sei denn, die Bewertung ändert sich.
