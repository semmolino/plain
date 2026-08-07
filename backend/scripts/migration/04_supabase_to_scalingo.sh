#!/usr/bin/env bash
# =============================================================================
# 04_supabase_to_scalingo.sh — Migration in einem Durchlauf
#
#   Supabase  ──pg_dump──▶  lokal  ──psql ueber SSH-Tunnel──▶  Scalingo
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
# Supabase ist per Postgres-Protokoll nur ueber Port 5432 erreichbar. Im
# ueblichen Arbeitsnetz wurde gemessen:
#     443, 22   offen
#     5432      BLOCKIERT   (Router/Netzbetreiber, nicht die Windows-Firewall)
#     6543      blockiert
#     5000      blockiert   (deshalb geht auch "scalingo run" nicht)
# Ausserdem hat die direkte Adresse db.<ref>.supabase.co nur einen AAAA-
# Eintrag (IPv6-only), und der Rechner hat keine oeffentliche IPv6-Adresse.
#
# Deshalb: dieses Skript am MOBILEN HOTSPOT ausfuehren und den SESSION-POOLER
# verwenden — der hat eine IPv4-Adresse und laesst pg_dump zu.
# -----------------------------------------------------------------------------

set -euo pipefail

APP="${APP:-plain-test}"
PGBIN="${PGBIN:-$HOME/AppData/Local/Temp/claude/c--Users-simon-Desktop-plain-2603-plain/e1c8ad08-7229-40b6-8eda-0d16275bf24f/scratchpad/pgtools/pgsql/bin}"
OUT="./export"
TUNNEL_PORT=10000
TUNNEL_PID=""

cleanup() { [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null || true; }
trap cleanup EXIT

say() { echo ""; echo "── $* ─────────────────────────────────────────"; }

# ── Werkzeuge ───────────────────────────────────────────────────────────────
PG_DUMP="$PGBIN/pg_dump.exe"; PSQL="$PGBIN/psql.exe"
if [[ ! -x "$PG_DUMP" ]]; then
  command -v pg_dump >/dev/null 2>&1 || { echo "FEHLER: pg_dump nicht gefunden. PGBIN setzen." >&2; exit 1; }
  PG_DUMP="$(command -v pg_dump)"; PSQL="$(command -v psql)"
fi
echo "Werkzeuge: $("$PG_DUMP" --version)"
[[ -f package.json && -d backend ]] || { echo "FEHLER: Bitte im Repo-Wurzelverzeichnis ausfuehren." >&2; exit 1; }

# ── Verbindungszeichenfolge erfragen ────────────────────────────────────────
# Bewusst die KOMPLETTE URI statt nur des Passworts: Host und Region stehen
# darin bereits richtig. Ein frueherer Versuch, die Region zu raten, scheiterte
# mit "tenant/user not found" — das Dashboard weiss es, wir muessen nicht raten.
say "Supabase-Verbindungszeichenfolge"
cat <<'ANLEITUNG'
  Im Supabase-Dashboard holen:
      Project Settings  ->  Database  ->  Connection string
      Reiter "URI",  Modus "Session pooler"

  Sie sieht so aus:
      postgresql://postgres.<ref>:<passwort>@aws-0-<region>.pooler.supabase.com:5432/postgres

  WICHTIG — den SESSION-Pooler nehmen (Port 5432). Nicht geeignet sind:
      "Direct connection"   nur IPv6, von hier nicht erreichbar
      "Transaction pooler"  Port 6543, beherrscht kein pg_dump

  Gleich einfuegen mit RECHTSKLICK -> Paste oder Shift+Einfg.
  Strg+V funktioniert in Git-Bash NICHT. Die Eingabe bleibt unsichtbar.
ANLEITUNG
echo ""
read -rsp "  URI: " SRC_URI
echo ""
SRC_URI="$(tr -d '\r\n ' <<<"$SRC_URI")"
[[ -n "$SRC_URI" ]] || { echo "  FEHLER: leer eingegeben." >&2; exit 1; }

# Zerlegen, ohne das Passwort auszugeben
SRC_USER="$(sed -E 's|^postgres(ql)?://([^:]+):.*|\2|' <<<"$SRC_URI")"
SRC_PASS="$(sed -E 's|^postgres(ql)?://[^:]+:([^@]+)@.*|\2|' <<<"$SRC_URI")"
SRC_HOST="$(sed -E 's|.*@([^:/]+).*|\1|'                    <<<"$SRC_URI")"
SRC_PORT="$(sed -E 's|.*@[^:]+:([0-9]+).*|\1|'              <<<"$SRC_URI")"
SRC_DB="$(  sed -E 's|.*:[0-9]+/([^?]+).*|\1|'              <<<"$SRC_URI")"
[[ "$SRC_PORT" =~ ^[0-9]+$ ]] || SRC_PORT=5432
[[ -n "$SRC_DB" && "$SRC_DB" != "$SRC_URI" ]] || SRC_DB=postgres

echo "  Benutzer : $SRC_USER"
echo "  Host     : $SRC_HOST:$SRC_PORT"
echo "  Datenbank: $SRC_DB"
echo "  Passwort : ${#SRC_PASS} Zeichen"

if [[ "$SRC_PORT" == "6543" ]]; then
  echo "" >&2
  echo "  FEHLER: Port 6543 ist der Transaction-Pooler — der kann kein pg_dump." >&2
  echo "         Im Dashboard auf 'Session pooler' (Port 5432) umschalten." >&2
  exit 1
fi
if [[ "$SRC_HOST" == db.*.supabase.co ]]; then
  echo "" >&2
  echo "  FEHLER: Das ist die direkte Verbindung — nur ueber IPv6 erreichbar." >&2
  echo "         Im Dashboard auf 'Session pooler' umschalten." >&2
  exit 1
fi

# ── Erreichbarkeit ──────────────────────────────────────────────────────────
say "Netzwerk pruefen"
if timeout 12 bash -c "cat < /dev/null > /dev/tcp/$SRC_HOST/$SRC_PORT" 2>/dev/null; then
  echo "  ✓ $SRC_HOST:$SRC_PORT erreichbar"
else
  echo "  ✗ $SRC_HOST:$SRC_PORT NICHT erreichbar." >&2
  echo "    Port $SRC_PORT ist in diesem Netz gesperrt — am mobilen Hotspot erneut starten." >&2
  exit 1
fi

# ── Verbindung testen ───────────────────────────────────────────────────────
# "|| true" ist hier wichtig: mit set -o pipefail wuerde ein psql-Fehler das
# Skript still beenden, BEVOR die Meldung ausgegeben werden kann.
say "Verbindung zu Supabase testen"
export PGPASSWORD="$SRC_PASS"
src() { "$PSQL" -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" "$@"; }
SRC_VER="$(src -Atc "select version();" 2>&1 | head -1 || true)"
if [[ "$SRC_VER" != PostgreSQL* ]]; then
  echo "  ✗ Verbindung fehlgeschlagen:" >&2
  echo "    $SRC_VER" >&2
  echo "" >&2
  case "$SRC_VER" in
    *"not found"*)        echo "    -> Projekt-Referenz oder Region stimmen nicht. URI neu aus dem Dashboard kopieren." >&2 ;;
    *authentication*|*password*) echo "    -> Passwort falsch. Im Dashboard zuruecksetzen und neu kopieren." >&2 ;;
    *"no tenant identifier"*)    echo "    -> Benutzername muss 'postgres.<projekt-ref>' lauten." >&2 ;;
  esac
  exit 1
fi
echo "  ✓ ${SRC_VER:0:60}…"

# Alten Export verwerfen. Bleiben Dateien aus einem frueheren Lauf liegen,
# stehen zwei Generationen nebeneinander — und die Kontrolle am Ende
# vergleicht dann teils gegen veraltete Staende.
if [[ -d "$OUT" ]]; then
  say "Alten Export verwerfen"
  rm -rf "$OUT"
  echo "  ✓ $OUT geleert"
fi
mkdir -p "$OUT/data"

# ── Schemas ermitteln ───────────────────────────────────────────────────────
# NICHT auf "public" festlegen. Die Datenbank enthaelt z.B. ein Schema
# REPORTING mit Views, auf die Views in public per JOIN zugreifen. Ein Dump
# mit --schema=public erzeugt dann Views, die auf nichts verweisen — der
# Import bricht ab mit:
#     ERROR: relation "REPORTING.VW_PROJECT_PROGRESS_AGG" does not exist
# Deshalb: alle Schemas nehmen, die nicht zu Postgres oder Supabase gehoeren.
say "Schemas ermitteln"
mapfile -t SCHEMAS < <(src -Atc "
  SELECT nspname FROM pg_namespace
  WHERE nspname NOT LIKE 'pg\_%'
    AND nspname NOT IN ('information_schema','auth','storage','graphql',
                        'graphql_public','realtime','realtime_dev','vault',
                        'extensions','supabase_functions','supabase_migrations',
                        'pgsodium','pgsodium_masks','net','cron','_analytics',
                        '_realtime','pgbouncer')
  ORDER BY nspname" | tr -d '\r')
[[ ${#SCHEMAS[@]} -gt 0 ]] || { echo "FEHLER: keine Schemas gefunden." >&2; exit 1; }
SCHEMA_ARGS=()
for s in "${SCHEMAS[@]}"; do
  [[ -z "$s" ]] && continue
  # Die Anfuehrungszeichen sind ZWINGEND. pg_dump wertet --schema wie ein
  # psql-\d-Muster aus und faltet unquotierte Namen auf Kleinschreibung.
  # --schema=REPORTING sucht also nach "reporting" -- findet nichts, und der
  # Dump enthaelt das Schema stillschweigend nicht. Erst beim Import faellt
  # es auf, als "relation REPORTING.VW_... does not exist".
  SCHEMA_ARGS+=(--schema="\"$s\"")
  echo "  • $s"
done
printf '%s\n' "${SCHEMAS[@]}" | grep -v '^$' > "$OUT/schemas.txt"

# ── Schema exportieren ──────────────────────────────────────────────────────
# In zwei Abschnitten: erst Tabellen ohne Constraints, ganz am Ende die
# Constraints und Indizes. Dadurch spielt die Ladereihenfolge der Daten keine
# Rolle und es braucht keine Superuser-Rechte auf der Zielseite.
say "Schema exportieren"
"$PG_DUMP" -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" \
  --schema-only --section=pre-data "${SCHEMA_ARGS[@]}" \
  --no-owner --no-privileges --no-comments -f "$OUT/01_schema_pre.sql"
echo "  ✓ pre-data  ($(wc -l < "$OUT/01_schema_pre.sql") Zeilen)"

"$PG_DUMP" -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" \
  --schema-only --section=post-data "${SCHEMA_ARGS[@]}" \
  --no-owner --no-privileges --no-comments -f "$OUT/03_schema_post.sql"
echo "  ✓ post-data ($(wc -l < "$OUT/03_schema_post.sql") Zeilen)"

# Selbstpruefung: taucht wirklich jedes erkannte Schema im Dump auf?
# Ohne diese Kontrolle faellt ein stillschweigend uebergangenes Schema erst
# beim Import auf — und dann als scheinbar unzusammenhaengender Folgefehler.
FEHLEND=0
for s in "${SCHEMAS[@]}"; do
  [[ -z "$s" ]] && continue
  if grep -qE "CREATE SCHEMA (IF NOT EXISTS )?\"?$s\"?;" "$OUT/01_schema_pre.sql"; then
    echo "  ✓ Schema $s im Dump enthalten"
  else
    echo "  ✗ Schema $s FEHLT im Dump" >&2
    FEHLEND=1
  fi
done
[[ $FEHLEND -eq 0 ]] || {
  echo "" >&2
  echo "  Abbruch: mindestens ein Schema wurde nicht exportiert." >&2
  echo "  Ein Import waere unvollstaendig und wuerde erst spaeter scheitern." >&2
  exit 1
}

# ── Daten exportieren ───────────────────────────────────────────────────────
say "Daten exportieren"
: > "$OUT/02_load_data.sql"
if [[ $# -gt 0 ]]; then TENANTS="$(IFS=,; echo "$*")"; echo "  Nur Mandanten: $TENANTS"
else TENANTS=""; echo "  Alle Daten (keine Mandanten-IDs angegeben)"; fi

# tr -d '\r' ist hier zwingend: psql liefert unter Windows CRLF, und ein
# Wagenruecklauf im Tabellennamen landet sonst im Dateipfad. Der Fehler zeigt
# sich dann als "…csv: No such file or directory", weil \r den Namen ungueltig
# macht und die Terminalausgabe zusaetzlich ueberschreibt.
#
# Format je Zeile: schema|tabelle — alle Schemas, nicht nur public.
SCHEMA_LIST="$(printf "'%s'," "${SCHEMAS[@]}" | sed "s/,$//")"
mapfile -t TABLES < <(src -Atc "
  SELECT n.nspname||'|'||c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ($SCHEMA_LIST) AND c.relkind='r'
  ORDER BY n.nspname, c.relname" | tr -d '\r')
echo "  $(printf '%s\n' "${TABLES[@]}" | grep -c .) Tabellen gefunden"

# Welche Tabellen haben eine TENANT_ID? In EINER Abfrage statt einer je
# Tabelle — ueber den Pooler kostet jede Verbindung spuerbar Zeit, und am
# mobilen Hotspot zaehlt das.
mapfile -t TENANT_TABLES < <(src -Atc "
  SELECT table_schema||'|'||table_name FROM information_schema.columns
  WHERE table_schema IN ($SCHEMA_LIST) AND column_name='TENANT_ID'" | tr -d '\r')
has_tenant() { printf '%s\n' "${TENANT_TABLES[@]}" | grep -qxF "$1"; }
echo "  davon mit TENANT_ID: $(printf '%s\n' "${TENANT_TABLES[@]}" | grep -c .)"

for qual in "${TABLES[@]}"; do
  qual="${qual%$'\r'}"
  [[ -z "$qual" ]] && continue
  sch="${qual%%|*}"; tbl="${qual#*|}"
  file="${sch}__${tbl}.csv"
  if [[ -n "$TENANTS" ]] && has_tenant "$qual"; then
    WHERE="WHERE \"TENANT_ID\" IN ($TENANTS)"
  else
    WHERE=""
  fi
  src -q -c "\copy (SELECT * FROM \"$sch\".\"$tbl\" $WHERE) TO '$OUT/data/$file' WITH (FORMAT csv, HEADER)"
  printf "  %-40s %8s Zeilen\n" "$sch.$tbl" "$(( $(wc -l < "$OUT/data/$file") - 1 ))"
  echo "\\copy \"$sch\".\"$tbl\" FROM 'data/$file' WITH (FORMAT csv, HEADER)" >> "$OUT/02_load_data.sql"
done

# ── Sequenzen ───────────────────────────────────────────────────────────────
# Ohne diesen Schritt stehen alle Sequenzen nach dem Import auf 1 und der
# erste neue Datensatz kollidiert mit einer bestehenden ID.
say "Sequenz-Reset erzeugen"
src -Atc "
  SELECT format('SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 1), true);',
                quote_ident(sn.nspname)||'.'||quote_ident(s.relname), a.attname, t.relname)
  FROM pg_class s
  JOIN pg_namespace sn ON sn.oid=s.relnamespace
  JOIN pg_depend d ON d.objid=s.oid AND d.deptype IN ('a','i')
  JOIN pg_class t ON t.oid=d.refobjid
  JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
  JOIN pg_namespace tn ON tn.oid=t.relnamespace
  WHERE s.relkind='S' AND tn.nspname='public' ORDER BY t.relname" | tr -d '\r' > "$OUT/04_sequences.sql"
echo "  $(wc -l < "$OUT/04_sequences.sql") Sequenzen"
unset PGPASSWORD

say "Schema auf Supabase-Reste pruefen"
if grep -nE 'auth\.|storage\.|supabase|extensions\.|graphql' "$OUT/01_schema_pre.sql" | head -8; then
  echo "  ↑ Diese Zeilen koennen beim Import scheitern (Supabase-eigene Schemas)."
  echo "    Erwartbar bei current_tenant_id() und den RLS-Policies — beides wird"
  echo "    ohnehin durch 03_rls_postgrest.sql ersetzt."
else
  echo "  ✓ keine gefunden"
fi

# ── Tunnel zur Scalingo-Datenbank ───────────────────────────────────────────
say "Tunnel zu Scalingo oeffnen"
DB_URL="$(scalingo --app "$APP" env 2>/dev/null | grep '^SCALINGO_POSTGRESQL_URL=' | cut -d= -f2- || true)"
[[ -n "$DB_URL" ]] || { echo "FEHLER: SCALINGO_POSTGRESQL_URL nicht gefunden. Addon angelegt?" >&2; exit 1; }
DST_USER="$(sed -E 's|postgres://([^:]+):.*|\1|' <<<"$DB_URL")"
DST_PASS="$(sed -E 's|postgres://[^:]+:([^@]+)@.*|\1|' <<<"$DB_URL")"
DST_NAME="$(sed -E 's|.*/([^?]+).*|\1|' <<<"$DB_URL")"

KEY=""
for k in ~/.ssh/id_ed25519 ~/.ssh/id_rsa; do
  [[ -f "$k" ]] && { KEY="$(cygpath -w "$k" 2>/dev/null || echo "$k")"; break; }
done
[[ -n "$KEY" ]] || { echo "FEHLER: kein SSH-Schluessel in ~/.ssh gefunden." >&2; exit 1; }

scalingo --app "$APP" db-tunnel -i "$KEY" --port "$TUNNEL_PORT" SCALINGO_POSTGRESQL_URL > /tmp/tunnel.log 2>&1 &
TUNNEL_PID=$!
for i in $(seq 1 30); do sleep 1; grep -qi "You can access" /tmp/tunnel.log 2>/dev/null && break; done
grep -qi "You can access" /tmp/tunnel.log || { echo "FEHLER: Tunnel kam nicht hoch:" >&2; cat /tmp/tunnel.log >&2; exit 1; }
echo "  ✓ 127.0.0.1:$TUNNEL_PORT"

export PGPASSWORD="$DST_PASS"
dst() { "$PSQL" -h 127.0.0.1 -p "$TUNNEL_PORT" -U "$DST_USER" -d "$DST_NAME" "$@"; }

# ── Zielschemas leeren ──────────────────────────────────────────────────────
# Der Dump enthaelt "CREATE SCHEMA public". Das Schema existiert in jeder
# frischen Postgres-Datenbank bereits, der Befehl scheitert also — und mit
# ON_ERROR_STOP=1 bricht psql beim ERSTEN Fehler ab, hier schon in Zeile 26.
# Ergebnis waere eine leere Zieldatenbank ohne erkennbare Ursache.
# Deshalb: vorhandene Schemas verwerfen und den Dump sie neu anlegen lassen.
# Das macht den Import ausserdem wiederholbar.
say "Zielschemas leeren"
while read -r s; do
  [[ -z "$s" ]] && continue
  dst -Atc "DROP SCHEMA IF EXISTS \"$s\" CASCADE;" >/dev/null
  echo "  • $s verworfen"
done < "$OUT/schemas.txt"

# ── Import ──────────────────────────────────────────────────────────────────
say "Import: Tabellen";                dst -v ON_ERROR_STOP=1 -q -f "$OUT/01_schema_pre.sql"  && echo "  ✓"
say "Import: Daten"
(cd "$OUT" && "$PSQL" -h 127.0.0.1 -p "$TUNNEL_PORT" -U "$DST_USER" -d "$DST_NAME" -v ON_ERROR_STOP=1 -q -f 02_load_data.sql) && echo "  ✓"
say "Import: Constraints und Indizes"; dst -v ON_ERROR_STOP=1 -q -f "$OUT/03_schema_post.sql" && echo "  ✓"
say "Import: Sequenzen";               dst -v ON_ERROR_STOP=1 -q -f "$OUT/04_sequences.sql"   && echo "  ✓"

# ── Kontrolle ───────────────────────────────────────────────────────────────
# Quelle = exportierte CSV-Zeilen, Ziel = echtes count(*). Beides exakt,
# nicht die geschaetzten reltuples aus dem Planner.
say "Kontrolle: Zeilenzahlen"
printf "  %-40s %10s %10s\n" "TABELLE" "QUELLE" "ZIEL"
printf "  %-40s %10s %10s\n" "----------------------------------------" "----------" "----------"
ABWEICHUNG=0
for qual in "${TABLES[@]}"; do
  qual="${qual%$'\r'}"
  [[ -z "$qual" ]] && continue
  sch="${qual%%|*}"; tbl="${qual#*|}"
  SRC_N=$(( $(wc -l < "$OUT/data/${sch}__${tbl}.csv") - 1 ))
  DST_N="$(dst -Atc "SELECT count(*) FROM \"$sch\".\"$tbl\"" 2>/dev/null | tr -d '\r' || echo "?")"
  [[ -z "$DST_N" ]] && DST_N="?"
  MARK=""; [[ "$SRC_N" != "$DST_N" ]] && { MARK="  ← ABWEICHUNG"; ABWEICHUNG=1; }
  printf "  %-40s %10s %10s%s\n" "$sch.$tbl" "$SRC_N" "$DST_N" "$MARK"
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
