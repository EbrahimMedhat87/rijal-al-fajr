#!/usr/bin/env bash
# يشغّل اختبارات قاعدة البيانات على Postgres محلي (يحتاج psql ودور superuser).
# الاستخدام:  bash tests/db/run.sh        (يستخدم متغيرات PG* المعتادة)
set -euo pipefail
cd "$(dirname "$0")"
DB=${TEST_DB_NAME:-rijal_test}
ADMIN_DB=${ADMIN_DB:-postgres}
P="psql -v ON_ERROR_STOP=1 -q -X"

$P -d "$ADMIN_DB" -c "drop database if exists $DB" -c "create database $DB"

$P -d "$DB" -f 00_supabase_stub.sql
for f in ../../supabase/migrations/*.sql; do
  echo ">> migration: $(basename "$f")"
  $P -d "$DB" -f "$f"
done
$P -d "$DB" -f 99_helpers.sql
psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -f 10_tests.sql 2>&1 | grep -v "^$" | sed "s/^psql:[^ ]* //; s/^NOTICE:  //"

echo ">> concurrency test (جهازان في نفس اللحظة)"
bash ./20_concurrency.sh "$DB"
echo "ALL DB TESTS PASSED"
