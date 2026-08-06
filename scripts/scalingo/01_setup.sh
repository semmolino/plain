#!/usr/bin/env bash
# =============================================================================
# 01_setup.sh — Scalingo-App anlegen und Umgebungsvariablen setzen
#
# AUSFUEHREN IN: Git-Bash, im WURZELVERZEICHNIS des Repositories
#   bash scripts/scalingo/01_setup.sh
#
# Optional andere App/Region:
#   APP=plain-test REGION=osc-fr1 bash scripts/scalingo/01_setup.sh
#
# Die Werte fuer JWT_SECRET, SUPABASE_URL und SUPABASE_SERVICE_KEY werden aus
# backend/.env uebernommen. Sie werden NICHT auf dem Bildschirm ausgegeben.
#
# Idempotent: existiert die App bereits, wird sie weiterverwendet.
# =============================================================================

set -euo pipefail

APP="${APP:-plain-test}"
REGION="${REGION:-osc-fr1}"
ENV_FILE="backend/.env"

echo "============================================================"
echo " Scalingo-App einrichten:  $APP   (Region $REGION)"
echo "============================================================"

# ── Vorbedingungen ──────────────────────────────────────────────────────────
if [[ ! -f "package.json" || ! -d "backend" ]]; then
  echo "FEHLER: Bitte im Wurzelverzeichnis des Repositories ausfuehren." >&2
  echo "  Erwartet: package.json und backend/ im aktuellen Verzeichnis." >&2
  exit 1
fi

if ! command -v scalingo >/dev/null 2>&1; then
  echo "FEHLER: scalingo-CLI nicht gefunden." >&2
  echo "  Erst ausfuehren: bash scripts/scalingo/00_install_cli.sh" >&2
  echo "  Danach ggf.:     export PATH=\"\$HOME/bin:\$PATH\"" >&2
  exit 1
fi

if ! scalingo whoami >/dev/null 2>&1; then
  cat >&2 <<'HINWEIS'
FEHLER: Nicht bei Scalingo angemeldet.

  Bei Konten, die ueber GitHub angelegt wurden, funktioniert ein einfaches
  "scalingo login" NICHT: es versucht zuerst SSH (scheitert ohne hinterlegten
  Schluessel) und fragt dann nach einem Passwort, das es bei OAuth nicht gibt.

  Loesung — API-Token:
    1. https://dashboard.scalingo.com/account/tokens oeffnen
    2. "Create new token", Namen vergeben, erzeugen
    3. Token kopieren (wird nur EINMAL angezeigt)
    4. Diese Zeile ausfuehren — UNVERAENDERT, ohne den Token hineinzuschreiben:

           read -rsp 'API-Token: ' TOKEN

       Der Cursor wartet dann. JETZT den Token einfuegen:
         - Rechtsklick ins Fenster -> Paste,  oder  Shift+Einfg
         - Strg+V funktioniert in MINGW64 NICHT
         - Es erscheint nichts — die Eingabe ist absichtlich unsichtbar
       Dann Enter.

    5. Kontrolle und Anmeldung:

           echo "${#TOKEN} Zeichen"        # muss ~50 sein, nicht 0
           scalingo login --api-token "$TOKEN" && unset TOKEN

  WICHTIG: Den Token NICHT in die read-Zeile schreiben. Alles zwischen den
  Anführungszeichen ist nur der Anzeigetext — der Token landete sonst in
  ~/.bash_history und waere zu widerrufen.

  Alternativen: Passwort im Profil nachtragen, oder einen SSH-Schluessel
  hinterlegen — dann funktioniert auch "scalingo login" direkt.
HINWEIS
  exit 1
fi
echo "✓ Angemeldet als: $(scalingo whoami)"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FEHLER: $ENV_FILE nicht gefunden — dort liegen die Zugangsdaten." >&2
  exit 1
fi

# ── Werte aus backend/.env lesen ────────────────────────────────────────────
# Bewusst kein "source": die Werte koennen Sonderzeichen enthalten.
# tr -d '\r' entfernt Windows-Zeilenenden, die sonst im Wert landen.
read_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed 's/^["'"'"']//; s/["'"'"']$//' | tr -d '\r\n'
}

JWT_SECRET="$(read_env JWT_SECRET)"
SUPABASE_URL="$(read_env SUPABASE_URL)"
SUPABASE_SERVICE_KEY="$(read_env SUPABASE_SERVICE_KEY)"

MISSING=0
for v in JWT_SECRET SUPABASE_URL SUPABASE_SERVICE_KEY; do
  val="${!v}"                    # Umweg noetig: ${#!v} ist keine gueltige Bash-Syntax
  if [[ -z "$val" ]]; then
    echo "FEHLER: $v steht nicht in $ENV_FILE" >&2
    MISSING=1
  else
    echo "✓ $v gelesen (${#val} Zeichen)"
  fi
done
[[ $MISSING -eq 1 ]] && exit 1

# ── App anlegen ─────────────────────────────────────────────────────────────
echo ""
if scalingo --app "$APP" apps-info >/dev/null 2>&1; then
  echo "✓ App '$APP' existiert bereits — wird weiterverwendet."
else
  echo "→ Lege App '$APP' an ..."
  scalingo create "$APP" --region "$REGION"
fi

# ── Umgebungsvariablen ──────────────────────────────────────────────────────
# PORT wird von Scalingo selbst gesetzt und darf hier nicht auftauchen.
#
# MSYS_NO_PATHCONV=1 ist unter Git-Bash zwingend: MSYS2 wandelt jeden Wert, der
# wie ein absoluter Unix-Pfad aussieht, in einen Windows-Pfad um, sobald er an
# ein natives Programm (scalingo.exe) geht. Aus /app/.playwright wuerde sonst
# C:/Program Files/Git/app/.playwright — auf dem Linux-Container wertlos, und
# der Fehler faellt erst auf, wenn die PDF-Erzeugung Chromium nicht findet.
echo ""
echo "→ Setze Umgebungsvariablen ..."
# PLAYWRIGHT_BROWSERS_PATH=0 -> Chromium landet in node_modules statt in einem
#   festen Pfad. Wichtig, weil Scalingo in /build/<uuid>/ baut und den Inhalt
#   erst danach nach /app verschiebt: ein absoluter Pfad wie /app/.playwright
#   laege ausserhalb des Build-Verzeichnisses und waere nach dem Deployment weg.
#   Mit 0 wandert der Browser als Teil von node_modules mit und wird zur
#   Laufzeit am selben Ort gefunden. playwright-chromium steht in
#   "dependencies", ueberlebt das Pruning der devDependencies also.
#
# PLAYWRIGHT_HOST_PLATFORM_OVERRIDE -> Scalingos Stack ist Ubuntu 26.04,
#   Playwright 1.57 kennt aber nur bis 24.04 und bricht sonst ab mit
#       ERROR: Playwright does not support chromium on ubuntu26.04-x64
#   Der Override laedt die 24.04-Variante; sie laeuft auf 26.04, weil die
#   noetigen Bibliotheken ueber das Aptfile da sind und aeltere glibc-Bindungen
#   auf neueren Systemen weiterhin funktionieren.
#
# Beide stehen zusaetzlich in scalingo-postbuild (package.json) -- dort greifen
# sie waehrend des Builds unabhaengig davon, ob die Plattform App-Variablen in
# die Build-Phase durchreicht. Hier gesetzt gelten sie zur LAUFZEIT.
MSYS_NO_PATHCONV=1 scalingo --app "$APP" env-set \
  JWT_SECRET="$JWT_SECRET" \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
  NODE_ENV="production" \
  PLAYWRIGHT_BROWSERS_PATH="0" \
  PLAYWRIGHT_HOST_PLATFORM_OVERRIDE="ubuntu24.04-x64" \
  >/dev/null

echo "✓ Gesetzt: JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY,"
echo "           NODE_ENV=production, PLAYWRIGHT_BROWSERS_PATH=0,"
echo "           PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64"

# Zurueckgelesen pruefen — verlassen wir uns nicht darauf, dass es geklappt hat.
echo ""
echo "→ Pruefe zurueckgelesene Werte ..."
ENV_DUMP="$(scalingo --app "$APP" env 2>/dev/null)"
CHECK_FAILED=0
check_env() {
  local key="$1" want="$2"
  local got; got="$(grep -E "^$key=" <<<"$ENV_DUMP" | cut -d= -f2- | tr -d '\r')"
  if [[ "$got" == "$want" ]]; then
    echo "    ✓ $key=$want"
  else
    echo "    ✗ $key ist '$got' statt '$want'" >&2
    CHECK_FAILED=1
  fi
}
check_env PLAYWRIGHT_BROWSERS_PATH          "0"
check_env PLAYWRIGHT_HOST_PLATFORM_OVERRIDE "ubuntu24.04-x64"
check_env NODE_ENV                          "production"

if [[ $CHECK_FAILED -eq 1 ]]; then
  echo "" >&2
  echo "      Manuell korrigieren mit:" >&2
  echo "        MSYS_NO_PATHCONV=1 scalingo --app $APP env-set \\" >&2
  echo "          PLAYWRIGHT_BROWSERS_PATH=0 \\" >&2
  echo "          PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64" >&2
  exit 1
fi

echo ""
echo "  Gesetzte Variablen (Werte gekuerzt):"
scalingo --app "$APP" env | sed -E 's/=(.{0,6}).*/=\1…/' | sed 's/^/    /'

echo ""
echo "============================================================"
echo " Fertig. Naechster Schritt:"
echo "     bash scripts/scalingo/02_deploy.sh"
echo "============================================================"
