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
      fontFamily:   'Arial, Helvetica, sans-serif',
      fontScale:    1,
    },
    header: { showLogo: true, logoMaxHeightMm: 20, logoPosition: 'right' },
    footer: { showPageNumbers: true },
    // Schaltbare Anhang-/Inhaltsabschnitte (Default an → kein Beleg verliert
    // ohne Zutun Inhalte). Templates gaten mit `!= false`, daher robust auch ohne
    // explizit gesetzte Flags.
    blocks: { showProjectStructure: true, showTec: true, showHonorar: true, showPayments: true },
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
