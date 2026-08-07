#!/usr/bin/env bash
# =============================================================================
# start-web.sh — Startbefehl des web-Prozesses
#
# Startet PostgREST und das Node-Backend im SELBEN Container.
#
# Warum zusammen und nicht als zwei Apps:
#   • PostgREST lauscht nur auf 127.0.0.1 und ist damit von aussen gar nicht
#     erreichbar. Als eigene App muesste es oeffentlich sein.
#   • Kein Netzwerkweg zwischen beiden — die 750 supabase-js-Aufrufe gehen
#     ueber Loopback statt uebers Internet.
#   • Keine zweite App, keine zusaetzlichen Kosten, ein Deploy.
#
# Solange POSTGREST_ENABLED nicht auf "true" steht, laeuft nur das Backend.
# Der Umstieg ist damit ein Schalter, kein Deploy.
# =============================================================================

set -uo pipefail

PGRST_BIN="./bin/postgrest"

start_postgrest() {
  [[ "${POSTGREST_ENABLED:-false}" == "true" ]] || { echo "[start] PostgREST deaktiviert (POSTGREST_ENABLED != true)"; return 1; }
  [[ -x "$PGRST_BIN" ]] || { echo "[start] WARNUNG: $PGRST_BIN fehlt — Build unvollstaendig?" >&2; return 1; }

  # PostgREST liest seine Konfiguration direkt aus PGRST_*-Variablen.
  # Nur die Werte setzen, die nicht schon von aussen kommen.
  export PGRST_DB_URI="${PGRST_DB_URI:-${SCALINGO_POSTGRESQL_URL:-}}"
  export PGRST_SERVER_HOST="${PGRST_SERVER_HOST:-127.0.0.1}"
  export PGRST_SERVER_PORT="${PGRST_SERVER_PORT:-3001}"
  export PGRST_DB_SCHEMAS="${PGRST_DB_SCHEMAS:-public}"

  if [[ -z "$PGRST_DB_URI" ]]; then
    echo "[start] WARNUNG: PGRST_DB_URI leer — PostgREST wird nicht gestartet." >&2
    return 1
  fi

  echo "[start] PostgREST auf ${PGRST_SERVER_HOST}:${PGRST_SERVER_PORT} (Schema ${PGRST_DB_SCHEMAS})"
  "$PGRST_BIN" &
  PGRST_PID=$!
  return 0
}

PGRST_PID=""
start_postgrest || true

echo "[start] Backend auf Port ${PORT:-3000}"
node backend/server.js &
NODE_PID=$!

# Endet einer der beiden, endet der Container — Scalingo startet ihn neu.
# Ohne das liefe ein halb totes Gespann unbemerkt weiter.
wait -n
CODE=$?
echo "[start] Ein Prozess ist beendet (Code $CODE) — Container wird beendet."
[[ -n "$PGRST_PID" ]] && kill "$PGRST_PID" 2>/dev/null
[[ -n "$NODE_PID"  ]] && kill "$NODE_PID"  2>/dev/null
exit "$CODE"
