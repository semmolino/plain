'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Kanonische PDF-Theme-Defaults (v2) — EINE Quelle der Wahrheit.
// Wird sowohl vom Render-Service (services_pdf_render.js) als auch vom
// Dokumentvorlagen-CRUD (services/documentTemplates.js) verwendet, damit die
// beiden nie auseinanderlaufen.
//
// WICHTIG: Die Defaults reproduzieren bewusst exakt das HEUTIGE Aussehen, damit
// eine Company ohne eigene Vorlage NULL Regression hat:
//   - accentColor/primaryColor = #111827  -> aktuelle .doc-title-Farbe
//   - fontFamily               = Arial…    -> aktuelle body-Schrift
//   - logoPosition             = right     -> Logo steht heute rechts (flex-end)
// Erst wenn der Nutzer im Branding-Tab etwas waehlt, aendert sich die Optik.
// ─────────────────────────────────────────────────────────────────────────────

function defaultTheme() {
  return {
    version: 2,
    brand: {
      primaryColor: '#111827',
      accentColor:  '#111827',
      fontFamily:   'system-sans', // Font-KEY (siehe services_theme_fonts.js), nicht CSS-Stack
      fontScale:    1,
    },
    // showBauvorhaben: Zeile „Bauvorhaben: …" mit dem Gesamtprojekt (Rechnungen,
    // Storno, Mahnung, Nachtrag). Erscheint nur bei Projekten in einem
    // Gesamtprojekt — fuer alle anderen aendert der Standard nichts.
    header: { showLogo: true, logoMaxHeightMm: 20, logoPosition: 'right', showBauvorhaben: true },
    footer: { showPageNumbers: true },
    // Seitenaufbau (Vorlagen-Plan Stufe 4). Standard = das bisherige Aussehen:
    //   style       standard | klar | kompakt | architektur
    //   din         none (Anschrift fliesst wie bisher) | B | A (DIN 5008,
    //               Anschriftfeld fest fuer den Fensterumschlag)
    //   foldMarks   Falz- und Lochmarken am linken Rand
    //   followHeader Belegart, Nummer und Empfaenger oben auf Folgeseiten
    layout: { style: 'standard', din: 'none', foldMarks: false, followHeader: false },
    // Briefpapier: eigenes PDF als Hintergrund (Asset LETTERHEAD).
    //   pages       first | all
    //   hideFooter  Fusszeile mit Anschrift/Bank/Steuer weglassen, weil sie auf
    //               dem Briefpapier steht (Seitenzahl bleibt)
    letterhead: { assetId: null, pages: 'first', hideFooter: false },
    // Schaltbare Anhang-/Inhaltsabschnitte (Default an → kein Beleg verliert
    // ohne Zutun Inhalte). Templates gaten mit `!= false`, daher robust auch ohne
    // explizit gesetzte Flags.
    blocks: {
      showProjectStructure: true, showTec: true, showHonorar: true, showPayments: true,
      order: ['showPayments', 'showProjectStructure', 'showTec', 'showHonorar'],
    },
  };
}

// Generische, immer verfuegbare Schrift-Stacks fuer den Branding-Tab. Bewusst
// KEINE Webfonts (die muessten eingebettet werden, sonst faellt der Server-
// Renderer ohnehin auf die generische Familie zurueck). Serif vs. Sans ist ein
// sichtbarer, ehrlicher Unterschied; benannte Fonts kommen in einer spaeteren
// Phase mit @font-face-Einbettung.
const FONT_STACKS = {
  sans:  'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

module.exports = { defaultTheme, FONT_STACKS };
