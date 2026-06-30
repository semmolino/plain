# Konzept — Service-Bereich (Vorschläge · Feedback · Unterstützung)

> **Status:** Konzept beschlossen + **Phasen 0–2 implementiert** (Fundament · Vorschläge · Feedback &
> Unterstützung) (2026-06-29/30).
> Entscheidungen: Kommentare **moderiert & pseudonym** · Reject-Label **„Aktuell nicht geplant"** ·
> Jira **Phase 3** · Consent für **alle** Anwender · Rückruf-Option **ja**.
> Nächster Schritt: Phase 3 (Jira-Übergabe, Anhänge/Screenshots, E-Mail-Benachrichtigungen, Auswertungen).
> **Migrationen 0096 + 0097 manuell in Supabase einspielen.**
> **Ziel:** Ein neuer Top-Level-Bereich **„Service"** (auf Ebene von Projekte/Rechnungen/Einstellungen),
> über den Anwender direkt aus der Software Funktionswünsche, Feedback und Unterstützungsanfragen an
> plan&simple richten können — **ohne Drittanbieter, ohne zweiten Login, datenschutzkonform**.
> **Oberste Randbedingung (hart):** Kein Anwender darf jemals Namen, E-Mail-Adressen, Organisations- oder
> sonstige identifizierende Daten anderer Anwender oder Organisationen sehen.

---

## 0  Überblick & Einordnung

Drei Sub-Bereiche, je mit eigener Permission:

| Sub-Bereich | Zweck | Sichtbarkeit der Inhalte |
|---|---|---|
| **Vorschläge für Funktionen** | Öffentliches Wunsch-/Voting-Board, mandantenübergreifend kuratiert | Mandantenübergreifend (nach Freigabe), **vollständig pseudonymisiert** |
| **Feedback & Kontakt** | Einfaches Kontaktformular an plan&simple | **Privat** — nur Absender-Org ↔ plan&simple |
| **Unterstützung anfragen** | Strukturierte Hilfe-/Support-Anfrage (Kategorien + FAQ) | **Privat** — nur Absender-Org ↔ plan&simple |

**Architektur-Grundsatz:** Es entstehen *zwei Oberflächen auf denselben Tabellen*:

1. **Anwender-Seite** = neuer `/service`-Bereich in der bestehenden React-App (mandantengebunden, RBAC, Lizenz-Schicht).
2. **plan&simple-Seite** = Ausbau der bestehenden **`owner-console/`** (separates Node+Vite-Tool mit eigener
   Auth/Audit/Rate-Limit, globaler DB-Zugriff). Dort: Moderation, Status, Kommunikation, Auswertung, Jira.

Das ist konsistent mit dem bereits etablierten Muster der Lizenz-Owner-Konsole (`owner-console/routes/tenants.js`,
`/catalog.js`, `/plans.js`, `services/audit.js`).

---

## 1  Datenschutz-Architektur (die wichtigste Sektion)

Das Vorschlagsportal ist der einzige **mandantenübergreifend sichtbare** Bereich. Hier gelten harte Regeln.
Feedback & Unterstützung sind dagegen rein privat (1:1 Org ↔ plan&simple) und damit unkritisch.

### 1.1  Sichtbarkeitsmatrix (Vorschlagsportal)

| Datum | Anderer Anwender (fremde Org) | Eigene Org (Einreicher) | Org-Sprecher (eigene Org) | plan&simple (Owner-Konsole) |
|---|---|---|---|---|
| Vorschlagstitel/-text **(kuratiert, öffentlich)** | ✅ | ✅ | ✅ | ✅ |
| Vorschlagstitel/-text **(Originaleingabe)** | ❌ | ✅ (nur eigener) | ✅ (Org-weit) | ✅ |
| **Name / E-Mail / Organisation** des Einreichers | ❌ **nie** | — | — | ✅ |
| Screenshots / Anhänge | ❌ **nie öffentlich** | ✅ (nur eigene) | ✅ (Org-weit) | ✅ |
| Stimmenzahl (aggregiert) | ✅ | ✅ | ✅ | ✅ |
| Wer abgestimmt hat | ❌ **nie** | ❌ | ❌ | ✅ (nur Org-Ebene, anonym pro Org) |
| Community-Kommentar (nach Freigabe) | ✅ pseudonym („Anwender") | ✅ | ✅ | ✅ |
| Offizielle Antwort von plan&simple | ✅ („plan&simple Team") | ✅ | ✅ | ✅ |

### 1.2  Die fünf technischen Schutzschichten

1. **Kuratierter Doppeltext.** Jeder Vorschlag hat `BODY` (Originaleingabe, privat) **und** `PUBLIC_BODY`
   (von plan&simple vor Veröffentlichung geprüft/bereinigt). Nur `PUBLIC_*` wird mandantenübergreifend
   ausgespielt. → PII, die ein Anwender versehentlich eintippt, gelangt **nie ungeprüft** auf das Board.
2. **Freigabe-Gate (Moderation).** Nichts erscheint öffentlich ohne Freigabe durch plan&simple. Gilt für
   Vorschläge *und* Kommentare.
3. **Anhänge sind nie öffentlich.** Screenshots sind ausschließlich für plan&simple und die eigene Org
   sichtbar — niemals für fremde Anwender. Serverseitig: MIME-/Größen-Limit + **EXIF-/Metadaten-Strip**.
4. **Pseudonymisierte Ausspielung.** Die Anwender-Seite erhält vom Backend **niemals** `EMPLOYEE_ID`/Namen/
   E-Mail/`TENANT_ID` fremder Einreicher. Der Server liefert für fremde Vorschläge nur `{public_title,
   public_body, category, status, vote_count, official_responses, public_comments[]}`. Kommentare tragen
   höchstens das Pseudonym „Anwender" (kein Org-Bezug).
5. **Stimm-Eindeutigkeit auf DB-Ebene.** `UNIQUE(SUGGESTION_ID, TENANT_ID)` auf der Vote-Tabelle —
   pro Organisation strukturell nur **eine** Stimme möglich (siehe 1.3).

### 1.3  „Eine Stimme pro Organisation" — Org-Sprecher-Modell

Anforderung: Voten/Kommentieren darf pro Organisation nur **ein** Anwender, damit kein einzelnes Büro
einen Wunsch künstlich hochzieht.

**Umsetzung:** Per `TENANT_SETTINGS`-Schlüssel `suggestion_delegate_employee_id` benennt ein Admin genau
**einen** Mitarbeiter als **„Produkt-Sprecher"** der Organisation. Nur dieser darf voten & kommentieren;
zusätzlich sieht er die org-weiten Einreichungen. Alle anderen Anwender mit Portal-Zugang dürfen ansehen
und einreichen, aber **nicht** voten/kommentieren und sehen nur ihre **eigenen** Einreichungen.

> Warum eine Einstellung und keine RBAC-Permission? Das bestehende RBAC ist **rollenbasiert**
> (`ROLE_PERMISSION`) — eine Rolle kann mehrere Mitarbeiter haben, „genau einer" lässt sich darüber nicht
> garantieren. Die Sprecher-Designation ist deshalb eine **pro-Mitarbeiter**-Einstellung. Die Vote-/
> Kommentar-Endpunkte prüfen hart `req.employeeId === suggestion_delegate_employee_id`. Das `UNIQUE`-
> Constraint aus 1.2 ist die zweite Sicherung.

---

## 2  Navigation & Informationsarchitektur

### 2.1  Neuer Top-Level-Eintrag „Service"

In `SideNav.tsx` **und** `BottomNav.tsx` ergänzen (gleiches `NavItem`-Muster, `anyOf`-Permissions):

```ts
{ to: '/service', icon: LifeBuoy, label: 'Service',
  permissions: ['service.suggestions.view','service.feedback.use','service.support.use'] }
// kein `feature:` → bewusst NICHT lizenz-gegated: jeder Kunde muss uns erreichen können.
```

Icon-Wahl (Lucide, gemäß CLAUDE.md Icon-System):

| Element | Icon |
|---|---|
| Service (Top-Level) | `LifeBuoy` |
| Vorschläge für Funktionen | `Lightbulb` |
| Feedback & Kontakt | `MessageSquare` |
| Unterstützung anfragen | `Headset` |

### 2.2  Unter-Navigation

`/service` rendert eine `SegmentNav` (gleiches Muster wie der person-zentrierte Mitarbeiter-Bereich) mit
drei Tabs. Tabs werden über `useFilterTabs` anhand der drei Permissions gefiltert — wer nur eine Permission
hat, sieht nur einen Tab.

| Route | Tab | Permission |
|---|---|---|
| `/service/vorschlaege` | Vorschläge für Funktionen | `service.suggestions.view` |
| `/service/feedback` | Feedback & Kontakt | `service.feedback.use` |
| `/service/unterstuetzung` | Unterstützung anfragen | `service.support.use` |

### 2.3  Zugangs-Gate (Haftungsbestätigung)

Beim **ersten** Betreten von `/service` (oder nach Versionswechsel des Hinweistexts) erscheint ein
blockierendes Modal mit dem Nutzungs-/Haftungshinweis (Abschnitt 9). Ohne Bestätigung kein Zugriff.
Empfehlung: für **alle** Anwender verpflichtend (auch Read-only) — der Hinweis ist eine
*Nutzungsbedingung*, keine DSGVO-Einwilligung (Begründung in 9.4), daher unproblematisch verpflichtend.

---

## 3  Bereich „Vorschläge für Funktionen" — Anwender-Seite

### 3.1  Einreichungsformular (Empfehlung)

Bewusst **schlank** (hohe Abschlussrate), aber mit genug Struktur für gute Auswertbarkeit:

| Feld | Typ | Pflicht | Hinweis |
|---|---|---|---|
| **Titel** | Text (max. 80) | ✅ | „Worum geht es in einem Satz?" |
| **Bereich/Kategorie** | Select | ✅ | Projekte, Rechnungen, Angebote, Reporting, Adressen, Mitarbeiter, Import, E-Rechnung, Sonstiges |
| **Beschreibung** | Textarea | ✅ | Leitfragen als Platzhalter: *Was möchten Sie tun? Was fehlt heute? Welchen Nutzen hätte es?* |
| **Wie wichtig ist es Ihnen?** | Segmented (Nice-to-have / Wichtig / Blocker) | – | Hilft plan&simple beim Priorisieren |
| **Screenshots** | Upload (max. 3, je ≤ 5 MB, png/jpg) | – | Inline-Warnung (Abschnitt 9.2), EXIF-Strip serverseitig |

- **Duplikat-Frühwarnung:** Während der Titel getippt wird, zeigt das Formular ähnliche, bereits
  veröffentlichte Vorschläge an („Meinten Sie diesen? → mit-voten"). Reduziert Fragmentierung *und*
  Moderationslast.
- **`<HelpHint id="service.vorschlag.einreichen">`** am Formularkopf (CLAUDE.md In-Product-Hilfe-Regel).
- Nach dem Absenden: Statusmeldung „Eingereicht — wird von plan&simple geprüft und erscheint nach Freigabe
  im Portal." (klare Erwartung an die Moderation).

### 3.2  Übersicht / Board (Empfehlung)

Zwei Ansichten als Filter-Chips oben (Muster aus den List-UI-Standards, `list-toolbar` + `FilterChip`):

- **„Portal"** — alle freigegebenen Vorschläge, mandantenübergreifend, **pseudonym**. Sortierbar nach
  *Beliebt* (Stimmen) / *Neu* / *In Umsetzung*. Filter-Chips: Kategorie, Status. Freitextsuche.
  Jede Karte: Titel · Kategorie-Badge · Status-Badge · Stimmenzähler mit Vote-Button · Kommentarzahl.
  Vote-Button ist nur für den **Org-Sprecher** aktiv; sonst Tooltip „Abstimmen kann der Produkt-Sprecher
  Ihrer Organisation (in den Einstellungen festgelegt)."
- **„Meine / Unsere Vorschläge"** — eigene Einreichungen mit *Originaltext*, Einreichdatum und Status.
  Für den Org-Sprecher org-weit, sonst nur eigene. Hier sieht der Anwender auch die **direkte Antwort von
  plan&simple** zu seinem Vorschlag.

- **Detail-Ansicht** eines Vorschlags: kuratierter Text, Status-Verlauf, offizielle plan&simple-Antwort,
  pseudonyme Community-Kommentare, Vote-Button. Kommentieren nur Org-Sprecher.
- **Leerzustände** unterscheiden (CLAUDE.md): „Noch keine Vorschläge — reichen Sie den ersten ein **(+ warum)**"
  vs. „Kein Treffer für Ihren Filter".

### 3.3  Kommentare — datenschutzsichere Variante

Empfehlung **Phase 1:** Kommentare des Org-Sprechers laufen durch dieselbe **Moderation** wie Vorschläge
und erscheinen erst nach Freigabe **pseudonym** („Anwender"). Das schließt den größten PII-Leck-Kanal
(öffentlicher Freitext) sauber. Wer schneller/leichtgewichtiger starten will: Variante **„Kommentar nur an
plan&simple"** (privat, nicht öffentlich) — plan&simple bündelt die Erkenntnis in seiner offiziellen Antwort.
→ Siehe offene Entscheidung A in Abschnitt 12.

---

## 4  Bereich „Vorschläge" — plan&simple-Seite (Owner-Konsole)

Ausbau von `owner-console/` um ein Modul **„Vorschläge"** (`owner-console/routes/suggestions.js`,
`web/src/.../Suggestions*`). Die Owner-Konsole hat bereits Auth, Rate-Limit und Audit — alles
mandantenübergreifenden Zugriffe laufen über `services/audit.js` (Pflicht, da hier echte Identitäten sichtbar).

### 4.1  Funktionen

1. **Moderations-Eingang** — Liste „Neu eingereicht": Original ansehen, `PUBLIC_TITLE`/`PUBLIC_BODY`
   redigieren (PII entfernen), **Freigeben** / **Zurückweisen** / **Als Duplikat zusammenführen**
   (`MERGED_INTO_ID` → Stimmen wandern auf den kanonischen Vorschlag).
2. **Status setzen** (Abschnitt 5) — wird sofort auf der Anwender-Seite sichtbar.
3. **Kommunikation** — *offizielle Antwort* (öffentlich, „plan&simple Team") **oder** *private Antwort* an
   die einreichende Org (erscheint nur in deren „Meine/Unsere Vorschläge").
4. **Portal-Vorschau** — eine Read-only-Ansicht **exakt so, wie Kunden das Board sehen** (pseudonym). Damit
   ist die Anforderung „ich brauche auch Zugriff auf das kundenseitige Portal" erfüllt, ohne dass
   plan&simple dafür einen Mandanten-Login braucht.
5. **Auswertung** — Vorschläge nach Stimmen, Kategorie, Status; „Top-Wünsche", Aktivität pro Zeitraum.
6. **Jira-Übergabe** (nice-to-have, Abschnitt 6).

### 4.2  Warum separates Tool und nicht in der Mandanten-App?

Die Mandanten-App ist strikt tenant-isoliert (JWT → `req.tenantId`, jede Query `.eq('TENANT_ID', …)`).
plan&simple-Moderation braucht aber **bewusst mandantenübergreifenden** Zugriff inkl. echter Identitäten —
das gehört **nicht** in dieselbe Codebasis/denselben Auth-Kontext, sonst entsteht genau das
Cross-Tenant-Leck, das wir vermeiden wollen. Die Owner-Konsole ist dafür der etablierte, abgeschottete Ort.

---

## 5  Statusmodell (inkl. „Abgelehnt"-Alternative)

Zwei getrennte Felder — nicht vermischen:

- **`MODERATION_STATE`** (intern, steuert Sichtbarkeit): `pending` · `published` · `declined` · `merged`
- **`LIFECYCLE_STATUS`** (öffentlich, Roadmap-Signal an Kunden):

| Key | Öffentliches Label | Badge-Farbe | Bedeutung |
|---|---|---|---|
| `new` | **Neu** | grau | freigegeben, noch nicht bewertet |
| `reviewing` | **In Prüfung** | blau | wird inhaltlich/technisch bewertet |
| `planned` | **Geplant** | violett | auf der Roadmap |
| `in_progress` | **In Umsetzung** | amber | wird gerade gebaut |
| `shipped` | **Umgesetzt** | grün | ausgeliefert |
| `not_planned` | **Aktuell nicht geplant** | grau | *Ersatz für „Abgelehnt"* |

**Zu „Abgelehnt":** Begriff vermeiden — er wirkt endgültig und demotiviert. Empfehlung in dieser Reihenfolge:

1. **„Aktuell nicht geplant"** ✅ (ehrlich, lässt die Tür offen — Branchenstandard bei Canny/Productboard)
2. „Nicht geplant"
3. „Zurückgestellt"

Für rein **interne** Differenzierung (nur Owner-Konsole, nie öffentlich) kannst du zusätzlich feiner
markieren: `Duplikat`, `Kein Fehler / by design`, `Bereits vorhanden` — nach außen bleibt es bei
„Aktuell nicht geplant" bzw. „Umgesetzt".

---

## 6  Jira-Übergabe (nice-to-have)

Aus der Owner-Konsole, **einseitig**: Button „Als Jira-Ticket übernehmen" an einem freigegebenen/geplanten
Vorschlag → erstellt via **Jira REST API** ein Issue, speichert den Schlüssel in `SUGGESTION.JIRA_ISSUE_KEY`,
zeigt ihn danach als Link. Mapping: *Summary* = Titel, *Description* = **`PUBLIC_BODY`** (nicht Original!,
kein Kunden-PII) + Stimmenzahl + Kategorie + Rück-Link. Token liegt in `owner-console/.env`
(`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`).

Optional später: Status-Rücksync (Jira-Webhook → `LIFECYCLE_STATUS`), damit „In Umsetzung/Umgesetzt"
automatisch nachzieht. Phase 3.

---

## 7  Bereich „Feedback & Kontakt"

Einfaches Kontaktformular, privat (Org ↔ plan&simple). Aus dem Login **vorbelegt** (read-only angezeigt,
damit der Anwender sieht, was übermittelt wird): Organisation, Name, E-Mail. Eingabe:

| Feld | Typ | Pflicht |
|---|---|---|
| Art | Select (Lob · Kritik · Frage · Sonstiges) | ✅ |
| Betreff | Text | ✅ |
| Nachricht | Textarea | ✅ |
| Antwort erwünscht? | Checkbox (+ Rück-E-Mail, vorbelegt) | – |
| Anhang | Upload (optional, gleiche Limits/Strip wie 3.1) | – |

Nach dem Absenden: Bestätigung + Vorgangsnummer. Antworten von plan&simple laufen über die Owner-Konsole
(Status `new → in_progress → resolved`) und werden dem Anwender unter „Meine Anfragen" angezeigt; optionale
E-Mail-Benachrichtigung über den bestehenden Resend/SMTP-Versand.

---

## 8  Bereich „Unterstützung anfragen"

**Abgrenzung zu Feedback:** Feedback = freie Rückmeldung; Unterstützung = *„Ich brauche Hilfe bei einer
konkreten Aufgabe"* — strukturiert, mit Kategorie, FAQ-Deflection und nachverfolgbarem Status.

### 8.1  Empfohlener Aufbau

1. **Kategorie zuerst** (steuert FAQ + Routing):

   | Kategorie | typischer Inhalt |
   |---|---|
   | **Datenimport & Altdatenübernahme** | Übernahme bestehender Adressen/Projekte/Anfangsbestände — koppelt an den geführten Import (`DATA_IMPORT_CONCEPT.md`), **höchste GTM-Priorität** |
   | **Ersteinrichtung / Konto & Stammdaten** | Firmendaten, Nummernkreise, MwSt, Logo/PDF |
   | **Rechnungen & E-Rechnung** | Abschlags-/Schlussrechnung, XRechnung |
   | **Projekte & Kalkulation** | Struktur, Honorar, Buchungen |
   | **Benutzer & Berechtigungen** | Rollen, RBAC, Sprecher festlegen |
   | **Technisches Problem / Fehler** | etwas funktioniert nicht |
   | **Sonstiges** | alles andere |

2. **FAQ-Deflection** (empfohlen, ja): Nach Kategoriewahl 2–4 passende FAQ-Einträge anzeigen
   („Hilft das schon weiter?"). Quelle: **bestehender `helpContent.tsx`** wiederverwenden bzw. eine kuratierte
   FAQ-Liste pro Kategorie (`docs/HELP_TOOLTIP_CONCEPT.md` als Heimat). Spart dir echte Anfragen.
3. **Formular**: Betreff, Beschreibung, optional Anhang, „Dringlichkeit" (Frage / behindert Arbeit / Blocker).
   Org/Name/E-Mail vorbelegt.
4. **Rückruf statt Schulung:** Du willst keine Schulungen anbieten — richtig. Für die import-lastigen Fälle
   reicht eine optionale Checkbox **„Rückruf zur Datenübernahme vereinbaren"** + Wunschzeitfenster. Das ist
   *asynchrone, anlassbezogene Hilfe*, keine Schulung, und stützt direkt den GTM-Conversion-Hebel „erster
   erfolgreicher Import".

### 8.2  Technisch identisch zu Feedback

Feedback und Unterstützung teilen sich **eine** Tabelle `SERVICE_REQUEST` (Feld `KIND = feedback | support`)
plus `SERVICE_REQUEST_MESSAGE` (Antwort-Thread). Nur zwei UI-Einstiege, ein Backend, eine Owner-Konsolen-
Inbox. Reduziert Code und Pflege.

---

## 9  Rechtstexte — Haftungs-/Nutzungshinweis (Entwürfe)

> ⚠️ **Kein Rechtsrat.** Die folgenden Formulierungen sind praxisübliche **Vorlagen** und müssen vor
> Produktivnahme anwaltlich geprüft werden — insbesondere die **Freistellungsklausel** (Ziff. 4) ist als
> AGB-Klausel an **§ 305 ff., § 307 BGB** zu messen und darf nicht zu weit gefasst sein, sonst ist sie
> unwirksam. Außerdem: Verlinkung der **Datenschutzerklärung** und ggf. Abgleich mit deiner AVV.

### 9.1  Zugangs-Gate (einmalig, mit Versionierung)

**Nutzungsbedingungen & Haftungshinweis — Service-Bereich von plan&simple**

> Im Service-Bereich (Vorschläge, Feedback & Kontakt, Unterstützung) können Sie Texte, Screenshots und
> Dateien an plan&simple übermitteln. Bitte beachten Sie:
>
> 1. **Eigenverantwortung.** Sie entscheiden selbst, welche Inhalte Sie eingeben oder hochladen. Geben Sie
>    nur Informationen an, die zur Beschreibung Ihres Anliegens erforderlich sind.
> 2. **Keine Daten Dritter.** Übermitteln Sie keine personenbezogenen Daten Dritter (z. B. Namen,
>    Kontaktdaten oder Adressen Ihrer Kundinnen, Mitarbeitenden oder Geschäftspartner) und keine
>    vertraulichen Geschäftsdaten. Schwärzen oder anonymisieren Sie Screenshots vor dem Hochladen.
> 3. **Sichtbarkeit im Vorschlagsportal.** Inhalte, die Sie unter „Vorschläge für Funktionen" einreichen,
>    können — nach Prüfung und ggf. Bearbeitung durch plan&simple — für andere Anwenderinnen und Anwender
>    sichtbar gemacht werden. **Ihr Name, Ihre E-Mail-Adresse und Ihre Organisation werden dabei nicht
>    angezeigt.**
> 4. **Haftung.** Für Inhalte, die Sie entgegen den vorstehenden Hinweisen übermitteln, übernimmt
>    plan&simple keine Haftung. Im gesetzlich zulässigen Rahmen stellen Sie plan&simple von Ansprüchen
>    Dritter frei, die auf einer von Ihnen zu vertretenden, unzulässigen Übermittlung personenbezogener oder
>    vertraulicher Daten beruhen.
> 5. **Datenschutz.** Die Verarbeitung Ihrer Eingaben erfolgt gemäß unserer Datenschutzerklärung. Sie können
>    die Löschung der von Ihnen übermittelten Inhalte verlangen, soweit keine gesetzlichen
>    Aufbewahrungspflichten entgegenstehen.
>
> ☐ *Ich habe die Nutzungsbedingungen und Haftungshinweise gelesen und akzeptiere sie. Mir ist bewusst, dass
> ich für die von mir übermittelten Inhalte selbst verantwortlich bin.*
>
> **[Akzeptieren und fortfahren]**

### 9.2  Inline-Warnung am Screenshot-Upload

> *Hinweis: Screenshots enthalten oft ungewollt personenbezogene oder vertrauliche Daten (Namen, Beträge,
> Adressen). Bitte schwärzen Sie sensible Bereiche vor dem Hochladen. Das Hochladen erfolgt auf eigene
> Verantwortung; eine Haftung von plan&simple ist im gesetzlich zulässigen Rahmen ausgeschlossen.*

### 9.3  Pseudonymitäts-Zusicherung (am Board, vertrauensbildend)

> *In diesem Portal sehen andere Anwender weder Ihren Namen noch Ihre Organisation. Sichtbar sind nur Inhalt,
> Status und Stimmen — nach Freigabe durch plan&simple.*

### 9.4  Warum verpflichtend für alle (auch Read-only) zulässig ist

Der Hinweis ist **keine datenschutzrechtliche Einwilligung** (Art. 6 Abs. 1 lit. a DSGVO), deren
Freiwilligkeit ein Zugangs-Junktim verbieten würde, sondern die **Annahme von Nutzungsbedingungen** für ein
optionales Zusatzfeature. Eine Bedingung „Feature nur mit akzeptierten Nutzungsbedingungen" ist daher
grundsätzlich zulässig. Da auch Read-only-Anwender Screenshots/Texte hochladen können, sobald sie das Portal
erreichen, ist die einheitliche Bestätigung für alle die sauberste Lösung. (Auch dies anwaltlich bestätigen.)

---

## 10  Datenmodell (Vorschlag, Migrationen ab `0096`)

Alle Tabellen `UPPER_CASE`, jede mit `TENANT_ID`; jede App-Query filtert nach `TENANT_ID` (außer
Owner-Konsole, die bewusst global liest). API-Bodies `snake_case`.

```
SUGGESTION
  ID, TENANT_ID, EMPLOYEE_ID            -- Einreicher (privat)
  TITLE, BODY                            -- Originaleingabe (privat)
  PUBLIC_TITLE, PUBLIC_BODY              -- von plan&simple kuratiert (öffentlich)
  CATEGORY                               -- Modul-Enum
  PRIORITY_HINT                          -- nice/important/blocker (vom Einreicher)
  MODERATION_STATE                       -- pending|published|declined|merged
  LIFECYCLE_STATUS                       -- new|reviewing|planned|in_progress|shipped|not_planned
  MERGED_INTO_ID                         -- FK→SUGGESTION (Duplikat-Zusammenführung)
  VOTE_COUNT                             -- denormalisierter Cache
  JIRA_ISSUE_KEY                         -- nullable
  CREATED_AT, UPDATED_AT, PUBLISHED_AT

SUGGESTION_VOTE
  ID, SUGGESTION_ID, TENANT_ID, EMPLOYEE_ID, CREATED_AT
  UNIQUE(SUGGESTION_ID, TENANT_ID)       -- „eine Stimme pro Organisation"

SUGGESTION_COMMENT
  ID, SUGGESTION_ID, TENANT_ID, EMPLOYEE_ID   -- TENANT/EMPLOYEE null bei plan&simple-Antwort
  BODY, AUTHOR_KIND (user|vendor)
  VISIBILITY (public|vendor_only)             -- privat an plan&simple vs. öffentlicher Kommentar
  MODERATION_STATE (pending|published|declined)
  CREATED_AT

SUGGESTION_ATTACHMENT
  ID, SUGGESTION_ID, TENANT_ID, STORAGE_KEY, FILENAME, MIME_TYPE, SIZE_BYTES, CREATED_BY, CREATED_AT
  -- nie öffentlich; EXIF-Strip + MIME/Größen-Validierung beim Upload

SERVICE_REQUEST                          -- Feedback UND Unterstützung
  ID, TENANT_ID, EMPLOYEE_ID
  KIND (feedback|support)
  CATEGORY, SUBJECT, BODY
  CONTACT_NAME, CONTACT_EMAIL            -- vorbelegt, editierbar
  WANTS_REPLY, URGENCY                   -- optional
  STATUS (new|in_progress|waiting|resolved|closed)
  JIRA_ISSUE_KEY                         -- nullable
  CREATED_AT, UPDATED_AT

SERVICE_REQUEST_MESSAGE                  -- Antwort-Thread
  ID, REQUEST_ID, AUTHOR_KIND (user|vendor), EMPLOYEE_ID, BODY, CREATED_AT

SERVICE_REQUEST_ATTACHMENT               -- analog SUGGESTION_ATTACHMENT

PORTAL_CONSENT                           -- Haftungsbestätigung, versioniert
  ID, TENANT_ID, EMPLOYEE_ID, DOC_VERSION, ACCEPTED_AT
  UNIQUE(EMPLOYEE_ID, DOC_VERSION)
```

`TENANT_SETTINGS`: neuer Schlüssel `suggestion_delegate_employee_id` (Org-Sprecher).

**Anhang-Speicher:** vorerst wie bestehend `backend/uploads/` (CLAUDE.md nennt fehlende Validierung als
bekannte Lücke) — hier aber **mit** Validierung/Strip und Zugriff nur über authentifizierten, tenant-
prüfenden Endpunkt. Später ggf. Supabase Storage.

---

## 11  RBAC (Migration `0096_rbac_service.sql`)

Drei neue Permissions (Format exakt wie `0088_rbac_import.sql`):

| KEY | MODULE | LABEL_DE | Default-Rollen |
|---|---|---|---|
| `service.suggestions.view` | `service` | Vorschlagsportal nutzen | alle Standard-Rollen |
| `service.feedback.use` | `service` | Feedback & Kontakt senden | alle Standard-Rollen |
| `service.support.use` | `service` | Unterstützung anfragen | alle Standard-Rollen |
| `service.suggestions.admin` | `service` | Produkt-Sprecher festlegen / Org-Vorschläge sehen | Inhaber/Admin |

- Voten/Kommentieren ist **keine** eigene Permission, sondern an `suggestion_delegate_employee_id` gebunden
  (Begründung in 1.3). `service.suggestions.admin` regelt nur, **wer den Sprecher benennen** darf.
- Frontend: `<Can permission="…">` bzw. `useFilterTabs`; Keys in `permissionsStore.ts`-Listen ergänzen,
  falls feste Listen (SideNav/BottomNav/ProtectedRoute) geführt werden.
- Schritt-für-Schritt gemäß `docs/RBAC_DEVELOPMENT_CHECKLIST.md`.

---

## 12  Getroffene Entscheidungen (2026-06-29)

| # | Frage | Entscheidung |
|---|---|---|
| **A** | Öffentliche Community-Kommentare **mit Moderation** *oder* Kommentare **nur an plan&simple** (privat)? | ✅ **Moderiert + pseudonym** (Phase 1) |
| **B** | „Abgelehnt" → welches Label? | ✅ **„Aktuell nicht geplant"** |
| **C** | Jira-Übergabe gleich in Phase 1 oder später? | ✅ **Später (Phase 3)** |
| **D** | Haftungsbestätigung für **alle** Anwender verpflichtend? | ✅ **Ja, alle** (siehe 9.4) |
| **E** | „Rückruf zur Datenübernahme" als Option unter Unterstützung? | ✅ **Ja** (Phase 2) |

> Offen bleibt nur die **anwaltliche Prüfung der Rechtstexte** (§9), insbesondere der Freistellungsklausel.

## 12a  Umsetzungsstand

**Phase 0 (Fundament) — fertig (2026-06-29):**
- Migration `0096_rbac_service.sql` (4 Permissions) + `0097_service_area.sql` (alle Tabellen + `PORTAL_CONSENT`)
- Backend `routes/service.js`: Consent-Gate (`GET/POST /service/consent`, versioniert) + Produkt-Sprecher
  (`GET/PUT /service/delegate`, gegated mit `service.suggestions.admin`); registriert in `server.js`
- Frontend: Top-Level-Nav **Service** (`LifeBuoy`) in SideNav + BottomNav, Route `/service`,
  `ServicePage` mit permission-gefilterten Tabs (SegmentNav), **funktionierendes Consent-Gate**
  (`ConsentGate`) und **funktionierende Produkt-Sprecher-Verwaltung** für Admins; Platzhalter-Tabs
  für Vorschläge/Feedback/Unterstützung; Hilfe-Einträge in `helpContent.tsx`
- Verifiziert: `tsc -b --force` (exit 0), Backend-Jest (102 Tests grün)
- ⚠️ Die Nav erscheint erst, wenn `0096` in Supabase läuft (vorher hat keine Rolle die `service.*`-Rechte).

**Phase 1 (Vorschläge end-to-end) — fertig (2026-06-30):**
- Backend `routes/service.js`: `POST /service/suggestions` (einreichen), `GET /suggestions/mine`
  (eigene bzw. org-weit für Sprecher/Admin), `GET /suggestions/board` (veröffentlicht, **pseudonym**,
  sort popular/new), `GET /suggestions/:id` (Detail + Kommentare), `POST/DELETE …/vote` (nur Sprecher,
  `UNIQUE`-gesichert), `POST …/comments` (nur Sprecher, moderiert)
- Frontend `VorschlaegeTab`: Board mit Vote-Buttons, „Meine/Unsere", Einreich-Modal, Detail-Modal mit
  Kommentaren; Produkt-Sprecher-Karte hierher gezogen; Status-Badges, Such-/Bereichsfilter, Leerzustände
- **Owner-Konsole** `routes/suggestions.js` + Tab **„Vorschläge"**: Moderations-Eingang, kuratierter
  Text (`PUBLIC_*`), Freigeben/Ablehnen/Zusammenführen, Status setzen, offizielle/private Antwort,
  Kommentar-Freigabe — alles auditiert (`writeChangeLog`). Identitäten nur hier sichtbar.
- Verifiziert: Main-FE `tsc -b` (exit 0), Owner-Konsole `tsc -b` (exit 0), Backend-Jest (102 grün)

**Phase 2 (Feedback & Unterstützung) — fertig (2026-06-30):**
- Backend `routes/service.js`: `GET /service/requests/contact` (Vorbelegung Name/E-Mail/Org aus Login),
  `POST /requests` (Feedback/Support, Permission je nach `kind`), `GET /requests/mine?kind=`,
  `GET /requests/:id` (+ Nachrichten-Thread), `POST /requests/:id/messages`
- Frontend: `FeedbackTab` (Art/Betreff/Nachricht, Vorbelegung, Antwort-erwünscht) + `UnterstuetzungTab`
  (Kategorie-Kacheln → **FAQ-Deflection** → Formular mit Dringlichkeit + **Rückruf-Option** bei
  Datenimport) + gemeinsame `requestShared.tsx` („Meine Anfragen"-Liste + Thread-Modal)
- **Owner-Konsole** `routes/serviceRequests.js` + Tab **„Anfragen"** (`web/src/pages/Requests.tsx`):
  Inbox mit Art-/Status-Filter, Detail-Thread, **Antworten** (setzt Status `waiting`), Status setzen — auditiert
- Verifiziert: Main-FE `tsc -b` (0), Owner-Konsole `tsc -b` (0), Backend-Jest (102 grün)

---

## 13  Phasenplan

| Phase | Inhalt |
|---|---|
| **0** | Migrationen `0096`+ (Tabellen + RBAC), `/service`-Shell + Nav + Zugangs-Gate (Consent) |
| **1** | Vorschläge Anwender-Seite (Einreichen, Board, Voten, „Meine/Unsere") + Owner-Konsolen-Moderation + Status |
| **2** | Feedback & Unterstützung (`SERVICE_REQUEST`) inkl. FAQ-Deflection + Owner-Konsolen-Inbox + Antworten |
| **3** | Jira-Übergabe, Auswertungen/Reports in der Owner-Konsole, optionale E-Mail-Benachrichtigungen |

---

## 14  In-Product-Hilfe (Pflicht gemäß CLAUDE.md)

- `helpContent.tsx`: Einträge `service.vorschlag.einreichen`, `service.vorschlag.voting`,
  `service.sprecher` (Erklärung Org-Sprecher), `service.unterstuetzung.kategorie`.
- Leerzustände in allen drei Listen mit „noch keine Daten (+ warum)" vs. „kein Treffer".
- Status-Badges mit Tooltip-Erklärung je `LIFECYCLE_STATUS`.
```
