#!/usr/bin/env bash
# =============================================================================
# 02_export.sh — Schema + ausgewaehlte Mandanten aus Supabase exportieren
#
# ANSATZ
#   Das Schema wird in drei Abschnitten gezogen (pg_dump --section):
#     pre-data   Tabellen, Typen, Sequenzen        -> zuerst einspielen
#     data       (hier NICHT genutzt — wir filtern selbst nach Mandant)
#     post-data  Constraints, Indizes, Trigger     -> ZULETZT einspielen
#
#   Dadurch werden die Daten geladen, WAEHREND es noch keine Fremdschluessel
#   gibt. Die Ladereihenfolge der Tabellen ist damit egal, und es braucht
#   keine Superuser-Rechte (session_replication_role o.ae.) auf der Zielseite.
#
# VORAUSSETZUNGEN
#   - psql und pg_dump ab Version 15 (Supabase laeuft auf 15+).
#     Pruefen mit: pg_dump --version
#   - Verbindungsstring aus Supabase: Project Settings -> Database ->
#     Connection string -> URI. Die DIREKTE Verbindung nehmen, nicht den
#     Pooler — der Pooler kann kein pg_dump.
#
# AUFRUF
#   export SRC="postgresql://postgres:PASS@db.<ref>.supabase.co:5432/postgres"
#   ./02_export.sh 1 4 7          # Mandanten-IDs, die mitkommen sollen
#
# ERGEBNIS liegt in ./export/
# =============================================================================

set -euo pipefail

if [[ -z "${SRC:-}" ]]; then
  echo "FEHLER: Umgebungsvariable SRC ist nicht gesetzt." >&2
  echo "  export SRC=\"postgresql://postgres:PASS@db.<ref>.supabase.co:5432/postgres\"" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "FEHLER: Keine Mandanten-IDs angegeben." >&2
  echo "  Aufruf: $0 <TENANT_ID> [<TENANT_ID> ...]" >&2
  echo "  Welche IDs es gibt, zeigt 01_inventory.sql, Abschnitt 8." >&2
  exit 1
fi

# IDs zu einer SQL-Liste zusammenbauen: 1,4,7
TENANTS=$(IFS=,; echo "$*")
OUT="./export"
mkdir -p "$OUT/data"

echo "============================================================"
echo " Export der Mandanten: $TENANTS"
echo " Ziel: $OUT"
echo "============================================================"

# ── 1. Schema, Teil 1: Tabellen ohne Constraints ────────────────────────────
# --no-owner / --no-privileges: die Supabase-Rollen (supabase_admin, anon,
#   authenticated, service_role) existieren bei Scalingo nicht. Ohne diese
#   Flags bricht der Restore bei jedem GRANT/OWNER TO ab.
# --schema=public: laesst die Supabase-internen Schemas (auth, storage,
#   graphql, realtime, vault) bewusst weg — die werden nicht mitgenommen.
echo ""
echo "[1/5] Schema (pre-data: Tabellen, Sequenzen, Typen) ..."
pg_dump "$SRC" \
  --schema-only --section=pre-data \
  --schema=public \
  --no-owner --no-privileges --no-comments \
  -f "$OUT/01_schema_pre.sql"

# ── 2. Schema, Teil 2: Constraints, Indizes, Trigger ────────────────────────
echo "[2/5] Schema (post-data: Constraints, Indizes, Trigger) ..."
pg_dump "$SRC" \
  --schema-only --section=post-data \
  --schema=public \
  --no-owner --no-privileges --no-comments \
  -f "$OUT/03_schema_post.sql"

# ── 3. Tabellenliste ermitteln ──────────────────────────────────────────────
# Aufgeteilt in zwei Gruppen:
#   MANDANT  — hat eine TENANT_ID-Spalte, wird gefiltert exportiert
#   GLOBAL   — keine TENANT_ID, wird VOLLSTAENDIG exportiert
#
# Die GLOBAL-Liste unbedingt durchsehen! Darin stecken sowohl echte
# Stammdaten (VAT, BILLING_TYPE, PERMISSION) als auch Tabellen, die man
# NICHT mitnehmen will (LANDING_EVENT, Logs) und Kindtabellen, die ueber
# einen Fremdschluessel am Mandanten haengen und eigentlich gefiltert
# gehoeren (z.B. OFFER_STRUCTURE ueber OFFER_ID).
echo "[3/5] Tabellen ermitteln ..."

psql "$SRC" -At -F',' -c "
  SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
    AND EXISTS (SELECT 1 FROM information_schema.columns col
                 WHERE col.table_schema='public' AND col.table_name=c.relname
                   AND col.column_name='TENANT_ID')
  ORDER BY c.relname
" > "$OUT/tabellen_mandant.txt"

psql "$SRC" -At -F',' -c "
  SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns col
                     WHERE col.table_schema='public' AND col.table_name=c.relname
                       AND col.column_name='TENANT_ID')
  ORDER BY c.relname
" > "$OUT/tabellen_global.txt"

echo "      Mandantentabellen : $(wc -l < "$OUT/tabellen_mandant.txt")"
echo "      Globale Tabellen  : $(wc -l < "$OUT/tabellen_global.txt")"

# ── 4. Daten exportieren ────────────────────────────────────────────────────
# CSV statt INSERT-Statements: deutlich schneller beim Laden und robust
# gegenueber Sonderzeichen in Freitextfeldern.
echo "[4/5] Daten exportieren ..."

: > "$OUT/02_load_data.sql"

while IFS= read -r tbl; do
  [[ -z "$tbl" ]] && continue
  echo "      [Mandant] $tbl"
  psql "$SRC" -q -c \
    "\copy (SELECT * FROM \"$tbl\" WHERE \"TENANT_ID\" IN ($TENANTS)) TO '$OUT/data/$tbl.csv' WITH (FORMAT csv, HEADER)"
  echo "\\copy \"$tbl\" FROM 'data/$tbl.csv' WITH (FORMAT csv, HEADER)" >> "$OUT/02_load_data.sql"
done < "$OUT/tabellen_mandant.txt"

while IFS= read -r tbl; do
  [[ -z "$tbl" ]] && continue
  echo "      [Global ] $tbl"
  psql "$SRC" -q -c \
    "\copy (SELECT * FROM \"$tbl\") TO '$OUT/data/$tbl.csv' WITH (FORMAT csv, HEADER)"
  echo "\\copy \"$tbl\" FROM 'data/$tbl.csv' WITH (FORMAT csv, HEADER)" >> "$OUT/02_load_data.sql"
done < "$OUT/tabellen_global.txt"

# ── 5. Sequenzen nachziehen ─────────────────────────────────────────────────
# Ohne diesen Schritt stehen alle Sequenzen nach dem Import auf 1 und der
# erste INSERT kollidiert mit bestehenden IDs. Erzeugt setval()-Aufrufe,
# die nach dem Laden ausgefuehrt werden.
echo "[5/5] Sequenz-Reset erzeugen ..."

psql "$SRC" -At -c "
  SELECT format(
    'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 1), true);',
    quote_ident(seq_ns.nspname)||'.'||quote_ident(s.relname),
    a.attname, t.relname)
  FROM pg_class s
  JOIN pg_namespace seq_ns ON seq_ns.oid = s.relnamespace
  JOIN pg_depend d   ON d.objid = s.oid AND d.deptype IN ('a','i')
  JOIN pg_class t    ON t.oid = d.refobjid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
  JOIN pg_namespace tn ON tn.oid = t.relnamespace
  WHERE s.relkind = 'S' AND tn.nspname = 'public'
  ORDER BY t.relname
" > "$OUT/04_sequences.sql"

echo ""
echo "============================================================"
echo " Fertig. Inhalt von $OUT:"
echo "   01_schema_pre.sql   Tabellen ohne Constraints"
echo "   02_load_data.sql    \\copy-Anweisungen"
echo "   03_schema_post.sql  Constraints, Indizes, Trigger"
echo "   04_sequences.sql    setval() fuer alle Sequenzen"
echo "   data/*.csv          die Nutzdaten"
echo "   tabellen_*.txt      Tabellenlisten — BITTE PRUEFEN"
echo ""
echo " NAECHSTER SCHRITT — vor dem Import zwingend:"
echo "   1. tabellen_global.txt durchsehen. Alles, was NICHT globale"
echo "      Stammdaten sind (Logs, LANDING_EVENT, fremde Kindtabellen),"
echo "      aus 02_load_data.sql entfernen."
echo "   2. 01_schema_pre.sql auf Supabase-Reste pruefen:"
echo "        grep -nE 'auth\\.|storage\\.|supabase|extensions\\.' 01_schema_pre.sql"
echo "   3. Import gegen den Scalingo-Tunnel (siehe Migrationsplan):"
echo "        psql \"\$DST\" -v ON_ERROR_STOP=1 -f 01_schema_pre.sql"
echo "        psql \"\$DST\" -v ON_ERROR_STOP=1 -f 02_load_data.sql"
echo "        psql \"\$DST\" -v ON_ERROR_STOP=1 -f 03_schema_post.sql"
echo "        psql \"\$DST\" -v ON_ERROR_STOP=1 -f 04_sequences.sql"
echo "============================================================"
