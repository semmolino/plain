#!/usr/bin/env bash
# PDF/A-3b-Pruefung der ZUGFeRD-Hybrid-PDFs mit veraPDF (CI-Job „pdfa").
#
# Rendert Musterbelege wie im Betrieb (backend/scripts/pdfa-sample.js) und
# laesst veraPDF (Greenfield) jedes PDF gegen PDF/A-3b pruefen. Ein einziger
# Regelverstoss laesst den Job scheitern — ein Hybrid-PDF, das sich PDF/A
# nennt und keins ist, weisen strenge Empfaenger ab.
#
# Braucht Java (≥ 11) und Node mit installiertem backend/node_modules
# (Chromium aus playwright-chromium). veraPDF wird nach $VERAPDF_DIR
# installiert, wenn es dort fehlt.
set -euo pipefail

VERAPDF_DIR="${VERAPDF_DIR:-$HOME/verapdf}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -x "$VERAPDF_DIR/verapdf" ]; then
  tmp="$(mktemp -d)"
  curl -sSL -o "$tmp/verapdf-installer.zip" https://software.verapdf.org/releases/verapdf-installer.zip
  unzip -q "$tmp/verapdf-installer.zip" -d "$tmp"
  cat > "$tmp/auto-install.xml" <<XML
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>$VERAPDF_DIR</installpath></com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
    <pack index="0" name="veraPDF GUI" selected="true"/>
    <pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/>
    <pack index="2" name="veraPDF Validation model" selected="false"/>
    <pack index="3" name="veraPDF Documentation" selected="false"/>
    <pack index="4" name="veraPDF Sample Plugins" selected="false"/>
  </com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
XML
  java -jar "$tmp"/verapdf-greenfield-*/verapdf-izpack-installer-*.jar "$tmp/auto-install.xml"
fi

out="$(mktemp -d)"
node "$ROOT/backend/scripts/pdfa-sample.js" "$out"
set +e
"$VERAPDF_DIR/verapdf" --flavour 3b --format text "$out"/*.pdf | tee "$out/report.txt"
set -e
if grep -q '^FAIL' "$out/report.txt" || ! grep -q '^PASS' "$out/report.txt"; then
  echo "PDF/A-3b-Pruefung fehlgeschlagen — Details: verapdf --flavour 3b --format text <datei>" >&2
  "$VERAPDF_DIR/verapdf" --flavour 3b --format mrr "$out"/*.pdf | grep -E 'failedChecks|description' | head -40 >&2 || true
  exit 1
fi
echo "PDF/A-3b: alle Musterbelege konform."
