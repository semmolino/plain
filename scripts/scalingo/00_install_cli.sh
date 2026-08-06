#!/usr/bin/env bash
# =============================================================================
# 00_install_cli.sh — Scalingo-CLI unter Windows (Git-Bash) einrichten
#
# AUSFUEHREN IN: Git-Bash, Verzeichnis egal
#   bash scripts/scalingo/00_install_cli.sh
#
# Installiert nach ~/bin und ergaenzt den PATH in ~/.bashrc.
# Idempotent: mehrfaches Ausfuehren ist unschaedlich.
# =============================================================================

set -euo pipefail

BIN_DIR="$HOME/bin"
URL="https://cli-dl.scalingo.com/release/scalingo_latest_windows_amd64.zip"

echo "============================================================"
echo " Scalingo-CLI installieren"
echo "============================================================"

if command -v scalingo >/dev/null 2>&1; then
  echo "✓ Bereits installiert: $(scalingo --version)"
  echo "  Neuinstallation nicht noetig. Weiter mit 01_setup.sh."
  exit 0
fi

mkdir -p "$BIN_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Lade CLI ..."
if ! curl -fsSL "$URL" -o "$TMP/scalingo.zip"; then
  echo ""
  echo "FEHLER: Download fehlgeschlagen." >&2
  echo "  Die Download-Adresse hat sich moeglicherweise geaendert." >&2
  echo "  Hole die Datei manuell von https://cli.scalingo.com/ ," >&2
  echo "  entpacke scalingo.exe und lege sie nach $BIN_DIR ab." >&2
  exit 1
fi

echo "→ Entpacke ..."
unzip -oq "$TMP/scalingo.zip" -d "$TMP"
find "$TMP" -name "scalingo.exe" -exec cp {} "$BIN_DIR/scalingo.exe" \;

if [[ ! -f "$BIN_DIR/scalingo.exe" ]]; then
  echo "FEHLER: scalingo.exe im Archiv nicht gefunden." >&2
  exit 1
fi

# PATH dauerhaft ergaenzen, aber nur einmal
if ! grep -q 'HOME/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/bin:$PATH"' >> "$HOME/.bashrc"
  echo "→ PATH in ~/.bashrc ergaenzt"
fi
export PATH="$BIN_DIR:$PATH"

echo ""
echo "✓ Installiert: $("$BIN_DIR/scalingo.exe" --version)"
cat <<'HINWEIS'

NAECHSTER SCHRITT — einmalig anmelden.

  Konto ueber GitHub angelegt (kein Passwort)?  -> API-Token verwenden:
      1. https://dashboard.scalingo.com/account/tokens
      2. "Create new token", Token kopieren (wird nur EINMAL angezeigt)
      3. Diese Zeile UNVERAENDERT ausfuehren (den Token NICHT hineinschreiben):

             read -rsp 'API-Token: ' TOKEN

         Danach einfuegen mit Rechtsklick -> Paste oder Shift+Einfg
         (Strg+V geht in MINGW64 nicht). Es erscheint nichts — richtig so.
         Dann Enter.

      4. echo "${#TOKEN} Zeichen"        # muss ~50 sein, nicht 0
         scalingo login --api-token "$TOKEN" && unset TOKEN

  Konto mit Passwort oder hinterlegtem SSH-Schluessel?
      scalingo login

  Pruefen:   scalingo whoami
  Danach:    bash scripts/scalingo/01_setup.sh
HINWEIS
echo ""
echo "  HINWEIS: In einem NEUEN Git-Bash-Fenster ist der PATH aktiv."
echo "  Im aktuellen Fenster vorher einmal:  export PATH=\"\$HOME/bin:\$PATH\""
