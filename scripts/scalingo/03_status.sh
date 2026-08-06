#!/usr/bin/env bash
# =============================================================================
# 03_status.sh — Zustand pruefen und die haeufigsten Fehlerquellen eingrenzen
#
# AUSFUEHREN IN: Git-Bash, Verzeichnis egal
#   bash scripts/scalingo/03_status.sh
#
# Live mitlesen statt Momentaufnahme:
#   bash scripts/scalingo/03_status.sh --follow
# =============================================================================

set -euo pipefail

APP="${APP:-plain-test}"

if [[ "${1:-}" == "--follow" ]]; then
  echo "→ Log-Ausgabe von '$APP' (Abbruch mit Strg+C)"
  exec scalingo --app "$APP" logs --follow
fi

echo "============================================================"
echo " Zustand von:  $APP"
echo "============================================================"

# ── Container ───────────────────────────────────────────────────────────────
echo ""
echo "── Container ───────────────────────────────────────────────"
scalingo --app "$APP" ps || true

# ── Umgebungsvariablen ──────────────────────────────────────────────────────
echo ""
echo "── Umgebungsvariablen (Werte gekuerzt) ─────────────────────"
scalingo --app "$APP" env 2>/dev/null | sed -E 's/=(.{0,6}).*/=\1…/' | sed 's/^/  /' || true

echo ""
echo "── Pflichtvariablen ────────────────────────────────────────"
ENV_DUMP="$(scalingo --app "$APP" env 2>/dev/null || true)"
for v in JWT_SECRET SUPABASE_URL SUPABASE_SERVICE_KEY NODE_ENV PLAYWRIGHT_BROWSERS_PATH; do
  if grep -q "^$v=" <<<"$ENV_DUMP"; then
    echo "  ✓ $v"
  else
    echo "  ✗ $v FEHLT"
  fi
done

# ── Erreichbarkeit ──────────────────────────────────────────────────────────
URL="$(scalingo --app "$APP" apps-info 2>/dev/null | grep -oE 'https://[^ ]+scalingo\.io' | head -1)"
if [[ -n "$URL" ]]; then
  echo ""
  echo "── Erreichbarkeit ──────────────────────────────────────────"
  echo "  URL: $URL"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL" || echo "000")"
  case "$CODE" in
    200) echo "  ✓ HTTP $CODE — SPA wird ausgeliefert" ;;
    000) echo "  ✗ keine Antwort — laeuft der Container? Siehe 'Container' oben." ;;
    *)   echo "  ! HTTP $CODE — Antwort, aber nicht 200. Log pruefen." ;;
  esac
fi

# ── Startmeldungen ──────────────────────────────────────────────────────────
echo ""
echo "── Letzte Log-Zeilen ───────────────────────────────────────"
LOGS="$(scalingo --app "$APP" logs --lines 60 2>/dev/null || true)"
echo "$LOGS" | tail -25 | sed 's/^/  /'

echo ""
echo "── Auswertung ──────────────────────────────────────────────"
if grep -q "Backend läuft auf Port" <<<"$LOGS"; then
  echo "  ✓ Server gestartet"
else
  echo "  ✗ Startmeldung fehlt — App laeuft nicht sauber hoch"
fi

# Typische Fehlerbilder mit direkt anschliessbarer Diagnose
if grep -qi "unable to locate package" <<<"$LOGS"; then
  echo "  ✗ Aptfile: Paketname existiert auf diesem Stack nicht."
  echo "    Haeufigster Fall: libasound2 heisst neuer libasound2t64."
  echo "    Stack pruefen:  scalingo --app $APP stacks-list"
fi
if grep -qiE "Executable doesn't exist|browserType.launch|chromium.*not found" <<<"$LOGS"; then
  echo "  ✗ Chromium nicht gefunden. Reihenfolge zum Eingrenzen:"
  echo "    1) PLAYWRIGHT_BROWSERS_PATH gesetzt? (siehe oben)"
  echo "    2) Fehlende Bibliothek suchen:"
  echo "       scalingo --app $APP run bash"
  echo "       ldd /app/.playwright/chromium-*/chrome-linux/chrome | grep 'not found'"
fi
if grep -qi "JWT_SECRET environment variable is required" <<<"$LOGS"; then
  echo "  ✗ JWT_SECRET fehlt — 01_setup.sh erneut ausfuehren."
fi
if grep -qiE "ENOENT.*frontend-react/dist|Cannot find.*index\.html" <<<"$LOGS"; then
  echo "  ✗ Frontend-Build fehlt. Im Build-Log nach 'vite build' suchen:"
  echo "    scalingo --app $APP deployment-logs"
fi
if grep -qiE "out of memory|OOM|killed" <<<"$LOGS"; then
  echo "  ✗ Speichermangel. Container vergroessern:"
  echo "    scalingo --app $APP scale web:1:L"
fi

echo ""
echo "============================================================"
echo "  Live mitlesen:  bash scripts/scalingo/03_status.sh --follow"
echo "  Build-Log:      scalingo --app $APP deployment-logs"
echo "  Konsole:        scalingo --app $APP run bash"
echo "  Stoppen:        scalingo --app $APP scale web:0"
echo "============================================================"
