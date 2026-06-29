# Landingpage-Analytics — Setup & Datenschutz

> First-Party, cookieless, banner-frei. Erfasst anonyme Besucher-Ereignisse der
> Marketing-Landingpage in der **eigenen** Datenbank — zur Auswertung im
> bestehenden Reporting, ohne Dritt-Tool und ohne Cookie-Einwilligungsbanner.

---

## 1 Was erfasst wird

| Ereignis | Inhalt | Beispielnutzen |
|---|---|---|
| `page_view` | Pfad, Referrer-**Host**, Gerätetyp, Viewport-Breite, Sprache, UTM-Parameter | Reichweite, Quellen, Kampagnen |
| `click` | Label des Buttons/Links (`data-track` oder Sektion+Text) | Welche CTAs ziehen (z. B. `hero_trial`, `pricing_basic`) |
| `scroll_depth` | 25 / 50 / 75 / 100 % | Wie weit Besucher lesen |
| `section_view` | Name der gesehenen Sektion | Welche Abschnitte tatsächlich gesehen werden |
| `engagement` | aktive Verweildauer in ms (pausiert bei verstecktem Tab) | Wie lange sich Besucher wirklich mit der Seite befassen |

Alle Auswertungen sind **aggregiert** — es gibt kein Besucherprofil und kein Wiedererkennen über Besuche oder Geräte hinweg.

---

## 2 Warum das ohne Einwilligungsbanner zulässig ist

Die Cookie-Einwilligungspflicht (§ 25 TDDDG) greift beim **Zugriff auf das Endgerät** — also beim Setzen/Lesen von Cookies oder vergleichbaren Speicher-Technologien. Dieses Tracking vermeidet das vollständig:

- **Kein Cookie, kein localStorage, kein sessionStorage.** Es wird nichts auf dem Gerät gespeichert oder ausgelesen.
- **Kein persistenter Identifier.** Der `SESSION_KEY` ist ein Zufallswert, der nur im Arbeitsspeicher des Browsers für die Dauer des einen Seitenaufrufs existiert. Lädt der Besucher die Seite neu, entsteht ein neuer Schlüssel — Wiedererkennen ist technisch ausgeschlossen.
- **Keine IP-Speicherung, kein Fingerprint.** Die IP wird serverseitig nicht gespeichert; es wird kein Geräte-Fingerprint gebildet.
- **Referrer nur als Host.** Aus `https://google.com/search?q=…` wird nur `google.com` gespeichert.
- **DNT/GPC wird respektiert.** Bei aktivem „Do Not Track" oder „Global Privacy Control" trackt das Skript gar nicht.

Damit fällt kein Zugriff i. S. § 25 TDDDG an. Es bleibt eine Verarbeitung nach DSGVO (auch anonymisierte Reichweitenmessung berührt die DSGVO), die auf **berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO)** gestützt wird. Das entspricht der gängigen Praxis privacy-freundlicher Analytics (Plausible, Fathom, cookieless Matomo).

> **Wichtig:** Das ist die fundierte, verbreitete Auslegung — keine Rechtsberatung. Vor dem öffentlichen Launch kurz von einer Datenschutz-Fachperson/Anwält:in bestätigen lassen. Sobald später **Sitzungsaufzeichnungen/Heatmaps** (z. B. Microsoft Clarity, Hotjar) dazukommen sollen, ändert sich die Lage: die brauchen ein Einwilligungsbanner.

---

## 3 Was in die Datenschutzerklärung gehört

Ein kurzer Abschnitt, sinngemäß:

> **Reichweitenmessung.** Zur Verbesserung unseres Angebots erfassen wir anonyme Nutzungsstatistiken unserer Website (z. B. aufgerufene Seite, angeklickte Schaltflächen, Scroll-Tiefe, Verweildauer, ungefährer Gerätetyp, Herkunfts-Website). Dabei werden **keine Cookies** gesetzt, **keine IP-Adressen gespeichert** und **keine wiedererkennbaren Profile** gebildet; eine Identifizierung einzelner Personen ist nicht möglich und nicht beabsichtigt. Die Daten werden ausschließlich auf unseren eigenen Servern verarbeitet (kein Dritt-Dienst). Rechtsgrundlage ist unser berechtigtes Interesse an einer bedarfsgerechten Gestaltung unserer Website (Art. 6 Abs. 1 lit. f DSGVO). Sie können der Erfassung widersprechen, indem Sie in Ihrem Browser „Do Not Track" bzw. „Global Privacy Control" aktivieren.

Aufbewahrung der Rohdaten begrenzen (Datensparsamkeit) — siehe Hinweis in der Migration (z. B. Löschung nach 14 Monaten).

---

## 4 Technische Architektur

```
Landingpage (index.html)
  └─ Inline-Tracker  ──sendBeacon (text/plain, kein CORS-Preflight)──►  Backend
                                                                          │
Backend (Express)                                                         ▼
  routes/tracking.js  (öffentlich, vor authChain, Rate-Limit)
     └─ services/landingAnalytics.js  (Validierung, Sanitisierung, KEINE PII)
           └─ Supabase  →  Tabelle  "LANDING_EVENT"   (Migration 0084)
```

**Neue/`geänderte Dateien:**

- `backend/migrations/0084_landing_analytics.sql` — Tabelle `LANDING_EVENT` (ohne `TENANT_ID`, siehe unten).
- `backend/services/landingAnalytics.js` — `recordEvents()` (Schreiben) + `getSummary()` (Auswertung).
- `backend/routes/tracking.js` — öffentliche Route `POST /api/v1/track`.
- `backend/server.js` — Route vor der `authChain` registriert (wie `webhooks`).
- `docs/marketing/landingpage/index.html` — Inline-Tracker + `data-track`-Labels an den CTAs.

> **Bewusste Abweichung von der Tenant-Isolation:** `LANDING_EVENT` hat **kein `TENANT_ID`**. Es sind Besucherdaten der öffentlichen Marketing-Seite (vor jedem Login) — kein Mandantenkontext, keine Kundendaten. Die Route läuft daher bewusst **ohne** `authMiddleware`. Das ist die korrekte, eng begrenzte Ausnahme; alle übrigen Regeln (Rate-Limit, keine PII) bleiben.

---

## 5 Inbetriebnahme (Checkliste)

1. **Migration ausführen:** `0084_landing_analytics.sql` im Supabase SQL-Editor laufen lassen (manuell, wie alle Migrationen).
2. **Endpoint-URL setzen:** in `index.html` die Konstante `ENDPOINT` anpassen.
   - Marketing-Seite auf eigener Domain → volle Backend-URL, z. B. `https://app.deine-domain.de/api/v1/track`.
   - Seite same-origin mit dem Backend ausgeliefert → `/api/v1/track` genügt.
3. **CORS:** die Domain der Landingpage in `CORS_ORIGINS` aufnehmen. (Für `sendBeacon` mit `text/plain` ist zwar kein Preflight nötig, aber sauberer Eintrag schadet nicht — und der `fetch`-Fallback profitiert.)
4. **Datenschutzerklärung** um den Abschnitt aus §3 ergänzen.
5. **Smoke-Test:** Seite öffnen, klicken, scrollen, Tab wechseln → in `LANDING_EVENT` sollten Zeilen erscheinen.

---

## 6 Auswertung im Reporting

`services/landingAnalytics.js` liefert mit `getSummary(supabase, { from, to })` ein fertiges Aggregat:

```js
const { getSummary } = require("./services/landingAnalytics");
const data = await getSummary(supabase, { from: "2026-10-01", to: "2026-11-01" });
// → { visits, pageViews, avgEngagedMs, scrollDepth:{25,50,75,100},
//     clicksByLabel:{ hero_trial: 42, pricing_basic: 18, ... },
//     sectionReach:{ preise: 120, ... }, devices:{...}, topReferrers:{...} }
```

Das lässt sich direkt als Endpoint im Reporting-Modul anbinden (z. B. `GET /api/v1/reports/landing?from=…&to=…`, hinter euren üblichen Guards).

**Beispiel-Kennzahlen, die sich daraus bauen lassen:**

- **CTA-Klickrate:** `clicksByLabel.hero_trial / visits` — welcher Button konvertiert am besten.
- **Funnel:** `page_view → scroll 50 % → section_view "preise" → click pricing_* → (später) Signup`.
- **Lesetiefe:** Verteilung `scrollDepth` (wie viele erreichen die Preise?).
- **Engagement:** `avgEngagedMs` als Qualitätssignal je Quelle/Kampagne.

> Für große Zeiträume statt `getSummary` (lädt Rohzeilen) besser eine SQL-Aggregations-View in Supabase anlegen — Beispiel-Gerüst:

```sql
-- Klicks je Label und Tag
SELECT date_trunc('day', "CREATED_AT") AS tag, "EVENT_LABEL", count(*)
FROM "LANDING_EVENT" WHERE "EVENT_TYPE" = 'click'
GROUP BY 1, 2 ORDER BY 1 DESC;

-- Besuche & durchschnittliche aktive Verweildauer je Tag
SELECT date_trunc('day', "CREATED_AT") AS tag,
       count(DISTINCT "SESSION_KEY") AS besuche,
       round(avg("ENGAGED_MS") FILTER (WHERE "EVENT_TYPE"='engagement'))/1000 AS avg_sek
FROM "LANDING_EVENT" GROUP BY 1 ORDER BY 1 DESC;
```

---

## 7 Spätere Ausbaustufe (optional, mit Banner)

Wenn ihr individuelle **Heatmaps / Sitzungsaufzeichnungen** wollt (sehen, wie ein einzelner Besucher die Maus bewegt), ist **Microsoft Clarity** (kostenlos) der gängige Einstieg — aber dann mit **Cookie-Einwilligungsbanner** (Consent-Management), da personenbezogen. Empfehlung: erst banner-frei starten, Heatmaps nur nachrüsten, wenn genug Traffic da ist, um sie auszuwerten.
