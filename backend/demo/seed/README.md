# Demo-Bewegungsdaten-Generator

Erzeugt auf Basis **manuell angelegter Stammdaten** (Tenant, Projekte, Strukturen,
Honorare, Mitarbeiter-Zuordnungen) einen mehrjährigen, in sich konsistenten Verlauf
an **Bewegungsdaten** — indem die **echten Backend-Services** angesteuert werden
(`createBuchung`, `insertProgressSnapshot`, später die Rechnungs-Flows). Dadurch sind
Kostensätze, Rollups, Leistungsstände und Summen exakt so wie in der App.

**Deterministisch** (fixer Seed) und **wiederholbar** (Reset + Seed → identischer Stand).

> ⚠️ Nur für den **Demo-Mandanten**. Schreibt direkt gegen die Supabase, die in
> `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` konfiguriert ist. Niemals gegen echte Kundendaten.

## Voraussetzung

Der Demo-Mandant existiert (siehe `../createDemoTenant.js`) und du hast **von Hand**
angelegt: Firma, Mitarbeiter, Rollen, Projekte inkl. Struktur (mit Blatt-Elementen),
Honorare und **EMPLOYEE2PROJECT**-Zuordnungen. Kostensätze (`EMPLOYEE_CP_RATE`) darfst
du weglassen — der Generator ergänzt sie optional (Config `bookings.seedCostRates`).

## Ablauf

```bash
# Env setzen (lokal): SUPABASE_URL, SUPABASE_SERVICE_KEY

# 1) Timeline-Vorlage erzeugen (welche Projekte liefen wann?)
node demo/seed/index.js --tenant <DEMO_TENANT_ID> --emit-timeline
#    → schreibt demo/seed/timeline.<tenant>.json — Start/Ende/closed/intensity je Projekt anpassen

# 2) Dry-Run: zeigt, was erzeugt würde, schreibt NICHTS
node demo/seed/index.js --tenant <DEMO_TENANT_ID>

# 3) Echt ausführen (leert vorhandene Bewegungsdaten und seedet neu)
node demo/seed/index.js --tenant <DEMO_TENANT_ID> --reset --apply --force
```

### Flags

| Flag | Wirkung |
|---|---|
| `--tenant <ID>` | Ziel-Mandant (oder Env `DEMO_TENANT_ID`) |
| `--emit-timeline` | Timeline-Vorlage schreiben und beenden |
| `--timeline <pfad>` | abweichenden Timeline-Pfad nutzen |
| `--apply` | tatsächlich schreiben (Default: Dry-Run) |
| `--reset` | Bewegungsdaten vorher löschen (nur mit `--force` destruktiv) |
| `--force` | Sicherheitsbestätigung für destruktive Aktionen |
| `--only a,b` | nur diese Domänen (`bookings,progress,invoicing,hr`) |
| `--skip a,b` | diese Domänen auslassen |
| `--seed <n>` | Zufalls-Seed überschreiben |

## Domänen

| Domäne | Status | Inhalt |
|---|---|---|
| `bookings` | ✅ | Zeit-Buchungen (TEC) über die Laufzeit, verteilt auf Mitarbeiter/Blätter, Kostensatz-Historie optional |
| `progress` | ✅ | Leistungsstände: BT1 geplanter Fertigstellungsverlauf, BT2 Erlös-Snapshots (`PROJECT_PROGRESS`) |
| `invoicing` | 🟡 | Abschlagsrechnungen (BT1 nach Leistungsstand, BT2 nach Buchungen) + Zahlungseingänge — über die echten Services. **Schlussrechnung folgt.** |
| `hr` | ⬜ geplant | Abwesenheiten/Urlaub (Migration 0086), konsistent mit Zeitkonto |

## Stellschrauben

Alles Fachliche (Stundenvolumen, Abrechnungsrhythmus, Zahlungsverhalten …) liegt in
[`config.js`](./config.js). Das „Narrativ" der Projektlaufzeiten liegt in der
`timeline.<tenant>.json`.

## Reproduzierbarkeit

Der Reset (`lib/reset.js`) löscht nur **generierte Bewegungsdaten** und setzt die
Aggregat-Spalten auf `PROJECT`/`PROJECT_STRUCTURE` zurück (BT1-Honorare bleiben, da
Stammdaten). `--reset --apply --force` gefolgt vom Seed liefert bei gleichem Seed +
gleicher Timeline exakt denselben Stand.

## Warum Service-getrieben statt INSERT-Skripte?

Die Bewegungsdaten hängen an nicht-trivialen Invarianten (TEC→Struktur-Rollup,
Kostensatz nach Datum, Rechnungssummen/Abzüge, ArbZG-Pausen). Der Generator ruft die
echte App-Logik auf → die Daten sind per Konstruktion valide statt fragil nachgebaut.
```
