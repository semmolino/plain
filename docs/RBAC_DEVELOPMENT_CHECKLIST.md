# RBAC — Entwickler-Checkliste für neue Features

> Diese Checkliste IST Teil des Workflows. Bei jedem Feature, das eine
> neue Mutation, einen sichtbaren Button, ein sensibles Feld oder ein
> Menüeintrag mitbringt, **muss** sie durchlaufen werden.

---

## Schritt 1 — Permission-Bedarf prüfen

Vor dem Schreiben jeder neuen `router.post|put|patch|delete` oder jedem
neuen prominenten UI-Element fragen:

> **Soll die Aktion/Sichtbarkeit unter Permission stehen?**

- Ja, wenn die Funktion etwas schreibt oder etwas Sensibles anzeigt.
- Nein, wenn es ein reines Lookup für Dropdowns ist (z.B. Länderliste, Statusliste).

Bei „Ja" → Schritt 2.

---

## Schritt 2 — Passende Permission im Katalog suchen

Den vollständigen Katalog gibt's in:
`backend/migrations/0062_rbac_foundation.sql` (INSERT INTO "PERMISSION").

Format der Permission-Keys: `modul.aktion` oder `modul.submodul.aktion`.

Beispiele für bestehende Permissions:

| Modul | Aktionen |
|---|---|
| addresses | view, create, edit, delete (+ contacts.*) |
| projects | view, create, edit, delete, structure.*, performance.*, bookings.*, budget.*, hourly_rates.*, calculations.*, contracts.* |
| invoices | view, create_single, create_partial, create_final, create_credit, edit, delete, book, cancel, send_email, download_pdf, download_xml |
| dunning | view, edit, send |
| security_retention | view |
| offers | view, create, edit, delete, send, convert |
| employees | view, create, edit, delete, salary.view, salary.edit, bookings.view_all, role.assign, password.set, month_close.edit |
| settings | basedata.view/edit, defaults.edit, notifications.edit, monthly_close.edit, company.view/edit, numbers.edit, text_templates.edit, dunning_config.edit, work_time.edit, cost_rate.edit |
| roles | view, create, edit, delete |
| reports | view, export |
| dashboard | view |

→ Falls eine passende Permission existiert: **Schritt 3a**.
→ Sonst: **Schritt 3b**.

---

## Schritt 3a — Bestehende Permission anwenden

### Backend

```js
// In der entsprechenden routes/*.js
const { requirePermission } = require("../middleware/permissions");

router.post("/neuer-endpoint", requirePermission("modul.aktion"), handler);
```

Für mehrere Permissions:
```js
const { requireAnyPermission } = require("../middleware/permissions");
router.post("/...", requireAnyPermission("perm.a", "perm.b"), handler);
```

### Frontend

Buttons:
```tsx
import { Can } from '@/components/ui/Can'

<Can permission="modul.aktion">
  <button onClick={...}>Aktion</button>
</Can>
```

Tabs in TABS-Array:
```ts
{ id: 'neuer-tab', label: 'Neuer Tab', permissions: ['modul.aktion'] }
```
Dann `useFilterTabs(TABS)` wie üblich.

Komplette Seiten in App.tsx:
```tsx
<Route path="/neue-seite" element={
  <ProtectedRoute anyOf={['modul.view']}>
    <NeueSeitePage />
  </ProtectedRoute>
} />
```

---

## Schritt 3b — Neue Permission anlegen

### 1) User fragen (Pflicht)

> *„Brauchen wir eine eigene Permission für [Funktion X]? Mein Vorschlag:
> Key `modul.aktion`, Label „...", Default-Rollen: Administrator + ..."*

Erst weiterarbeiten, wenn der User zustimmt oder anders entscheidet.

### 2) Migration anlegen

Neue Datei `backend/migrations/0063_neue_permission.sql` (Nummer hochzählen):

```sql
-- Migration 0063: <kurzer Titel>

INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
('modul.aktion', 'modul', 'aktion', 'Label DE', 'Optional: Beschreibung', 'editing', <position>)
ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";

-- Optional: Default-Rollen, die die Permission bekommen sollen
-- (CATEGORY: 'reading' | 'editing' | 'destructive' | 'administration')

-- Beispiel: alle Administratoren bekommen sie auto, alle Projektleiter
DO $$
DECLARE
  perm_id INT;
BEGIN
  SELECT "ID" INTO perm_id FROM "PERMISSION" WHERE "KEY" = 'modul.aktion';
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID", "PERMISSION_ID")
    SELECT "ID", perm_id FROM "USER_ROLE"
    WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" IN ('Administrator','Projektleiter')
    ON CONFLICT DO NOTHING;
END $$;
```

**Wichtig**: User muss die Migration in Supabase manuell ausführen.

### 3) Code anpassen

Wie in Schritt 3a (Backend `requirePermission`, Frontend `<Can>` etc.).

### 4) Frontend-Konstanten pflegen (falls relevant)

Wenn die Permission auch in den festen Nav-Listen vorkommt:
- `frontend-react/src/components/layout/BottomNav.tsx`
- `frontend-react/src/components/layout/SideNav.tsx`
- `frontend-react/src/App.tsx` (ProtectedRoute `anyOf`)
- Den passenden TABS-Array im Page-Component

---

## Schritt 4 — Self-Lockout-Schutz nicht vergessen

Falls die neue Permission Admin-relevant ist (z.B. eine, die für die Rollen-
Verwaltung selbst gebraucht wird), prüfen ob sie in
`ADMIN_CAPABILITY_PERMISSIONS` (in `backend/controllers/roles.js`)
ergänzt werden sollte. Sonst kann sich ein Tenant ungewollt aussperren.

---

## Schritt 5 — Testen

- Backend lokal: `requirePermission` mit fehlender Permission → 403 erwartet
- Frontend lokal: Login mit User ohne Permission → Element fehlt
- Manuell prüfen, dass mit der Permission alles wie gewohnt funktioniert
- `npm test --prefix backend` + `cd frontend-react && npm run build` grün

---

## Praktische Beispiele

### Beispiel 1 — Neuer „Export Excel" Button für Rechnungen

1. Prüfung: Export-Endpoint hinzufügen, Button im UI.
2. Katalog-Check: `invoices.download_pdf` / `invoices.download_xml` existieren,
   für Excel separates Recht sinnvoll.
3. **User fragen**: *"Brauchen wir eine eigene Permission `invoices.export`
   für Excel-Export, oder reicht `invoices.download_pdf`?"*
4. Falls eigene: Migration anlegen, Backend `requirePermission("invoices.export")`,
   Frontend `<Can permission="invoices.export">`.

### Beispiel 2 — Neues Feld „Geheimer Vermerk" auf Projekt

1. Prüfung: sensibles Feld, soll nicht jeder sehen.
2. Kein passender Schlüssel im Katalog.
3. **User fragen**: *"Neue Permission `projects.confidential.view` und
   `projects.confidential.edit`? Default nur für Administrator?"*
4. Migration + Backend filtert Feld aus Response wenn Permission fehlt +
   Frontend zeigt Feld nur mit `<Can permission="projects.confidential.view">`.

### Beispiel 3 — Neuer Lookup-Endpoint `/api/v1/projekte/categories`

1. Prüfung: nur Lookup für Dropdown.
2. Kein Permission-Gating nötig — wie andere Lookups (countries, statuses).
3. Direkt anlegen ohne Migration.

---

## Wenn die Checkliste fehlt

Wenn ein PR fertig wird und **keine** dieser Schritte durchlaufen wurde,
obwohl mutating Routen / neue UI-Aktionen drin sind: das ist ein Bug.
Vor Merge nachholen.
