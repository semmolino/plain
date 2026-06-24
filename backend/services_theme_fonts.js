'use strict';

const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, 'templates', 'fonts');

// ─────────────────────────────────────────────────────────────────────────────
// Kuratierte Schriftauswahl fuer Dokument-Branding.
// `system-*` brauchen keine Einbettung (generische Familien, ueberall vorhanden).
// Alle anderen werden als woff2 (latin 400/700) base64-eingebettet, damit PDF UND
// Live-Vorschau identisch rendern — unabhaengig von den im Container installierten
// Fonts. Quelle der Dateien: fontsource (OFL/Apache), unter templates/fonts/.
// Der gespeicherte Wert in theme.brand.fontFamily ist der KEY (z. B. 'inter').
// ─────────────────────────────────────────────────────────────────────────────

const FONTS = {
  'system-sans':      { label: 'Standard (serifenlos)', group: 'sans',  stack: 'Arial, Helvetica, sans-serif' },
  'system-serif':     { label: 'Standard (Serif)',      group: 'serif', stack: 'Georgia, "Times New Roman", serif' },
  'inter':            { label: 'Inter',            group: 'sans',  family: 'Inter',            file: 'inter' },
  'roboto':           { label: 'Roboto',           group: 'sans',  family: 'Roboto',           file: 'roboto' },
  'open-sans':        { label: 'Open Sans',        group: 'sans',  family: 'Open Sans',        file: 'open-sans' },
  'montserrat':       { label: 'Montserrat',       group: 'sans',  family: 'Montserrat',       file: 'montserrat' },
  'merriweather':     { label: 'Merriweather',     group: 'serif', family: 'Merriweather',     file: 'merriweather' },
  'lora':             { label: 'Lora',             group: 'serif', family: 'Lora',             file: 'lora' },
  'source-serif':     { label: 'Source Serif',     group: 'serif', family: 'Source Serif 4',   file: 'source-serif-4' },
  'playfair-display': { label: 'Playfair Display', group: 'serif', family: 'Playfair Display', file: 'playfair-display' },
};

function stackFor(font) {
  if (font.stack) return font.stack;
  const generic = font.group === 'serif' ? 'Georgia, "Times New Roman", serif' : 'Arial, Helvetica, sans-serif';
  return `"${font.family}", ${generic}`;
}

// Rueckwaerts-Kompatibilitaet: aeltere Themes speicherten einen CSS-Stack statt
// eines Keys. Bekannte Familie -> Key; sonst Heuristik auf system-sans/serif.
function resolveFontKey(value) {
  if (!value) return 'system-sans';
  if (FONTS[value]) return value;
  const v = String(value).toLowerCase();
  for (const [key, f] of Object.entries(FONTS)) {
    if (f.family && v.includes(f.family.toLowerCase())) return key;
  }
  if (v.includes('georgia') || v.includes('times') || v.includes('serif')) return 'system-serif';
  return 'system-sans';
}

const _b64Cache = {};
function fontBase64(file, weight) {
  const k = `${file}-${weight}`;
  if (k in _b64Cache) return _b64Cache[k];
  try {
    _b64Cache[k] = fs.readFileSync(path.join(FONT_DIR, `${file}-${weight}.woff2`)).toString('base64');
  } catch {
    _b64Cache[k] = null;
  }
  return _b64Cache[k];
}

function resolveFont(value) {
  const key = resolveFontKey(value);
  const font = FONTS[key];
  return { key, family: font.family || null, stack: stackFor(font), file: font.file || null, group: font.group };
}

// @font-face-Block (nur fuer die GEWAEHLTE Schrift, base64) — leer fuer system-*.
function fontFaceCss(value) {
  const f = resolveFont(value);
  if (!f.file || !f.family) return '';
  const reg  = fontBase64(f.file, 400);
  const bold = fontBase64(f.file, 700);
  let css = '';
  if (reg)  css += `@font-face{font-family:"${f.family}";font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,${reg}) format("woff2");}`;
  if (bold) css += `@font-face{font-family:"${f.family}";font-style:normal;font-weight:700;font-display:swap;src:url(data:font/woff2;base64,${bold}) format("woff2");}`;
  return css;
}

module.exports = { FONTS, resolveFont, fontFaceCss };
