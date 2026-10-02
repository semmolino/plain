'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Schema der Dokumentgestaltung (THEME_JSON) — was gespeichert und gerendert
// werden darf.
//
// Warum es das gibt: THEME_JSON wurde bis 10/2026 ungeprueft gespeichert, und
// Werte wie `header.logoMaxHeightMm` landeten ungefiltert im <style> der
// Vorlagen. Ein Wert wie `20mm;}body{background:url(http://127.0.0.1:3001/…)}`
// liess den Renderer auf dem Server Anfragen ins interne Netz schicken. Wer
// Dokumentvorlagen pflegen darf, ist in einer SaaS kein vertrauenswuerdiger
// Absender.
//
// Regeln: nur bekannte Schluessel, je Schluessel Typ und Wertebereich; was
// fehlt oder nicht passt, faellt auf den Standard zurueck. Die Funktion laeuft
// beim Speichern UND beim Rendern — Altbestand in der Datenbank ist damit auch
// ohne Migration entschaerft.
// ─────────────────────────────────────────────────────────────────────────────

const { defaultTheme } = require('./services_theme_defaults');
const { resolveFont } = require('./services_theme_fonts');

const APPENDIX_KEYS = ['showPayments', 'showProjectStructure', 'showTec', 'showHonorar'];
const CATEGORIES = ['invoice_rechnung', 'invoice_schluss', 'invoice_abschlags', 'offer_angebot'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function color(v, fallback) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v.trim()) ? v.trim().toLowerCase() : fallback;
}
function bool(v, fallback) {
  return typeof v === 'boolean' ? v : fallback;
}
function num(v, fallback, min, max) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}
function oneOf(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

function sanitizeBlocks(raw, def) {
  const b = isObj(raw) ? raw : {};
  const out = {};
  for (const k of APPENDIX_KEYS) out[k] = bool(b[k], def[k] !== false);
  const order = Array.isArray(b.order) ? b.order : def.order;
  out.order = [...new Set((order || []).filter((k) => APPENDIX_KEYS.includes(k)))];
  return out;
}

/**
 * Bereinigt ein THEME_JSON und fuellt Fehlendes mit dem Standard auf.
 * Liefert immer ein vollstaendiges Theme der aktuellen Version.
 */
function sanitizeTheme(raw) {
  const def = defaultTheme();
  const t = isObj(raw) ? raw : {};
  const brand = isObj(t.brand) ? t.brand : {};
  const header = isObj(t.header) ? t.header : {};
  const footer = isObj(t.footer) ? t.footer : {};

  const out = {
    version: def.version,
    brand: {
      primaryColor: color(brand.primaryColor, def.brand.primaryColor),
      accentColor:  color(brand.accentColor, def.brand.accentColor),
      // Altbestand speicherte einen CSS-Stack statt eines Schluessels —
      // resolveFont uebersetzt ihn und liefert nur bekannte Schluessel.
      fontFamily:   typeof brand.fontFamily === 'string' ? resolveFont(brand.fontFamily).key : def.brand.fontFamily,
      fontScale:    num(brand.fontScale, def.brand.fontScale, 0.85, 1.15),
    },
    header: {
      showLogo:        bool(header.showLogo, def.header.showLogo),
      logoMaxHeightMm: num(header.logoMaxHeightMm, def.header.logoMaxHeightMm, 8, 40),
      logoPosition:    oneOf(header.logoPosition, ['left', 'center', 'right'], def.header.logoPosition),
      showBauvorhaben: bool(header.showBauvorhaben, def.header.showBauvorhaben),
    },
    footer: {
      showPageNumbers: bool(footer.showPageNumbers, def.footer.showPageNumbers),
    },
    blocks: sanitizeBlocks(t.blocks, def.blocks),
  };

  if (isObj(t.blocksByCategory)) {
    out.blocksByCategory = {};
    for (const cat of CATEGORIES) {
      if (isObj(t.blocksByCategory[cat])) out.blocksByCategory[cat] = sanitizeBlocks(t.blocksByCategory[cat], def.blocks);
    }
  }
  return out;
}

module.exports = { sanitizeTheme, APPENDIX_KEYS, CATEGORIES };
