"use strict";

/**
 * Blattpfade eines erzeugten Dokuments auslesen.
 *
 * Das ist das Werkzeug, mit dem `registryCheck.js` die Mapping-Tabelle gegen
 * das tatsächlich erzeugte XML hält: eine Zeile in der Registry, die behauptet,
 * BT-11 lande in `cac:ProjectReference/cbc:ID`, wird damit prüfbar statt
 * geglaubt. Genau diese Prüfung fehlte der Excel-Tabelle — sie konnte nur
 * behaupten.
 *
 * Bewusst kein XML-Parser als Abhängigkeit: die Eingabe ist ausschließlich
 * unser eigenes, von den Buildern erzeugtes Markup (keine CDATA, keine
 * Kommentare, keine Processing Instructions außer der XML-Deklaration). Für
 * fremdes XML wäre dieser Scanner zu naiv — er wird deshalb nirgends auf
 * Empfangsdaten angewendet.
 */

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/**
 * @param {string} xml
 * @returns {{path:string, value:string, attrs:Record<string,string>}[]}
 *   Ein Eintrag je Blattelement (Element ohne Kindelemente), in Dokumentreihenfolge.
 */
function leafPaths(xml) {
  const src = String(xml || "").replace(/<\?[\s\S]*?\?>/g, "");
  const stack = [];
  const out = [];
  const hadChild = [];
  const openAttrs = [];
  let lastIndex = 0;
  let m;

  TAG.lastIndex = 0;
  while ((m = TAG.exec(src)) !== null) {
    const [full, closing, name, rawAttrs, selfClosing] = m;

    if (!closing) {
      if (stack.length) hadChild[stack.length - 1] = true;
      stack.push(name);
      hadChild[stack.length - 1] = false;
      lastIndex = m.index + full.length;
      if (selfClosing) {
        out.push({ path: stack.join("/"), value: "", attrs: parseAttrs(rawAttrs) });
        stack.pop();
        hadChild.length = stack.length;
      } else {
        // Attribute des offenen Elements merken, falls es ein Blatt wird.
        openAttrs[stack.length - 1] = parseAttrs(rawAttrs);
      }
      continue;
    }

    // Schließendes Tag
    if (!hadChild[stack.length - 1]) {
      out.push({
        path: stack.join("/"),
        value: src.slice(lastIndex, m.index).trim(),
        attrs: openAttrs[stack.length - 1] || {},
      });
    }
    stack.pop();
    hadChild.length = stack.length;
    lastIndex = m.index + full.length;
  }

  return out;

  function parseAttrs(raw) {
    const attrs = {};
    const re = /([\w.:-]+)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = re.exec(raw || "")) !== null) attrs[a[1]] = a[2];
    return attrs;
  }
}

/** Nur die Pfade, ohne Werte — als Menge, für Abdeckungsprüfungen. */
function leafPathSet(xml) {
  return new Set(leafPaths(xml).map((l) => l.path));
}

module.exports = { leafPaths, leafPathSet };
