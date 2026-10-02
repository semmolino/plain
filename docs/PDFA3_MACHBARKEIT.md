# PDF/A-3 für ZUGFeRD-Hybridbelege — Machbarkeit

Stand: 02.10.2026 · Vorlagen-Plan Stufe 5, Punkt S5 · Entscheidung D7: „nach Machbarkeitsprüfung, vor 2027"

## Kurzfassung

- **Machbar ohne neues Programm.** Das PDF aus Chromium lässt sich mit pdf-lib (schon im Projekt) zu PDF/A-3b nachbearbeiten. Ghostscript wäre der zweite Weg, er ist aber schlechter (siehe unten).
- **Nicht umgesetzt** ist es noch, weil zwei Dinge fehlen, die ich nicht ohne Zustimmung aus dem Netz hole:
  1. ein **sRGB-ICC-Profil** für den OutputIntent;
  2. **veraPDF** (Java), um die Konformität zu *prüfen*.

  Ohne Prüfung wäre „PDF/A-3b-konform" eine Behauptung. Strenge Empfänger weisen genau so etwas ab.
- **Betroffen ist nur das Hybrid-PDF (ZUGFeRD).** Die reine E-Rechnung (XRechnung UBL/CII) ist XML und davon unabhängig. Sie erfüllt die Pflicht ab 2027/28 bereits.

## Ausgangslage

`services_einvoice_pdf_embed.js` bettet das CII-XML in das Chromium-PDF ein:
- als Associated File mit `AFRelationship=Alternative`,
- dazu XMP mit Factur-X-Namensraum.

Das Ergebnis ist ein gültiges Hybrid-PDF, aber kein PDF/A-3. Das steht auch so im Code. Die meisten Empfänger lesen das XML trotzdem. Validatoren wie veraPDF oder der ZUGFeRD-Validator des FeRD melden aber Fehler.

## Was PDF/A-3b verlangt — und wie das Chromium-PDF dasteht

| Anforderung | Stand heute | Weg |
|---|---|---|
| Alle Schriften eingebettet | ✓ Chromium (Skia) bettet Teilmengen als CIDFontType2 samt ToUnicode ein | — |
| Keine Verschlüsselung, kein JavaScript | ✓ | — |
| OutputIntent mit ICC-Profil (sRGB) | ✗ fehlt | pdf-lib: `/OutputIntents` mit `GTS_PDFA1` und eingebettetem sRGB-Profil |
| XMP mit `pdfaid:part=3`, `pdfaid:conformance=B` | ✗ (nur Factur-X-XMP) | in `buildXmp` ergänzen |
| XMP und Info-Dictionary deckungsgleich (Titel, Producer, Erstellungsdatum) | teilweise | beide aus denselben Werten setzen |
| Trailer-`/ID` | unklar | pdf-lib setzt beim Speichern eine, prüfen |
| Eingebettete Datei mit `AFRelationship`, `/Subtype`, `/ModDate` | ✓ weitgehend | `/Params /ModDate` prüfen |
| Transparenz | in PDF/A-2/3 erlaubt, braucht aber einen Ausgabefarbraum | durch den sRGB-OutputIntent abgedeckt |
| Annotationen mit Druck-Flag | Belege haben keine Links | ggf. `/F 4` setzen |

## Wege

**A. Ghostscript** (`-dPDFA=3 -sColorConversionStrategy=RGB`, installierbar über den apt-Buildpack/`Aptfile`)
- **+** bringt ICC-Profil und PDF/A-Logik mit.
- **−** Schreibt das PDF komplett neu: Schriften werden umgewandelt, und das Aussehen kann sich ändern. Die „Stand vom Buchen"-Garantie hinge dann an einem zweiten Renderer.
- **−** AGPL-Lizenz. Ein unverändertes Binary per Aufruf gilt meist als unkritisch, muss aber geprüft werden.
- **−** Rund 30 MB mehr im Container und ein zusätzlicher Prozess pro Beleg.

**B. pdf-lib-Nachbearbeitung** (empfohlen) — die Ergänzungen aus der Tabelle oben.
- **+** kein neues Programm;
- **+** das Aussehen bleibt Byte für Byte das des Chromium-PDFs;
- **+** derselbe Ort wie die Briefpapier-Nachbearbeitung (`services/pdfFinish.js`).
- **−** Die Konformität hängt an Details von Chromium. Deshalb gehört **veraPDF als Prüfschritt** dazu.

**C. Externer Dienst** — ein Beleg verließe dafür den Server. Für Rechnungsdaten nicht empfohlen.

## Empfehlung und was dafür nötig ist

Weg B, abgesichert durch eine Prüfung in CI:

1. Das **sRGB-ICC-Profil** ins Repo legen, z. B. `sRGB2014.icc` vom ICC (color.org). Die Lizenz erlaubt die Weitergabe. → braucht deine Zustimmung zum Download.
2. **veraPDF** in CI, als Docker-Image `verapdf/cli` oder Java plus veraPDF-Greenfield. Der Job rendert die Musterbelege aus `einvoice/referenceDocument.js` als Hybrid-PDF und prüft gegen das Profil PDF/A-3B. → braucht deine Zustimmung, CI zu erweitern.
3. Umsetzung in `services_einvoice_pdf_embed.js`: OutputIntent, pdfaid im XMP, Metadaten-Gleichlauf, Trailer-ID.
4. Erst wenn der Job grün ist: den Hinweis „KEIN strict PDF/A-3" im Code entfernen und das Hybrid-PDF als PDF/A-3b ausweisen.

Aufwand: ca. 1–2 Tage einschließlich CI-Job, sofern veraPDF keine Chromium-Eigenheit meldet, die tiefer geht (z. B. Type3-Schriften für Sonderzeichen). Das zeigt erst der erste Prüflauf.

## Zeitplan

- Empfang von E-Rechnungen: Pflicht seit 2025.
- Versand: ab 2027 für Unternehmen mit mehr als 800 000 € Vorjahresumsatz, ab 2028 für alle.
- ZUGFeRD ab Profil EN 16931 erfüllt die Pflicht, **wenn** das XML gültig ist. Die PDF/A-Eigenschaft ist Teil des ZUGFeRD-Standards.
- Wer heute Hybrid-PDFs verschickt, sollte deshalb vor 2027 auf PDF/A-3b umstellen. Die reine XRechnung ist davon nicht betroffen.
