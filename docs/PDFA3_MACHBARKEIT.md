# PDF/A-3b für ZUGFeRD-Hybridbelege

Stand: 02.10.2026 · Vorlagen-Plan Stufe 5, Punkt S5 · **umgesetzt und mit veraPDF nachgewiesen**

## Ergebnis

Das ZUGFeRD-/Factur-X-Hybrid-PDF ist **PDF/A-3b-konform**. Geprüft wurde mit veraPDF 1.30 (Greenfield), Profil PDF/A-3B, alle 146 Regeln bestanden:
- für das bisherige Aussehen (Standard);
- für alle Gestaltungsoptionen aus Stufe 4 zusammen: Webfont, Stile „Klar“ und „Architektur“, DIN-Anschriftfeld A und B, Falz- und Lochmarken, Folgeseitenkopf;
- für die Profile EN 16931 und XRechnung.

Die Prüfung läuft dauerhaft in CI (Job `pdfa`, `scripts/pdfa-check.sh`). Jede Änderung, die die PDF/A-Eigenschaft bricht, fällt dort auf.

## Was veraPDF vorher beanstandete — und die Lösung

Vorher scheiterten sechs Regeln. Schriften und Transparenz aus Chromium bestanden schon.

| Regel | Befund | Lösung (`services_einvoice_pdf_embed.js`) |
|---|---|---|
| 6.2.4.3-2 (1992×) | DeviceRGB ohne Ausgabefarbraum | OutputIntent `GTS_PDFA1` mit dem sRGB-Profil des ICC (`backend/assets/icc/sRGB2014.icc`) |
| 6.2.10-2 | Transparenzgruppe ohne Farbraum | ebenfalls durch den OutputIntent |
| 6.6.4-1 | PDF/A-Kennung fehlt | XMP `pdfaid:part=3`, `pdfaid:conformance=B` |
| 6.6.2.3.1-1/-2 | Factur-X-Felder ohne Schema | XMP-Erweiterungsschema für den `fx`-Namensraum |
| 6.1.3-1 | Datei-ID im Trailer fehlt | `/ID` im Trailer |

Dazu kommt ein Zeitpunkt für Info-Dictionary, XMP und Anhang. PDF/A verlangt, dass beide Metadaten übereinstimmen.

**Folgeseitenkopf (Stufe 4):** Er wurde mit Helvetica als Standardschrift gezeichnet. Die ist nicht eingebettet, also war das kein PDF/A. Jetzt rendert Chromium ihn als eigene transparente Seite in der Schrift des Belegs, und pdf-lib legt sie auf die Folgeseiten (`services/pdfFinish.js`). Gerendert wird nur, wenn es eine Folgeseite gibt.

## Grenzen

- **Briefpapier:** Ein eigenes Briefpapier-PDF wird Teil des Belegs. Damit das Ganze PDF/A bleibt, muss es selbst PDF/A-tauglich sein: Schriften eingebettet, Farben in RGB, keine Transparenz ohne Farbraum. Prüfen lässt sich das, indem man ein Hybrid-PDF mit dem Briefpapier durch veraPDF schickt.
- **Gebuchte Belege:** Ihr Hybrid-PDF entsteht aus dem archivierten PDF. Belege, die vor dieser Änderung gebucht wurden, enthalten den Folgeseitenkopf nicht. Stufe 4 war noch nicht ausgerollt, es gibt also keine Altfälle mit Helvetica.
- **Konformität ist ein Nachweis am Muster.** Der CI-Job prüft die Vorlagen mit Beispieldaten, nicht jeden einzelnen Beleg. Inhalte, die die Musterbelege nicht haben, also eigene Anhänge oder Bilder in Texten, prüft er nicht mit.

## Lokal prüfen

veraPDF braucht Java ≥ 11. Das Skript installiert veraPDF bei Bedarf nach `$VERAPDF_DIR` (Standard `~/verapdf`):

```bash
bash scripts/pdfa-check.sh
```

Nur die Musterbelege erzeugen: `node backend/scripts/pdfa-sample.js <ordner>`.

## Quellen

- sRGB-Profil: https://registry.color.org/rgb-registry/srgbprofiles (ICC, frei weitergebbar, unverändert)
- veraPDF: https://software.verapdf.org/releases/verapdf-installer.zip
- Factur-X/ZUGFeRD: XMP-Erweiterungsschema nach Factur-X 1.0 / ZUGFeRD 2.x
