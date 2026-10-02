'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Seitenaufbau der Briefe (Vorlagen-Plan Stufe 4): Layout-Stile und DIN 5008.
//
// Alles hier ist CSS, das buildThemeHead (services_pdf_render.js) hinter die
// Vorlagen haengt. Es greift nur ueber die Klassen, die alle Briefvorlagen
// teilen (.logo-area, .sender-line, .letter-header, .address-col, .meta-col,
// .doc-title, .calc-table, .pos-table, .data-table …) — deshalb eine Stelle
// fuer Rechnung, Storno, Mahnung, Angebot, Auftragsbestaetigung und Nachtrag.
//
// Stil `standard` + DIN `none` ergibt KEIN zusaetzliches CSS: bestehende
// Belege sehen aus wie bisher (Entscheidung D6 — neue Stile sind ein Angebot,
// keine stille Umstellung).
//
// DIN 5008 rechnet vom Blattrand, das CSS vom Inhaltsbereich. Der Renderer
// druckt mit 14 mm oben und 25 mm links (renderPdf); daraus:
//   Form B: Anschriftfeld 45 mm von oben → Inhalt 31 mm; Zusatzzone 17,7 mm,
//           Anschriftzone ab 62,7 mm (Inhalt 48,7 mm), 27,3 mm hoch;
//           Infoblock ab 50 mm (Inhalt 36 mm), 125 mm von links (Inhalt 100 mm)
//   Form A: dasselbe 18 mm hoeher (Anschriftfeld ab 27 mm, Infoblock ab 32 mm)
//   Textbeginn 8,46 mm unter dem Anschriftfeld.
// Die Anschrift beginnt 25 mm vom Rand — das Feld selbst liegt bei 20 mm, mit
// 5 mm Innenrand. Damit sitzt sie im Fenster eines DL-/C6/5-Umschlags.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_TOP_MM = 14;

const STYLE_CSS = {
  standard: '',

  // Viel Weissraum, feine Linien, Summen in einer hinterlegten Zeile.
  klar: `
body{ font-size:9.5pt; line-height:1.5; color:#1f2937; }
table{ font-variant-numeric:tabular-nums; }
.sender-line{ border-bottom-color:#e5e7eb; }
.doc-title{ font-size:18pt; font-weight:600; letter-spacing:-0.01em; margin-bottom:6mm; padding-bottom:2mm; border-bottom:0.75pt solid var(--brand-accent); }
.calc-table td{ padding:1.8mm 0; }
.calc-table tr.total-row td{ border-top:1.2pt solid var(--brand-accent); font-size:11.5pt; background:color-mix(in srgb, var(--brand-accent) 7%, #ffffff); padding:2.5mm 2mm; }
.data-table th, .pos-table th{ font-size:7.5pt; text-transform:uppercase; letter-spacing:0.06em; color:#6b7280; border-bottom:0.75pt solid var(--brand-accent); }
.data-table td, .pos-table td{ border-bottom-color:#eef0f2; }
.pos-table tr.parent-row td{ background:transparent; }
`,

  // Dicht gesetzt fuer lange Positionslisten und Stundennachweise.
  kompakt: `
body{ font-size:9pt; line-height:1.35; }
table{ font-variant-numeric:tabular-nums; }
.logo-area{ margin-bottom:3mm; }
.sender-line{ margin-bottom:3mm; }
.letter-header{ margin-bottom:5mm; }
.address-block{ min-height:28mm; font-size:9.5pt; line-height:1.4; }
.meta-table{ font-size:8.5pt; }
.meta-table td{ padding:0.5mm 0; }
.doc-title{ font-size:13pt; margin-bottom:3mm; }
.text-block, .salutation{ margin-bottom:3mm; line-height:1.4; font-size:9pt; }
.calc-table{ margin:2mm 0 4mm 0; }
.calc-table td{ padding:1mm 0; font-size:9pt; }
.data-table, .pos-table{ font-size:8pt; }
.data-table td, .data-table th, .pos-table td, .pos-table th{ padding:0.9mm 1.5mm 0.9mm 0; }
`,

  // Grosse Typo-Hierarchie, Akzentlinie ueber dem Titel, Versalien als Etiketten.
  architektur: `
body{ font-size:9.5pt; line-height:1.5; }
table{ font-variant-numeric:tabular-nums; }
.sender-line{ font-size:6.5pt; text-transform:uppercase; letter-spacing:0.08em; border-bottom:none; }
.meta-table td.ml{ font-size:7pt; text-transform:uppercase; letter-spacing:0.08em; padding-top:1.2mm; }
.doc-title{ font-size:24pt; font-weight:300; text-transform:uppercase; letter-spacing:0.04em; padding-top:4mm; border-top:2pt solid var(--brand-accent); margin-bottom:7mm; }
.calc-table tr.total-row td{ border-top:2pt solid var(--brand-accent); font-size:12pt; }
.data-table th, .pos-table th{ font-size:7pt; text-transform:uppercase; letter-spacing:0.08em; border-bottom:1pt solid #1a1a1a; }
.pos-table tr.parent-row td{ background:transparent; border-bottom:0.75pt solid #9ca3af; }
`,
};

// Lage des Anschriftfeldes je Form (mm vom Blattrand).
const DIN = {
  B: { field: 45, info: 50 },
  A: { field: 27, info: 32 },
};

function dinCss(form, logoMaxHeightMm) {
  const d = DIN[form];
  if (!d) return '';
  const logoZone = d.field - PAGE_TOP_MM;              // Inhalt bis zum Anschriftfeld
  const addressTop = d.field + 17.7 - PAGE_TOP_MM;     // Anschriftzone (Inhalt)
  const infoTop = d.info - PAGE_TOP_MM;
  const logoMax = Math.max(8, Math.min(Number(logoMaxHeightMm) || 20, logoZone - 4));
  const r = (n) => Math.round(n * 100) / 100;
  return `
/* DIN 5008 Form ${form} — Anschriftfeld fuer den Fensterumschlag */
.logo-area{ height:${r(logoZone)}mm; min-height:0; margin-bottom:0; align-items:flex-start; overflow:hidden; }
.logo-area img{ max-height:${r(logoMax)}mm; }
.sender-line{ width:80mm; height:4mm; margin:${r(addressTop - logoZone - 4)}mm 0 0 0; padding-bottom:0.5mm; line-height:3.5mm; border-bottom:0.3pt solid #9ca3af; }
.letter-header{ min-height:35.76mm; margin-bottom:0; gap:20mm; }
.address-col{ width:80mm; }
.address-block{ height:27.3mm; min-height:0; overflow:hidden; }
.meta-col{ margin-top:-${r(addressTop - infoTop)}mm; }
`;
}

/** CSS fuer Stil und DIN-Form; leer fuer das bisherige Aussehen. */
function layoutCss(theme) {
  const layout = (theme && theme.layout) || {};
  const header = (theme && theme.header) || {};
  return (STYLE_CSS[layout.style] || '') + dinCss(layout.din, header.logoMaxHeightMm);
}

/** Die neuen Stile haben eine lesbare Fusszeile (7 pt statt 7 px). */
function readableFooter(theme) {
  const style = theme && theme.layout && theme.layout.style;
  return !!style && style !== 'standard';
}

module.exports = { layoutCss, readableFooter, DIN, PAGE_TOP_MM };
