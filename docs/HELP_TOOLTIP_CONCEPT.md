# In-Product-Hilfe — Konzept (Tooltips & Erklärungen)

**Ziel:** PlaIn soll für einen neuen Anwender **ohne Schulung** nutzbar sein.
Erklärungen sind dort verfügbar, wo sie gebraucht werden — auf Abruf, ohne den
erfahrenen Nutzer zu stören.

Dieses Dokument ist verbindlich für neue Features (analog zur
`RBAC_DEVELOPMENT_CHECKLIST.md`). Wer ein erklärungsbedürftiges Feld, einen
Wizard-Schritt oder eine Kennzahl ergänzt, ergänzt die passende Hilfe gleich mit.

---

## 1. Prinzipien

1. **Progressive Disclosure** — Hilfe ist da, drängt sich aber nicht auf. Default:
   ein dezentes Info-Icon, das auf Hover/Tap öffnet. Keine aufdringlichen
   Produkt-Tourenoder Pop-ups beim Start.
2. **Richtige Flughöhe** — Hilfe erklärt das **WAS/WARUM** und **was einzugeben
   ist**, nicht das Label. „Skonto" → nicht „Das ist das Skonto", sondern
   „Preisnachlass für schnelle Zahlung, z. B. 2 % in 14 Tagen".
3. **Konsistenz** — eine Komponenten-Familie, ein Wording-Stil, eine Optik.
   Begriffe werden **überall gleich** erklärt (zentrale Registry).
4. **Sachlich, deutsch, B2B** — gleiche Tonalität wie das Engagement-System
   (keine verspielte Sprache).
5. **Wartbar** — Hilfetexte zentral (eine Quelle der Wahrheit), damit sie bei
   Funktionsänderungen an einer Stelle aktualisiert werden.

**Wann Hilfe?** Bei allem mit **größerem Einfluss auf das System** (Großteil der
Einstellungen), allen **Wizards** (Rechnungen, Kalkulation), **E-Rechnung**, allen
**Kennzahlen/Reports** und fachlich nicht-trivialen Feldern. **Nicht** für jeden
selbsterklärenden Klick (Suchfeld, „Speichern", offensichtliche Namensfelder).

---

## 2. Hilfe-Bausteine (festes, kleines Set)

Damit es konsistent bleibt, gibt es genau diese Muster:

| # | Baustein | Wofür | Umsetzung |
|---|----------|-------|-----------|
| 1 | **Feld-Tooltip** | einzelnes erklärungsbedürftiges Feld / Toggle | `<HelpHint id="…">` bzw. `<InfoHint>` neben dem Label |
| 2 | **Kennzahl-Tooltip** | Report-/Tabellen-Spalten, KPI-Kacheln | `<HelpHint>` im `<th>` / an der Kachel |
| 3 | **Abschnitts-Intro** | Kontext eines Panels/einer Gruppe | kurzer Beschreibungssatz unter dem Header |
| 4 | **Schritt-für-Schritt** | Wizards & komplexe Rechner | nummerierte Kurz-Anleitung (Intro-Box) + Schritt-Header |
| 5 | **Leerzustand mit Hinweis** | leere Liste/Bereich | „Noch nichts da — so legst du das erste an" + erste Aktion |
| 6 | **Modul-Hilfe (optional)** | sehr komplexe Module (E-Rechnung, Reporting) | „Was ist das?"-Tooltip am Seiten-/Tab-Header |

Bewusst **nicht** Teil des Konzepts (zu verspielt/aufdringlich): geführte
Produkt-Touren, blinkende Coachmarks, Tooltips, die bei jedem Laden aufspringen.

---

## 3. Architektur

```
src/help/helpContent.tsx     # zentrale Registry: HELP = { "<modul>.<thema>": {title, body} }
src/components/ui/HelpHint.tsx   # <HelpHint id="…"> → liest Registry, rendert InfoHint
src/components/ui/InfoHint.tsx   # atomares Tooltip-Icon (Hover/Tap, a11y), freier Text
```

- **`HelpHint`** ist der Standard für wiederkehrende/zentrale Begriffe. `id` ist
  typisiert (`HelpId`) → Autovervollständigung, keine Tippfehler, tote IDs fallen
  beim Build auf.
- **`InfoHint`** bleibt für rein lokale, einmalige Erklärungen (freier JSX-Text).
- **Abschnitts-Intros / Schritt-Header / Leerzustände** sind Markup-Muster (kein
  eigenes Bauteil nötig), folgen aber denselben Wording-Regeln.

**Naming:** `"<modul>.<thema>"` — z. B. `einvoice.leitweg`, `report.deckungsbeitrag`,
`invoice.skonto`, `arbzg.strict`.

---

## 4. Coverage-Map (priorisiert)

Stand-Legende: ✅ erledigt · 🟡 teils · ⬜ offen

### Phase 1 — Einstellungen (größter Einfluss)
- ✅ Vorbelegungen (Währung/MwSt., Budget-Warnungen) · 🟡 Skonto, Stempeluhr
- ✅ Nummernkreise (3-Schritt-Hilfe + Feld-Tooltips)
- ✅ Kostensatz-Rechner (Schritt-Header + Tooltips)
- 🟡 Unternehmen (Peppol ✅; Steuernummer/USt-IdNr., IBAN/BIC, Gläubiger-ID, Login-URL ⬜)
- ⬜ Arbeitszeiten/ArbZG (strikter Modus, Pausenregeln, Modelle, Ruhezeit)
- ⬜ Benachrichtigungen (Empfänger-Logik, Zeitpläne)
- ⬜ Mahnungen (Mahnstufen, Gebühren, Texte)
- ⬜ Rollen & Berechtigungen (Permissions, System- vs. eigene Rollen)
- ⬜ E-Mail-Versand (Resend/SMTP, Absender-Domain)
- ⬜ Monatsabschluss

### Phase 2 — Wizards
- ⬜ Rechnungs-Wizards (Abschlag/Schluss/Einzel, Sicherheitseinbehalt, Performance/TEC)
- ⬜ HOAI-Kalkulation (Honorarzone, Leistungsphasen, Besondere Leistungen, Zuschläge)
- 🟡 Angebotsstruktur (Aufwandsschätzung Menge×Rolle ✅; Zuschläge, NK ⬜)

### Phase 3 — Reporting / Kennzahlen (Projekte & Mitarbeiter)
- ⬜ Deckungsbeitrag, Kostenquote, offener Betrag, Restbudget, Auslastung
- ⬜ Trends-/Kennzahlen-Tabs (Definitionen je Spalte/Kachel)
- ⬜ Mitarbeiter-Reporting (Saldo/Gleitzeit, produktive Stunden)

### Phase 4 — E-Rechnung
- 🟡 Was ist eine E-Rechnung, CII/UBL, Leitweg-ID, Peppol (Registry-Einträge da; im UI verankern)

**Kontinuierlich:** jedes neue Setting/Wizard/KPI bringt seinen Hilfetext mit
(siehe Abschnitt 6).

---

## 5. Wording-Leitlinien

- 1–3 Sätze, konkret, mit Beispiel wo sinnvoll (z. B. „2 % in 14 Tagen").
- Erst die Bedeutung, dann „brauchst du nur, wenn …" / „wo du es findest".
- Werte/Bausteine in `<code>` (z. B. `{COUNTER:0000}`, `75, 90, 100`).
- Keine ausgeschriebenen Umlaute, keine Emoji als Icons (Lucide-only).
- Begriff „Organisation" statt „Tenant", „systemweit" statt „tenantweit".

---

## 6. Regel für neue Features (verbindlich)

Bevor ein neues **Setting**, ein **Wizard-Schritt**, eine **Kennzahl** oder ein
**fachlich nicht-triviales Feld** gemerged wird:

1. Prüfen, ob in `helpContent.tsx` schon ein passender Eintrag existiert →
   wiederverwenden via `<HelpHint id="…">`.
2. Falls nicht: Eintrag in `helpContent.tsx` ergänzen (Naming `<modul>.<thema>`)
   und im UI einbinden.
3. Bei Funktionsänderung: den zugehörigen Hilfetext mit aktualisieren.

Selbsterklärende Standard-Interaktionen brauchen keine Hilfe.
