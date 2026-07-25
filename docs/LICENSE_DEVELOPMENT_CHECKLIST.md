# Lizenz — Entwickler-Checkliste für neue Features

> Schwesterdokument zu `RBAC_DEVELOPMENT_CHECKLIST.md`. **RBAC zuerst** (wer darf?),
> **dann Lizenz** (ist es überhaupt buchbar?). Architektur: `LICENSE_TIERS_CONCEPT.md`.
>
> Solange wir in **Phase L0/L1** sind, gibt es **kein Enforcement** — diese
> Checkliste sorgt aber dafür, dass jede neue Funktion sauber im **Capability-
> Manifest** landet, damit das spätere Lizenz-Enforcement (L2/L3) lückenlos ist.
> Der Drift-Check (`npm run license:check`, läuft als Jest-Test in CI) erzwingt das.

---

## Schritt 1 — Ist die Funktion lizenz-relevant?

Frage bei jedem neuen Modul / jeder neuen sichtbaren Fähigkeit (View, Button,
Auswertung, Export, Integration):

> **Soll diese Fähigkeit Teil des Pricing sein — also je nach Plan an/aus?**

- **Ja** → Schritt 2 (Capability anlegen/zuordnen).
- **Nein** (Kernfunktion, die jeder Plan hat — z. B. Login, Dashboard, eigene Stunden) → einer `core.*`-Capability zuordnen oder bewusst ohne Capability lassen. Auch das dokumentieren.

Reine Lookups (Dropdown-Daten) brauchen weder Permission noch Capability.

---

## Schritt 2 — Capability im Manifest suchen / anlegen

Quelle der Wahrheit: **`backend/licensing/capabilities.manifest.js`**.
Generierter Überblick: `docs/LICENSE_CAPABILITIES.md`.

Key-Format: `modul.fähigkeit` (z. B. `einvoice.peppol`, `reports.advanced`,
`limits.projects_active`). Typ `boolean` (an/aus) oder `metered` (Zahl-Limit).

### Passt eine bestehende Capability?
→ Nichts am Manifest ändern; im Code auf den Key gaten (Schritt 4).

### Neue Capability nötig?
1. **User/Owner fragen** (Pflicht), Vorschlag mitliefern:
   > „Neue Capability `modul.fähigkeit` (Typ boolean), gated Permissions
   > `[…]`, Modul `…`. Default-Zuordnung zu Plänen mache ich später im Owner-Tool."
2. Eintrag im Manifest ergänzen:
   ```js
   {
     key: 'modul.fähigkeit',
     module: 'modul',                 // muss in modules[] existieren
     labelDe: 'Sprechendes Label',
     type: 'boolean',                 // oder 'metered' + unit: 'Stück'
     permissions: ['modul.aktion'],   // RBAC-Keys, die diese Capability freischaltet (müssen im Katalog existieren)
     since: 'YYYY-MM-DD',
   }
   ```
3. **Generieren:** `npm run license:gen` → aktualisiert
   `migrations/0070b_license_capabilities_seed.sql` **und** `docs/LICENSE_CAPABILITIES.md`.
   Die generierten Dateien **nicht** von Hand editieren.
4. Seed in Supabase einspielen (`npm run migrate` bzw. SQL-Editor).

> Eine neue Capability ist nach dem Generieren zunächst **keinem Plan** zugeordnet.
> Der Drift-Check meldet sie als „nicht paketiert" → im Owner-Tool zuordnen.

---

## Schritt 3 — Permission-Verknüpfung prüfen

Trägt die Capability bestehende RBAC-Permissions? Dann diese in `permissions: [...]`
auflisten. Wirkung später (L3): Ist die Capability nicht lizenziert, werden diese
Permissions aus dem effektiven Set entfernt — unabhängig von der Rolle.

Jeder hier genannte Permission-Key **muss** im Katalog (`0062`/`0063`) existieren,
sonst schlägt der Drift-Check fehl.

---

## Schritt 4 — Code gaten (erst ab L2/L3 aktiv, aber sofort vorbereitbar)

### Backend
```js
const { requireFeature } = require("../middleware/license"); // ab L2
router.post("/neuer-endpoint",
  requirePermission("modul.aktion"),   // RBAC
  requireFeature("modul.fähigkeit"),   // Lizenz
  handler);
```

### Frontend
```tsx
import { HasFeature } from '@/components/ui/HasFeature' // ab L2
<Can permission="modul.aktion">
  <HasFeature feature="modul.fähigkeit" fallback={<UpgradeHint feature="modul.fähigkeit" />}>
    <button>…</button>
  </HasFeature>
</Can>
```

**Wichtig:** Jeder im Code verwendete Feature-Key **muss** im Manifest existieren —
sonst CI rot (Drift-Check „undeklariert").

---

## Schritt 5 — Drift-Check & Tests

```bash
npm run license:check --prefix backend   # lokal
npm test --prefix backend                # enthält den Drift-Check als Jest-Test
```

Grün heißt: Manifest valide, keine undeklarierten Keys, alle Permission-Verweise
existieren, Seed + Doku generiert.

---

## Schritt 6 — Owner-Tool (sobald L1 live)

Neue Capability im Plan-×-Capability-Grid den passenden Plänen zuordnen.
Für Sonderfälle (Add-On, Enterprise-Deal): Per-Tenant-Override.

---

## Wenn die Checkliste fehlt

Neues sichtbares Feature gemerged, aber keine Capability im Manifest? Das ist ein
Bug — der Drift-Check fängt undeklarierte Code-Gates ab, aber **neue ungenutzte
Fähigkeiten ohne Gate** rutschen sonst durch und sind später nicht monetarisierbar.
Vor Merge nachholen.

---

## Owner-Konsole: Inbox als Sicherheitsnetz

Der CLI-Drift-Check läuft nur in CI. Damit **du** den offenen Bedarf ohne Terminal
siehst, zeigt die **Inbox** der Owner-Konsole jetzt genau diese Lücken live an
(Regeln: `backend/licensing/inboxRules.js`, getestet in
`backend/tests/license_inbox.test.js`):

| Aufgabenart | Bedeutung | Wo lösen |
|---|---|---|
| **Neue Funktion ohne Lizenz-Zuordnung** | RBAC-Recht ohne Capability → in jedem Plan aktiv, nicht lizenzierbar | Tab „Funktionen" |
| **Capability in keinem verkaufbaren Plan** | Nur im internen `full`-Plan → kein Kunde bekommt sie | Tab „Matrix" |
| **Capability fehlt in der DB** | Manifest erweitert, `0070b` nicht eingespielt → Matrix-Klick scheitert am FK | `npm run license:gen` + einspielen |
| **Verwaiste Capability / Zuordnung** | DB kennt etwas, das Manifest nicht (mehr) | Manifest oder DB angleichen |
| **Zuordnung nur in DB / nur im Manifest** | Divergenz — erneutes `0070b` würde Handarbeit überschreiben | ins Manifest übernehmen |
| **Zuordnung zeigt auf unbekanntes Recht** | `CAPABILITY_PERMISSION` verweist auf gelöschte Permission | entfernen/anlegen |
| **Capability ohne Wirkung** | weder Gate noch Recht → Lizenzschalter wirkungslos | Gate/Recht ergänzen |
| **Mandant ohne Lizenz** | keine `TENANT_LICENSE`-Zeile → Soft-Fail „unbeschränkt" | Tab „Tenants" |
| **Aktiver Plan ohne Capabilities** | Kunden auf diesem Plan hätten keine Funktionen | Matrix oder deaktivieren |

> **Der frühere Fehler:** Die Inbox meldete nur „Capability in keinem Plan".
> Da der interne `full`-Plan per `CROSS JOIN` **alle** Capabilities enthält, war
> die Bedingung nie erfüllt → die Inbox blieb dauerhaft leer, während seit Monaten
> neue Funktionen (`absence.*`, `import.manage`, `service.*`, …) ohne Zuordnung
> aufliefen. Jetzt tauchen sie auf.

### Voraussetzung: Migration 0102

`backend/migrations/0102_license_console_hardening.sql` **manuell in Supabase
einspielen**. Sie:
- weist neuen Registrierungen automatisch den Standard-Plan zu
  (`LICENSE_PLAN.IS_DEFAULT`) und zieht Bestands-Mandanten ohne Lizenz nach,
- setzt Fremdschlüssel `TENANT_LICENSE`/`TENANT_ENTITLEMENT_OVERRIDE → TENANTS`,
- zählt `LICENSE_PLAN.VERSION` bei jeder Inhaltsänderung hoch (Grundlage für das
  Versions-Pinning bestehender Kundenlizenzen),
- erweitert das Änderungsprotokoll um Kontext, IP und Anmelde-Ereignisse.

> **Bekannt (kosmetisch):** Die Nummern `0070`/`0071` sind doppelt vergeben
> (`_license_foundation`/`_tenant_slug` bzw. `_seed_example_plans`/`_tenant_slug_lowercase_check`).
> Der Migrations-Runner trackt nach vollständigem Dateinamen, beide Dateien
> werden angewendet — **nicht umbenennen** (das würde eine erneute Ausführung
> auslösen).
