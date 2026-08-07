#!/usr/bin/env bash
# =============================================================================
# 04_supabase_to_scalingo.sh — Migration in einem Durchlauf
#
#   Supabase (Frankfurt)  ──pg_dump──▶  lokal  ──psql/SSH-Tunnel──▶  Scalingo
#
# AUSFUEHREN IN: Git-Bash, im WURZELVERZEICHNIS des Repositories
#   bash backend/scripts/migration/04_supabase_to_scalingo.sh
#
# Nur bestimmte Mandanten mitnehmen (IDs als Argumente):
#   bash backend/scripts/migration/04_supabase_to_scalingo.sh 4 6
# Ohne Argumente werden ALLE Daten uebernommen.
#
# -----------------------------------------------------------------------------
# NETZWERK — der Grund fuer dieses Skript
#
# Supabase ist per Postgres-Protokoll nur ueber Port 5432 erreichbar, und die
# direkte Adresse (db.<ref>.supabase.co) hat ausschliesslich einen AAAA-Eintrag,
# ist also IPv6-only. Im ueblichen Arbeitsnetz gilt:
#     Port 443, 22   offen
#     Port 5432      BLOCKIERT   (Router/Netzbetreiber, nicht Windows-Firewall)
#     keine oeffentliche IPv6-Adresse
#
# Deshalb: dieses Skript am MOBILEN HOTSPOT ausfuehren. Mobilfunknetze sperren
# 5432 praktisch nie, und der Pooler-Endpunkt hat eine IPv4-Adresse.
#
# Das Skript prueft die Erreichbarkeit als Erstes und bricht sonst sofort ab.
# -----------------------------------------------------------------------------

set -euo pipefail

APP="${APP:-plain-test}"
REGION="${SUPABASE_REGION:-eu-central-1}"
PGBIN="${PGBIN:-$HOME/AppData/Local/Temp/claude/c--Users-simon-Desktop-plain-2603-plain/e1c8ad08-7229-40b6-8eda-0d16275bf24f/scratchpad/pgtools/pgsql/bin}"
OUT="./export"
TUNNEL_PORT=10000
TUNNEL_PID=""

cleanup() { [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null || true; }
trap cleanup EXIT

say() { echo ""; echo "── $* ─────────────────────────────────────────" ; }

# ── Werkzeuge ───────────────────────────────────────────────────────────────
PG_DUMP="$PGBIN/pg_dump.exe"; PSQL="$PGBIN/psql.exe"
if [[ ! -x "$PG_DUMP" ]]; then
  command -v pg_dump >/dev/null 2>&1 || { echo "FEHLER: pg_dump nicht gefunden. PGBIN setzen." >&2; exit 1; }
  PG_DUMP="$(command -v pg_dump)"; PSQL="$(command -v psql)"
fi
echo "Werkzeuge: $("$PG_DUMP" --version)"

[[ -f package.json && -d backend ]] || { echo "FEHLER: Bitte im Repo-Wurzelverzeichnis ausfuehren." >&2; exit 1; }

# ── Projekt-Referenz aus backend/.env ───────────────────────────────────────
REF="$(grep -E '^SUPABASE_URL=' backend/.env | sed 's|.*https://||; s|\.supabase\.co.*||' | tr -d '\r\n')"
[[ -n "$REF" ]] || { echo "FEHLER: SUPABASE_URL nicht in backend/.env gefunden." >&2; exit 1; }
POOLER="aws-0-$REGION.pooler.supabase.com"
echo "Supabase-Projekt: $REF   Pooler: $POOLER"

# ── Erreichbarkeit ZUERST pruefen ───────────────────────────────────────────
say "Netzwerk pruefen"
if timeout 10 bash -c "cat < /dev/null > /dev/tcp/$POOLER/5432" 2>/dev/null; then
  echo "  ✓ $POOLER:5432 erreichbar"
else
  cat >&2 <<HINWEIS
  ✗ $POOLER:5432 NICHT erreichbar.

  Port 5432 ist in diesem Netz gesperrt. Ohne ihn ist kein pg_dump moeglich.

  Loesung: Rechner an einen mobilen Hotspot haengen und dieses Skript dort
  erneut starten. Mobilfunknetze lassen 5432 praktisch immer durch.

  Falls die Region falsch geraten ist (Standard: $REGION), die richtige
  aus dem Supabase-Dashboard nehmen (Settings -> Database -> Connection
  string) und so starten:
      SUPABASE_REGION=eu-west-1 bash $0 $*
HINWEIS
  exit 1
fi

# ── Passwort erfragen ───────────────────────────────────────────────────────
say "Supabase-Datenbankpasswort"
cat <<'ANLEITUNG'
  Zu finden im Supabase-Dashboard:
      Project Settings -> Database -> Connection string -> URI
      (dort der Teil zwischen "postgres:" und "@")
  Nicht bekannt? Auf derselben Seite "Reset database password".

  Gleich einfuegen mit RECHTSKLICK -> Paste oder Shift+Einfg.
  Strg+V funktioniert in Git-Bash NICHT. Die Eingabe bleibt unsichtbar.
ANLEITUNG
echo ""
read -rsp "  Passwort: " SUPA_PASS
echo ""
[[ -n "$SUPA_PASS" ]] || { echo "  FEHLER: leer eingegeben." >&2; exit 1; }
echo "  ✓ ${#SUPA_PASS} Zeichen gelesen"

# Der Pooler verlangt "postgres.<projekt-ref>" als Benutzernamen.
SRC_USER="postgres.$REF"
export PGPASSWORD="$SUPA_PASS"

say "Verbindung zu Supabase testen"
SRC_VER="$("$PSQL" -h "$POOLER" -p 5432 -U "$SRC_USER" -d postgres -Atc "select version();" 2>&1 | head -1)"
if [[ "$SRC_VER" != PostgreSQL* ]]; then
  echo "  ✗ Verbindung fehlgeschlagen:" >&2; echo "    $SRC_VER" >&2; exit 1
fi
echo "  ✓ ${SRC_VER:0:60}…"

# ── Ausgangsstand festhalten (fuer die spaetere Kontrolle) ──────────────────
say "Zeilenzahlen an der Quelle"
mkdir -p "$OUT/data"
"$PSQL" -h "$POOLER" -p 5432 -U "$SRC_USER" -d postgres -Atc "
  SELECT c.relname||'='||c.reltuples::bigint
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname
" > "$OUT/quelle_zeilen.txt"
echo "  $(wc -l < "$OUT/quelle_zeilen.txt") Tabellen erfasst"

# ── Schema exportieren ──────────────────────────────────────────────────────
# In zwei Abschnitten: erst Tabellen ohne Constraints, ganz am Ende die
# Constraints/Indizes. Dadurch spielt die Ladereihenfolge der Daten keine
# Rolle und es braucht keine Superuser-Rechte auf der Zielseite.
say "Schema exportieren"
"$PG_DUMP" -h "$POOLER" -p 5432 -U "$SRC_USER" -d postgres \
  --schema-only --section=pre-data --schema=public \
  --no-owner --no-privileges --no-comments -f "$OUT/01_schema_pre.sql"
echo "  ✓ pre-data  ($(wc -l < "$OUT/01_schema_pre.sql") Zeilen)"

"$PG_DUMP" -h "$POOLER" -p 5432 -U "$SRC_USER" -d postgres \
  --schema-only --section=post-data --schema=public \
  --no-owner --no-privileges --no-comments -f "$OUT/03_schema_post.sql"
echo "  ✓ post-data ($(wc -l < "$OUT/03_schema_post.sql") Zeilen)"

# ── Daten exportieren ───────────────────────────────────────────────────────
say "Daten exportieren"
: > "$OUT/02_load_data.sql"
if [[ $# -gt 0 ]]; then
  TENANTS="$(IFS=,; echo "$*")"
  echo "  Nur Mandanten: $TENANTS"
else
  TENANTS=""
  echo "  Alle Daten (keine Mandanten-IDs angegeben)"
fi

mapfile -t TABLES < <("$PSQL" -h "$POOLER" -p 5432 -U "$SRC_USER" -d postgres -Atc "
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname")

for tbl in "${TABLES[@]}"; do
  [[ -z "$tbl" ]] && continue
  HAS_T="$("$PSQL" -h "$POOLER" -p 5432 -U "$SRC_USER" -d postgres -Atc "
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='$tbl' AND column_name='TENANT_ID'")"
  if [[ -n "$TENANTS" && "$HAS_T" == "1" ]]; then
    WHERE="WHERE \"TENANT_ID\" IN ($TENANTS)"
  else
    WHERE=""
  fi
  "$PSQL" -h "$POOLER" -p 5432 -U "$SRC_USER" -d postgres -q \
    -c "\copy (SELECT * FROM \"$tbl\" $WHERE) TO '$OUT/data/$tbl.csv' WITH (FORMAT csv, HEADER)"
  N=$(( $(wc -l < "$OUT/data/$tbl.csv") - 1 ))
  printf "  %-28s %8s Zeilen\n" "$tbl" "$N"
  echo "\\copy \"$tbl\" FROM 'data/$tbl.csv' WITH (FORMAT csv, HEADER)" >> "$OUT/02_load_data.sql"
done

# ── Sequenzen ───────────────────────────────────────────────────────────────
# Ohne diesen Schritt stehen alle Sequenzen nach dem Import auf 1 und der
# erste neue Datensatz kollidiert mit einer bestehenden ID.
say "Sequenz-Reset erzeugen"
"$PSQL" -h "$POOLER" -p 5432 -U "$SRC_USER" -d postgres -Atc "
  SELECT format('SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 1), true);',
                quote_ident(sn.nspname)||'.'||quote_ident(s.relname), a.attname, t.relname)
  FROM pg_class s
  JOIN pg_namespace sn ON sn.oid=s.relnamespace
  JOIN pg_depend d ON d.objid=s.oid AND d.deptype IN ('a','i')
  JOIN pg_class t ON t.oid=d.refobjid
  JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
  JOIN pg_namespace tn ON tn.oid=t.relnamespace
  WHERE s.relkind='S' AND tn.nspname='public' ORDER BY t.relname
" > "$OUT/04_sequences.sql"
echo "  $(wc -l < "$OUT/04_sequences.sql") Sequenzen"
unset PGPASSWORD

# ── Supabase-Reste im Schema melden ─────────────────────────────────────────
say "Schema auf Supabase-Reste pruefen"
if grep -nE 'auth\.|storage\.|supabase|extensions\.|graphql' "$OUT/01_schema_pre.sql" | head -10; then
  echo "  ↑ Diese Zeilen koennen beim Import scheitern (Supabase-eigene Schemas)."
  echo "    Erwartbar bei current_tenant_id() und den RLS-Policies — beides wird"
  echo "    ohnehin durch 03_rls_postgrest.sql ersetzt."
else
  echo "  ✓ keine gefunden"
fi

# ── Tunnel zur Scalingo-Datenbank ───────────────────────────────────────────
say "Tunnel zu Scalingo oeffnen"
DB_URL="$(scalingo --app "$APP" env 2>/dev/null | grep '^SCALINGO_POSTGRESQL_URL=' | cut -d= -f2-)"
[[ -n "$DB_URL" ]] || { echo "FEHLER: SCALINGO_POSTGRESQL_URL nicht gefunden. Addon angelegt?" >&2; exit 1; }
DST_USER="$(sed -E 's|postgres://([^:]+):.*|\1|' <<<"$DB_URL")"
DST_PASS="$(sed -E 's|postgres://[^:]+:([^@]+)@.*|\1|' <<<"$DB_URL")"
DST_NAME="$(sed -E 's|.*/([^?]+).*|\1|' <<<"$DB_URL")"

KEY=""
for k in ~/.ssh/id_ed25519 ~/.ssh/id_rsa; do [[ -f "$k" ]] && { KEY="$(cygpath -w "$k" 2>/dev/null || echo "$k")"; break; }; done
[[ -n "$KEY" ]] || { echo "FEHLER: kein SSH-Schluessel in ~/.ssh gefunden." >&2; exit 1; }

scalingo --app "$APP" db-tunnel -i "$KEY" --port "$TUNNEL_PORT" SCALINGO_POSTGRESQL_URL > /tmp/tunnel.log 2>&1 &
TUNNEL_PID=$!
for i in $(seq 1 30); do sleep 1; grep -qi "You can access" /tmp/tunnel.log 2>/dev/null && break; done
grep -qi "You can access" /tmp/tunnel.log || { echo "FEHLER: Tunnel kam nicht hoch:" >&2; cat /tmp/tunnel.log >&2; exit 1; }
echo "  ✓ 127.0.0.1:$TUNNEL_PORT"

export PGPASSWORD="$DST_PASS"
dst() { "$PSQL" -h 127.0.0.1 -p "$TUNNEL_PORT" -U "$DST_USER" -d "$DST_NAME" "$@"; }

# ── Import ──────────────────────────────────────────────────────────────────
say "Import: Tabellen"
dst -v ON_ERROR_STOP=1 -q -f "$OUT/01_schema_pre.sql" && echo "  ✓"

say "Import: Daten"
(cd "$OUT" && "$PSQL" -h 127.0.0.1 -p "$TUNNEL_PORT" -U "$DST_USER" -d "$DST_NAME" -v ON_ERROR_STOP=1 -q -f 02_load_data.sql) && echo "  ✓"

say "Import: Constraints und Indizes"
dst -v ON_ERROR_STOP=1 -q -f "$OUT/03_schema_post.sql" && echo "  ✓"

say "Import: Sequenzen"
dst -v ON_ERROR_STOP=1 -q -f "$OUT/04_sequences.sql" && echo "  ✓"

# ── Kontrolle ───────────────────────────────────────────────────────────────
say "Kontrolle: Zeilenzahlen im Ziel"
# Quelle = exportierte CSV-Zeilen, Ziel = echtes count(*). Beides exakt,
# nicht die geschaetzten reltuples aus dem Planner.
printf "  %-28s %10s %10s\n" "TABELLE" "QUELLE" "ZIEL"
printf "  %-28s %10s %10s\n" "----------------------------" "----------" "----------"
ABWEICHUNG=0
for tbl in "${TABLES[@]}"; do
  [[ -z "$tbl" ]] && continue
  SRC_N=$(( $(wc -l < "$OUT/data/$tbl.csv") - 1 ))
  DST_N="$(dst -Atc "SELECT count(*) FROM \"$tbl\"" 2>/dev/null || echo "?")"
  MARK=""
  [[ "$SRC_N" != "$DST_N" ]] && { MARK="  ← ABWEICHUNG"; ABWEICHUNG=1; }
  printf "  %-28s %10s %10s%s\n" "$tbl" "$SRC_N" "$DST_N" "$MARK"
done

say "Kontrolle: Struktur"
printf "  Tabellen   : %s\n" "$(dst -Atc "select count(*) from information_schema.tables where table_schema='public'")"
printf "  Views      : %s\n" "$(dst -Atc "select count(*) from information_schema.views where table_schema='public'")"
printf "  Funktionen : %s\n" "$(dst -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")"
printf "  Constraints: %s\n" "$(dst -Atc "select count(*) from information_schema.table_constraints where constraint_schema='public'")"
printf "  Sequenzen  : %s\n" "$(dst -Atc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'")"
unset PGPASSWORD

echo ""
echo "═══════════════════════════════════════════════════════════"
if [[ $ABWEICHUNG -eq 0 ]]; then
  echo " Migration abgeschlossen — alle Zeilenzahlen stimmen ueberein."
else
  echo " Migration abgeschlossen — ABWEICHUNGEN bei den Zeilenzahlen!"
  echo " Oben markierte Tabellen pruefen, bevor umgeschaltet wird."
fi
echo ""
echo " Naechste Schritte:"
echo "   1. Netz zurueckstellen (Hotspot nicht mehr noetig)"
echo "   2. RLS scharf schalten: 03_rls_postgrest.sql"
echo "   3. PostgREST davorstellen, dann SUPABASE_URL umstellen"
echo "═══════════════════════════════════════════════════════════"
