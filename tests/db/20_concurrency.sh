#!/usr/bin/env bash
# جهازان يسجّلان نفس الطفل/اليوم في نفس اللحظة تقريبًا، 20 مرة: يجب أن يبقى سجل صالح واحد لكل جولة.
set -euo pipefail
DB=${1:-rijal_test}
P="psql -X -q -t -A -v ON_ERROR_STOP=0 -d $DB"

# طفل جديد + تاريخ جديد لكل جولة (نستخدم أيام تاريخية داخل نطاق المبادرة، بصلاحية admin)
$P -c "select t.logout();" >/dev/null
$P -c "
  insert into public.participants (name) values ('اختبار التزامن');
" >/dev/null

PID=$($P -c "select id from public.participants where name='اختبار التزامن'")
ADMIN=$($P -c "select t.uid('admin@x.test')")
OWNER=$($P -c "select t.uid('owner@x.test')")

for i in $(seq 1 20); do
  D=$(date -d "2025-03-01 +$i day" +%F)
  ( $P -c "select t.login('$ADMIN'); select public.record_attendance(gen_random_uuid(), '$PID', date '$D');" >/dev/null 2>&1 ) &
  ( $P -c "select t.login('$OWNER'); select public.record_attendance(gen_random_uuid(), '$PID', date '$D');" >/dev/null 2>&1 ) &
  wait
done

TOTAL=$($P -c "select count(*) from public.attendance where participant_id='$PID' and status='valid'")
DAYS=$($P -c "select count(distinct attendance_date) from public.attendance where participant_id='$PID' and status='valid'")
echo "valid rows=$TOTAL distinct days=$DAYS (expected 20/20)"
[ "$TOTAL" = "20" ] && [ "$DAYS" = "20" ]
