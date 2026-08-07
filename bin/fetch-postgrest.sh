#!/usr/bin/env bash
# =============================================================================
# fetch-postgrest.sh — PostgREST-Binary beim Build holen
#
# Wird aus scalingo-postbuild (package.json) aufgerufen.
#
# Warum ein Download und kein Paket: PostgREST ist ein Haskell-Programm und
# liegt in keinem Ubuntu-Repository. Es gibt aber ein STATISCH gelinktes
# Binary (~4 MB) — das braucht keine Systembibliotheken und laeuft damit auf
# jedem Linux, auch auf Scalingos Ubuntu 26.04.
#
# Ablageort ist ./bin im Build-Verzeichnis. Das wandert als Teil der App nach
# /app und ist zur Laufzeit da — anders als ein absoluter Pfad ausserhalb des
# Build-Verzeichnisses, der beim Deploy verloren ginge.
# =============================================================================

set -euo pipefail

VERSION="${POSTGREST_VERSION:-v14.16}"
DEST="${1:-./bin}"
URL="https://github.com/PostgREST/postgrest/releases/download/${VERSION}/postgrest-${VERSION}-linux-static-x86-64.tar.xz"

mkdir -p "$DEST"

if [[ -x "$DEST/postgrest" ]]; then
  echo "[postgrest] bereits vorhanden: $("$DEST/postgrest" --version 2>/dev/null || echo unbekannt)"
  exit 0
fi

echo "[postgrest] lade $VERSION ..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! curl -fsSL --retry 3 --max-time 300 "$URL" -o "$TMP/pgrst.tar.xz"; then
  echo "[postgrest] FEHLER: Download fehlgeschlagen: $URL" >&2
  exit 1
fi

tar -xJf "$TMP/pgrst.tar.xz" -C "$TMP"
BIN="$(find "$TMP" -name postgrest -type f | head -1)"
[[ -n "$BIN" ]] || { echo "[postgrest] FEHLER: Binary im Archiv nicht gefunden." >&2; exit 1; }

install -m 0755 "$BIN" "$DEST/postgrest"
echo "[postgrest] installiert: $("$DEST/postgrest" --version 2>/dev/null || echo "(Version nicht abfragbar)")"
