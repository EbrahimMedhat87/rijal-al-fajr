#!/usr/bin/env bash
# اختبار الترقية: قاعدة فيها بيانات حقيقية الشكل (0001–0005) ثم تطبيق 0006 عليها.
set -euo pipefail
cd "$(dirname "$0")"
DB=${UPGRADE_DB_NAME:-rijal_upgrade}
ADMIN_DB=${ADMIN_DB:-postgres}
P="psql -v ON_ERROR_STOP=1 -q -X"
$P -d "$ADMIN_DB" -c "drop database if exists $DB" -c "create database $DB"
$P -d "$DB" -f 00_supabase_stub.sql
for f in ../../supabase/migrations/000[1-5]*.sql; do $P -d "$DB" -f "$f"; done
$P -d "$DB" <<'SQL'
insert into auth.users (email) values ('o@x.test');
select public.bootstrap_first_owner('o@x.test','المالك','رجال الفجر',date '2025-01-01','Africa/Cairo');
insert into public.mosques (name) values ('مسجد أ'), ('مسجد ب'), ('مسجد ج');
-- أ: كل الأسماء بأرقام فريدة (تُحفظ كأرقام) | ب: أرقام مكررة (لا تُمس) | ج: بلا أرقام
insert into public.participants (name, mosque_id) select n, (select id from public.mosques where name='مسجد أ') from unnest(array['1 آدم فرج','10 أحمد محمد','٣ علي حسن']) n;
insert into public.participants (name, mosque_id) select n, (select id from public.mosques where name='مسجد ب') from unnest(array['1 كريم سعيد','1 يوسف عمر','2 طه ياسر']) n;
insert into public.participants (name, mosque_id) select n, (select id from public.mosques where name='مسجد ج') from unnest(array['حسن علي','مروان أحمد']) n;
-- حضور لآدم قبل الترقية
insert into public.attendance (campaign_id, participant_id, attendance_date, recorded_by, client_op_id)
select (select id from public.campaigns limit 1), (select id from public.participants where name='1 آدم فرج'), public.campaign_today(), (select user_id from public.profiles limit 1), gen_random_uuid();
SQL
$P -d "$DB" -f ../../supabase/migrations/0006_child_numbers_undo.sql
psql -X -q -t -A -d "$DB" <<'SQL' > /tmp/upg.txt
select m.name||'|'||p.name||'|'||p.child_no from public.participants p join public.mosques m on m.id=p.mosque_id order by m.name, p.child_no;
select 'attendance_kept:'||count(*) from public.attendance a join public.participants p on p.id=a.participant_id where p.name='آدم فرج' and a.status='valid';
SQL
cat /tmp/upg.txt
grep -q "مسجد أ|آدم فرج|1" /tmp/upg.txt
grep -q "مسجد أ|أحمد محمد|10" /tmp/upg.txt
grep -q "مسجد أ|علي حسن|3" /tmp/upg.txt
grep -q "مسجد ب|1 كريم سعيد|" /tmp/upg.txt
grep -q "مسجد ج|حسن علي|1" /tmp/upg.txt
grep -q "attendance_kept:1" /tmp/upg.txt
echo "UPGRADE OK"
