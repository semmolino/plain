# Demo-Mandant — Grundlage

Ziel: ein **realistisches Beispiel-Architekturbüro** als **separater Demo-Mandant**, das
1. du für **Sales/Marketing** vorführst,
2. neue User später **in-app read-only** ansehen können („Demo ansehen", self-service — keine persönliche Vorführung nötig), und
3. als Quelle für **echte Beispiel-PDFs/-Screenshots** dient.

**Wichtig:** Demodaten leben ausschließlich im Demo-Mandanten — **nie** in echten Organisationen.

> Hinweis: Diese Skripte schreiben direkt gegen die (Produktions-)Supabase. Sie laufen lokal mit
> gesetzten `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`. Sie wurden vom Autor **nicht** ausgeführt —
> bitte zuerst gegen einen unkritischen Stand testen.

## Bausteine

| Skript | Zweck | Status |
|---|---|---|
| `createDemoTenant.js` | Loginbaren Demo-Mandanten anlegen (TENANTS+COMPANY+EMPLOYEE+Rollen, wie Signup) | ✅ vorhanden |
| `exportTenant.js`     | Alle mandantenbezogenen Daten als wiedereinspielbare Vorlage exportieren (ID-Remap) | ⬜ geplant |
| `importTenant.js`     | Vorlage in einen (neuen/leeren) Demo-Mandanten einspielen → reproduzierbar/zurücksetzbar | ⬜ geplant |

## Empfohlener Ablauf (Hybrid)
1. **`createDemoTenant.js`** ausführen → Demo-Mandant + Login.
2. **Inhalte in der echten Oberfläche aufbauen** (du als Domänen-Experte): Adressen/Kontakte, HOAI-Angebot → „Beauftragt" → Projekt (Struktur/Budget), Buchungen + Leistungsstand, Abschlags- + Schlussrechnung, sodass die Reports echte Zahlen zeigen.
3. **`exportTenant.js`** → erzeugt die **Import-Vorlage** (deine reproduzierbare Demo).
4. Später: in-app „Demo ansehen" (read-only Einstieg in den Demo-Mandanten) für neue User.

## Beispiel
```bash
node demo/createDemoTenant.js \
  --email demo@plan-simple.app --password 'Sicher#2026' \
  --company "Beispiel Architekturbüro" --short DEMO
```
