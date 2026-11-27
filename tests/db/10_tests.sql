\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ===========================================================================
-- تجهيز: مستخدمو Auth (كأنهم أُنشئوا من لوحة Supabase)
-- ===========================================================================
insert into auth.users (email) values
  ('owner@x.test'), ('admin@x.test'), ('rec1@x.test'), ('rec2@x.test'), ('stranger@x.test'), ('admin2@x.test'), ('nomosque@x.test');

-- ---------------------------------------------------------------------------
-- 1) Bootstrap: أول Owner فقط، مرة واحدة، ومن خارج التطبيق
-- ---------------------------------------------------------------------------
select t.login(t.uid('owner@x.test'));
select t.expect_err($$select public.bootstrap_first_owner('owner@x.test','Owner')$$,
  'permission denied', 'bootstrap_first_owner غير متاح لمستخدم التطبيق');
select t.logout();

select t.login_anon();
select t.expect_err($$select public.bootstrap_first_owner('owner@x.test','Owner')$$,
  'permission denied', 'bootstrap_first_owner غير متاح لـ anon');
select t.expect_err($$select * from public.participants$$,
  'permission denied', 'anon لا يقرأ الأطفال');
select t.expect_err($$select * from public.attendance$$,
  'permission denied', 'anon لا يقرأ الحضور');
select t.logout();

select public.bootstrap_first_owner('owner@x.test', 'المالك', 'رجال الفجر', date '2025-01-01', 'Africa/Cairo');
select t.expect_err($$select public.bootstrap_first_owner('admin@x.test','X')$$,
  'ERR_ALREADY_BOOTSTRAPPED', 'bootstrap لا يعمل مرتين');
select t.expect((select count(*) from public.profiles where role='owner') = 1, 'يوجد Owner واحد بعد الـ bootstrap');
select t.expect((select count(*) from public.campaigns where status='active') = 1, 'تم إنشاء مبادرة نشطة');

-- ---------------------------------------------------------------------------
-- 2) إدارة المنظمين: Owner فقط
-- ---------------------------------------------------------------------------
select t.login(t.uid('owner@x.test'));
select public.owner_upsert_user('admin@x.test', 'المشرف', 'admin');
select public.owner_upsert_user('rec1@x.test',  'مسجل 1', 'recorder');
select public.owner_upsert_user('REC2@x.test',  'مسجل 2', 'recorder');   -- البريد غير حساس لحالة الأحرف
select t.expect_err($$select public.owner_upsert_user('nobody@x.test','س','recorder')$$,
  'ERR_AUTH_USER_NOT_FOUND', 'لا يمكن ربط بريد غير موجود في Auth (لا تسجيل عام)');
select t.expect_err($$select public.owner_upsert_user('rec1@x.test','س','superuser')$$,
  'ERR_INVALID_ROLE', 'دور غير صالح مرفوض');
select t.expect((select count(*) from public.owner_list_users()) = 4, 'owner_list_users يرجع 4 منظمين');
-- المساجد: المالك ينشئها ويربط المنظمين
insert into public.mosques (name) values ('المسجد الكبير'), ('مسجد الرحمة');
create temp table mq as select
  (select id from public.mosques where name = 'المسجد الكبير') as ma,
  (select id from public.mosques where name = 'مسجد الرحمة')  as mb;
grant select on mq to authenticated;
select public.owner_set_user_mosques(t.uid('admin@x.test'), array[(select ma from mq)]);
select public.owner_set_user_mosques(t.uid('rec1@x.test'),  array[(select ma from mq)]);
select public.owner_set_user_mosques(t.uid('rec2@x.test'),  array[(select ma from mq)]);
select t.logout();

select t.login(t.uid('admin@x.test'));
select t.expect_err($$select public.owner_upsert_user('rec1@x.test','س','admin')$$,
  'ERR_NOT_AUTHORIZED', 'Admin لا يدير المستخدمين');
select t.expect_err($$select * from public.owner_list_users()$$,
  'ERR_NOT_AUTHORIZED', 'Admin لا يرى قائمة المستخدمين الكاملة');
select t.expect_err($$select public.owner_update_campaign('س', date '2025-01-01', 'Africa/Cairo')$$,
  'ERR_NOT_AUTHORIZED', 'Admin لا يغيّر إعدادات المبادرة');
select t.logout();

select t.login(t.uid('rec1@x.test'));
select t.expect_err($$select public.owner_upsert_user('rec2@x.test','س','admin')$$,
  'ERR_NOT_AUTHORIZED', 'Recorder لا يرفع صلاحيات أحد');
select t.expect_err($$update public.profiles set role='owner' where user_id = auth.uid()$$,
  'permission denied', 'Recorder لا يعدّل جدول profiles مباشرة');
select t.expect_err($$update public.campaigns set name='x'$$,
  'permission denied', 'Recorder لا يعدّل campaigns مباشرة');
select t.logout();

-- ---------------------------------------------------------------------------
-- 3) الأطفال: Admin/Owner يديرون، Recorder يقرأ فقط، الغريب لا يرى شيئًا
-- ---------------------------------------------------------------------------
select t.login(t.uid('admin@x.test'));
insert into public.participants (name, mosque_id) select n, (select ma from mq) from unnest(array['أحمد','محمد','يوسف','عمر','خالد']) n;
select t.expect((select count(*) from public.participants) = 5, 'Admin أضاف 5 أطفال');
select t.expect((select created_by from public.participants where name='أحمد') = auth.uid(), 'created_by يُملأ تلقائيًا');
select t.expect_err($$insert into public.participants (name, mosque_id) values ('   ', (select ma from mq))$$,
  'violates check constraint', 'اسم فارغ مرفوض');
select t.expect_err($$update public.participants set created_by = null where name='أحمد'$$,
  'permission denied', 'لا يمكن تعديل created_by');
select t.expect_err($$delete from public.participants where name='خالد'$$,
  'permission denied', 'لا حذف للأطفال (الإيقاف بدل الحذف)');
select t.logout();

select t.login(t.uid('rec1@x.test'));
select t.expect((select count(*) from public.participants) = 5, 'Recorder يرى قائمة الأطفال');
select t.expect_err($$insert into public.participants (name, mosque_id) values ('ممنوع', (select ma from mq))$$,
  'row-level security', 'Recorder لا يضيف أطفالًا');
do $$ declare n int; begin
  update public.participants set name = 'x';
  get diagnostics n = row_count;
  perform t.expect(n = 0, 'Recorder لا يعدّل الأطفال (RLS يخفي الصفوف)');
end $$;
select t.logout();

select t.login(t.uid('stranger@x.test'));   -- مستخدم Auth بدون profile
select t.expect((select count(*) from public.participants) = 0, 'الغريب (بدون profile) لا يرى أي طفل');
select t.expect((select count(*) from public.attendance) = 0, 'الغريب لا يرى أي حضور');
select t.expect((select count(*) from public.campaigns) = 0, 'الغريب لا يرى الإعدادات');
select t.expect_err($$select public.record_attendance(gen_random_uuid(), (select id from public.participants limit 1), current_date)$$,
  'ERR_NOT_AUTHORIZED', 'الغريب لا يسجّل حضورًا');
select t.expect_err($$insert into public.participants (name, mosque_id) values ('ممنوع', (select ma from mq))$$,
  'row-level security', 'الغريب لا يضيف أطفالًا');
select t.logout();

-- ---------------------------------------------------------------------------
-- 4) تسجيل الحضور: idempotency + منع التكرار + جهازان
-- ---------------------------------------------------------------------------
create temp table ctx as
select
  (now() at time zone 'Africa/Cairo')::date as today,
  (select id from public.participants where name='أحمد')  as ahmed,
  (select id from public.participants where name='محمد')  as mohamed,
  (select id from public.participants where name='يوسف')  as yousef,
  (select id from public.participants where name='عمر')   as omar,
  (select id from public.participants where name='خالد')  as khaled;
grant select on ctx to authenticated;

select t.login(t.uid('rec1@x.test'));
create temp table r1 as select public.record_attendance('00000000-0000-0000-0000-0000000000a1', ahmed, today, now()) as res from ctx;
select t.expect((select res->>'status' from r1) = 'created', 'تسجيل أول مرة => created');

select t.expect((select public.record_attendance('00000000-0000-0000-0000-0000000000a1', ahmed, today, now())->>'status' from ctx) = 'already_synced',
  'إعادة إرسال نفس العملية => already_synced (آمن)');
select t.logout();

select t.login(t.uid('rec2@x.test'));   -- جهاز آخر، عملية مختلفة، نفس الطفل واليوم
select t.expect((select public.record_attendance('00000000-0000-0000-0000-0000000000b1', ahmed, today, now())->>'status' from ctx) = 'already_recorded',
  'جهاز ثانٍ لنفس الطفل واليوم => already_recorded');
select t.logout();

select t.expect((select count(*) from public.attendance a, ctx where a.participant_id = ctx.ahmed and a.attendance_date = ctx.today and a.status='valid') = 1,
  'سجل صالح واحد فقط للطفل في اليوم');
select t.expect((select count(*) from public.attendance a, ctx where a.client_op_id = '00000000-0000-0000-0000-0000000000b1') = 0,
  'العملية المكررة لم تُخزَّن كسجل ثانٍ');
select t.expect((select recorded_by from public.attendance a, ctx where a.participant_id = ctx.ahmed and a.attendance_date = ctx.today) = t.uid('rec1@x.test'),
  'recorded_by = أول من سجّل');

-- القيد على مستوى قاعدة البيانات (حتى لو تجاوزنا الدالة)
select t.expect_err($$insert into public.attendance (campaign_id, participant_id, attendance_date, recorded_by, client_op_id)
  select c.id, ctx.ahmed, ctx.today, t.uid('rec1@x.test'), gen_random_uuid() from public.campaigns c, ctx$$,
  'attendance_one_valid_per_day', 'القيد الفريد يمنع التكرار حتى بإدخال مباشر (superuser)');

-- لا كتابة مباشرة من المستخدمين
select t.login(t.uid('admin@x.test'));
select t.expect_err($$insert into public.attendance (campaign_id, participant_id, attendance_date, recorded_by, client_op_id)
  select c.id, ctx.omar, ctx.today, auth.uid(), gen_random_uuid() from public.campaigns c, ctx$$,
  'permission denied', 'Admin لا يُدخل حضورًا مباشرة (فقط عبر الدالة)');
select t.expect_err($$update public.attendance set status='void'$$,
  'permission denied', 'لا تعديل مباشر للحضور');
select t.expect_err($$delete from public.attendance$$,
  'permission denied', 'لا حذف مباشر للحضور');
select t.logout();
select t.expect_err($$delete from public.attendance$$,
  'ERR_ATTENDANCE_NO_DELETE', 'حتى superuser لا يحذف الحضور (trigger)');

-- ---------------------------------------------------------------------------
-- 5) قواعد التواريخ والأدوار
-- ---------------------------------------------------------------------------
select t.login(t.uid('rec1@x.test'));
select t.expect_err($$select public.record_attendance(gen_random_uuid(), mohamed, today + 1) from ctx$$,
  'ERR_DATE_IN_FUTURE', 'تاريخ مستقبلي مرفوض');
select t.expect_err($$select public.record_attendance(gen_random_uuid(), (select mohamed from ctx), date '2024-12-31')$$,
  'ERR_BEFORE_CAMPAIGN_START', 'تاريخ قبل بداية المبادرة مرفوض');
select t.expect_err($$select public.record_attendance(gen_random_uuid(), mohamed, today - 2) from ctx$$,
  'ERR_DATE_NOT_ALLOWED', 'Recorder لا يسجّل لأكثر من أمس');
select t.expect((select public.record_attendance(gen_random_uuid(), mohamed, today - 1)->>'status' from ctx) = 'created',
  'Recorder يسجّل لأمس (مزامنة متأخرة)');
select t.expect_err($$select public.record_attendance(gen_random_uuid(), gen_random_uuid(), (select today from ctx))$$,
  'ERR_PARTICIPANT_NOT_FOUND', 'طفل غير موجود مرفوض');
select t.logout();

select t.login(t.uid('admin@x.test'));
select t.expect((select public.record_attendance(gen_random_uuid(), yousef, today - 10)->>'status' from ctx) = 'created',
  'Admin يسجّل لتاريخ سابق');
select t.logout();

-- ---------------------------------------------------------------------------
-- 6) الإبطال والتدقيق
-- ---------------------------------------------------------------------------
select t.login(t.uid('rec1@x.test'));
select t.expect_err($$select public.void_attendance((select a.id from public.attendance a limit 1), 'سبب')$$,
  'ERR_NOT_AUTHORIZED', 'Recorder لا يُبطل سجلات');
select t.expect((select count(*) from public.audit_log) = 0, 'Recorder لا يقرأ سجل التدقيق');
select t.logout();

select t.login(t.uid('admin@x.test'));
create temp table v as select a.id from public.attendance a, ctx where a.participant_id = ctx.ahmed and a.attendance_date = ctx.today;
grant select on v to authenticated;
select t.expect_err($$select public.void_attendance((select id from v), '   ')$$,
  'ERR_REASON_REQUIRED', 'الإبطال بدون سبب مرفوض');
select t.expect_err($$select public.void_attendance((select id from v), null)$$,
  'ERR_REASON_REQUIRED', 'الإبطال بسبب null مرفوض');
select t.expect((select public.void_attendance((select id from v), 'تسجيل بالخطأ')->>'status') = 'voided', 'Admin يُبطل بسبب');
select t.expect_err($$select public.void_attendance((select id from v), 'مرة ثانية')$$,
  'ERR_ATTENDANCE_ALREADY_VOID', 'لا إبطال مرتين');
select t.expect((select count(*) from public.audit_log where action='attendance.void' and details->>'reason'='تسجيل بالخطأ') = 1,
  'تم تسجيل الإبطال في audit_log مع السبب');
select t.expect((select actor_id from public.audit_log where action='attendance.void') = auth.uid(), 'audit_log يحفظ من قام بالإبطال');
select t.expect((select count(*) from public.attendance a, ctx where a.participant_id = ctx.ahmed and a.attendance_date = ctx.today and a.status='valid') = 0,
  'بعد الإبطال لا يوجد سجل صالح');
-- بعد الإبطال يمكن تسجيل الحضور من جديد (التصحيح)
select t.expect((select public.record_attendance(gen_random_uuid(), ahmed, today)->>'status' from ctx) = 'created',
  'بعد الإبطال يمكن إعادة التسجيل الصحيح');
select t.expect((select count(*) from public.attendance a, ctx where a.participant_id = ctx.ahmed and a.attendance_date = ctx.today) = 2,
  'السجل الملغي محفوظ في التاريخ (لم يُحذف)');
select t.expect_err($$update public.attendance set status = 'valid' where id = (select id from v)$$,
  'permission denied', 'لا يمكن إعادة تفعيل سجل ملغي مباشرة');
select t.logout();
select t.expect_err($$update public.attendance set status='valid', void_reason=null, voided_by=null, voided_at=null where id = (select id from v)$$,
  'ERR_ATTENDANCE_ALREADY_VOID', 'حتى superuser لا يعيد تفعيل سجل ملغي');
select t.expect_err($$update public.attendance set attendance_date = attendance_date - 1 where status='valid'$$,
  'ERR_ATTENDANCE_IMMUTABLE', 'حقول الحضور الأساسية غير قابلة للتعديل');

-- ---------------------------------------------------------------------------
-- 7) إيقاف الطفل يحفظ التاريخ
-- ---------------------------------------------------------------------------
select t.login(t.uid('admin@x.test'));
update public.participants set active = false where name = 'يوسف';
select t.expect((select count(*) from public.attendance a, ctx where a.participant_id = ctx.yousef) = 1,
  'إيقاف الطفل لم يمسح حضوره');
select t.expect((select count(*) from public.audit_log where action='participants.update' and details ? 'active') >= 1,
  'تغيير الحالة سُجِّل في audit_log');
select t.logout();
select t.expect_err($$delete from public.participants where name='يوسف'$$,
  'violates foreign key', 'لا يمكن حذف طفل له سجل حضور (FK)');

-- ---------------------------------------------------------------------------
-- 8) المستخدم الموقوف
-- ---------------------------------------------------------------------------
select t.login(t.uid('owner@x.test'));
select public.owner_upsert_user('rec2@x.test', 'مسجل 2', 'recorder', false);
select t.logout();
select t.login(t.uid('rec2@x.test'));
select t.expect((select count(*) from public.participants) = 0, 'المنظم الموقوف لا يرى الأطفال');
select t.expect_err($$select public.record_attendance(gen_random_uuid(), (select ahmed from ctx), (select today from ctx))$$,
  'ERR_NOT_AUTHORIZED', 'المنظم الموقوف لا يسجّل');
select t.logout();
select t.login(t.uid('owner@x.test'));
select public.owner_upsert_user('rec2@x.test', 'مسجل 2', 'recorder', true);
select t.logout();

-- ---------------------------------------------------------------------------
-- 9) حارس آخر Owner
-- ---------------------------------------------------------------------------
select t.login(t.uid('owner@x.test'));
select t.expect_err($$select public.owner_upsert_user('owner@x.test','المالك','admin')$$,
  'ERR_LAST_OWNER', 'لا يمكن خفض آخر Owner');
select t.expect_err($$select public.owner_upsert_user('owner@x.test','المالك','owner', false)$$,
  'ERR_LAST_OWNER', 'لا يمكن إيقاف آخر Owner');
select public.owner_upsert_user('admin@x.test', 'المشرف', 'owner');         -- owner ثانٍ
select public.owner_upsert_user('owner@x.test', 'المالك', 'admin');         -- الآن يجوز خفضه
select t.expect_err($$select public.owner_upsert_user('rec1@x.test','مسجل 1','admin')$$,
  'ERR_NOT_AUTHORIZED', 'بعد خفضه لم يعد يملك صلاحيات Owner');
select t.logout();
-- الـ Owner الجديد (كان admin) يعيد الأدوار كما كانت
select t.login(t.uid('admin@x.test'));
select public.owner_upsert_user('owner@x.test', 'المالك', 'owner');
select public.owner_upsert_user('admin@x.test', 'المشرف', 'admin');
select t.expect((select role from public.profiles where user_id = t.uid('owner@x.test')) = 'owner', 'الأدوار أُعيدت كما كانت');
select t.logout();

-- ---------------------------------------------------------------------------
-- 10) إعدادات المبادرة
-- ---------------------------------------------------------------------------
select t.login(t.uid('owner@x.test'));
select t.expect_err($$select public.owner_update_campaign('رجال الفجر', date '2025-01-01', 'Mars/Olympus')$$,
  'not recognized', 'منطقة زمنية غير صحيحة مرفوضة');
select t.expect_err($$select public.owner_update_campaign('رجال الفجر', (select today from ctx), 'Africa/Cairo')$$,
  'ERR_START_DATE_AFTER_ATTENDANCE', 'لا يمكن تأخير تاريخ البداية بعد سجلات موجودة');
select public.owner_update_campaign('رجال الفجر', date '2025-01-01', 'Africa/Cairo');
select t.expect((select count(*) from public.audit_log where entity='campaigns') >= 1, 'إنشاء/تعديل الإعدادات مُدقَّق');
select t.logout();

-- ---------------------------------------------------------------------------
-- 11) عدّادات الترتيب عبر حدود الشهر والربع والسنة
--     (بيانات ثابتة بتواريخ تاريخية؛ تُدخَل عبر الدالة كـ Admin)
-- ---------------------------------------------------------------------------
select t.login(t.uid('admin@x.test'));
-- عمر: 2025-12-31 و 2026-01-01 و 2026-01-31 و 2026-02-01
select public.record_attendance(gen_random_uuid(), omar, d::date) from ctx,
  unnest(array['2025-12-31','2026-01-01','2026-01-31','2026-02-01']) d;
-- خالد: 2026-03-31 و 2026-04-01 و 2026-06-30 و 2026-07-01
select public.record_attendance(gen_random_uuid(), khaled, d::date) from ctx,
  unnest(array['2026-03-31','2026-04-01','2026-06-30','2026-07-01']) d;

create or replace function pg_temp.days(p_from date, p_to date, p_name text) returns bigint language sql as $$
  select days from public.attendance_counts(p_from, p_to) where name = p_name
$$;

select t.expect(pg_temp.days('2026-01-01','2026-01-31','عمر') = 2, 'يناير: عمر = 2 (يشمل 1 و 31)');
select t.expect(pg_temp.days('2025-12-01','2025-12-31','عمر') = 1, 'ديسمبر 2025: عمر = 1 (حد السنة)');
select t.expect(pg_temp.days('2026-02-01','2026-02-28','عمر') = 1, 'فبراير: عمر = 1');
select t.expect(pg_temp.days('2026-01-01','2026-03-31','عمر') = 3, 'الربع الأول 2026: عمر = 3');
select t.expect(pg_temp.days('2026-01-01','2026-03-31','خالد') = 1, 'الربع الأول: خالد = 1 (31 مارس)');
select t.expect(pg_temp.days('2026-04-01','2026-06-30','خالد') = 2, 'الربع الثاني: خالد = 2 (1 أبريل و30 يونيو)');
select t.expect(pg_temp.days('2026-07-01','2026-09-30','خالد') = 1, 'الربع الثالث: خالد = 1 (1 يوليو)');
select t.expect(pg_temp.days('2025-01-01','2099-12-31','خالد') = 4, 'كل الوقت: خالد = 4');
select t.expect(pg_temp.days('2025-01-01','2099-12-31','عمر') = 4, 'كل الوقت: عمر = 4');
-- طفل نشط بدون حضور في الفترة يظهر بصفر
select t.expect(pg_temp.days('2026-01-01','2026-01-31','محمد') = 0, 'طفل نشط بدون حضور يظهر بصفر');
-- طفل موقوف: يظهر فقط لو له حضور في الفترة
select t.expect(pg_temp.days('2025-01-01','2099-12-31','يوسف') = 1, 'الموقوف يظهر في الفترة التي حضر فيها');
select t.expect((select count(*) from public.attendance_counts('2026-01-01','2026-01-31') where name='يوسف') = 0,
  'الموقوف لا يظهر في فترة لا حضور له فيها');
-- السجلات الملغاة لا تُحسب: أحمد له سجل ملغي + سجل صالح اليوم
select t.expect((select days from public.attendance_counts((select today from ctx),(select today from ctx)) where name='أحمد') = 1,
  'السجل الملغي لا يُحسب في العدّاد');
select t.logout();

select t.login(t.uid('rec1@x.test'));
select t.expect_err($$select * from public.attendance_counts('2025-01-01','2099-12-31')$$,
  'ERR_NOT_AUTHORIZED', 'Recorder لا يصل إلى العدّادات/الترتيب');
-- Recorder يرى حضور اليوم وأمس فقط؛ السجلات التاريخية مخفية عنه في الجدول نفسه
select t.expect((select count(*) from public.attendance where attendance_date < (select today from ctx) - 1) = 0,
  'Recorder لا يرى سجلات أقدم من أمس');
select t.expect((select count(*) from public.attendance where attendance_date >= (select today from ctx) - 1) >= 1,
  'Recorder يرى حضور اليوم/أمس');
select t.logout();
select t.expect((select count(*) from public.attendance where attendance_date < (select today from ctx) - 1) >= 8,
  'السجلات التاريخية موجودة فعلًا (Admin يراها)');
select t.login(t.uid('admin@x.test'));
select t.expect((select count(*) from public.attendance where attendance_date < (select today from ctx) - 1) >= 8,
  'Admin يرى كل السجلات التاريخية');
select t.logout();
select t.login(t.uid('stranger@x.test'));
select t.expect_err($$select * from public.attendance_counts('2025-01-01','2099-12-31')$$,
  'ERR_NOT_AUTHORIZED', 'الغريب لا يصل إلى العدّادات');
select t.logout();


-- ---------------------------------------------------------------------------
-- 12) المساجد: العزل بين المساجد
-- ---------------------------------------------------------------------------
select t.login(t.uid('owner@x.test'));
insert into public.participants (name, mosque_id) values ('بلال', (select mb from mq));
select public.owner_upsert_user('admin2@x.test',   'مشرف الرحمة', 'admin');
select public.owner_upsert_user('nomosque@x.test', 'بلا مسجد',    'admin');
select public.owner_set_user_mosques(t.uid('admin2@x.test'), array[(select mb from mq)]);
select t.expect((select count(*) from public.participants) = 6, 'المالك يرى أطفال كل المساجد');
select t.expect((select count(*) from public.user_mosques) = 4, 'المالك يرى كل روابط المنظمين بالمساجد');
select t.expect_err($$select public.owner_set_user_mosques(t.uid('admin2@x.test'), array[gen_random_uuid()])$$,
  'ERR_MOSQUE_NOT_FOUND', 'ربط بمسجد غير موجود مرفوض');
select t.expect_err($$insert into public.mosques (name) values ('  المسجد الكبير ')$$,
  'duplicate key', 'اسم مسجد مكرر مرفوض');
select t.expect((select public.record_attendance(gen_random_uuid(), (select id from public.participants where name = 'بلال'), (select today from ctx))->>'status') = 'created',
  'المالك يسجّل حضورًا في أي مسجد');
select t.expect((select array_length(mosque_ids, 1) from public.owner_list_users() where display_name = 'مشرف الرحمة') = 1,
  'owner_list_users يعرض مساجد كل منظم');
select t.logout();

create temp table bilal  as select id from public.participants where name = 'بلال';
create temp table anyatt as
  select a.id from public.attendance a join public.participants p on p.id = a.participant_id
   where p.mosque_id = (select ma from mq) and a.status = 'valid' limit 1;
grant select on bilal, anyatt to authenticated;

-- مشرف مسجد الرحمة فقط
select t.login(t.uid('admin2@x.test'));
select t.expect((select count(*) from public.participants) = 1, 'مشرف مسجد الرحمة يرى أطفال مسجده فقط');
select t.expect((select count(*) from public.attendance) = 1, 'لا يرى حضور أطفال المساجد الأخرى');
select t.expect_err($$select public.record_attendance(gen_random_uuid(), (select ahmed from ctx), (select today from ctx))$$,
  'ERR_MOSQUE_NOT_ALLOWED', 'لا يسجّل حضورًا لطفل من مسجد آخر');
select t.expect_err($$insert into public.participants (name, mosque_id) values ('تسلل', (select ma from mq))$$,
  'row-level security', 'لا يضيف طفلًا لمسجد آخر');
insert into public.participants (name, mosque_id) values ('عمار', (select mb from mq));
select t.expect((select count(*) from public.participants) = 2, 'يضيف أطفالًا لمسجده');
select t.expect_err($$update public.participants set mosque_id = (select ma from mq) where name = 'عمار'$$,
  'row-level security', 'لا ينقل طفلًا إلى مسجد آخر');
select t.expect_err($$select public.void_attendance((select id from anyatt), 'سبب')$$,
  'ERR_MOSQUE_NOT_ALLOWED', 'لا يُبطل حضور مسجد آخر');
select t.expect_err($$select public.owner_set_user_mosques(t.uid('admin2@x.test'), array[(select ma from mq)])$$,
  'ERR_NOT_AUTHORIZED', 'المشرف لا يغيّر ربط المساجد');
-- قرار المالك: المشرف يرى الترتيب العام للأطفال والمساجد
select t.expect((select count(*) from public.attendance_counts('2025-01-01', '2099-12-31')) = 7,
  'المشرف يرى ترتيب الأطفال في كل المساجد');
select t.expect((select count(*) from public.attendance_counts('2025-01-01', '2099-12-31', (select mb from mq))) = 2,
  'فلتر المسجد في الترتيب يعمل');
select t.expect((select count(*) from public.mosque_ranking('2025-01-01', '2099-12-31')) = 2, 'ترتيب المساجد يرجع المسجدين');
select t.expect((select total_days from public.mosque_ranking('2025-01-01', '2099-12-31') where name = 'مسجد الرحمة') = 1,
  'إجمالي أيام مسجد الرحمة = 1');
select t.expect((select children from public.mosque_ranking('2025-01-01', '2099-12-31') where name = 'مسجد الرحمة') = 2,
  'عدد أطفال مسجد الرحمة = 2');
select t.expect((select avg_days from public.mosque_ranking('2025-01-01', '2099-12-31') where name = 'مسجد الرحمة') = 0.50,
  'متوسط مسجد الرحمة = 0.50 (يوم واحد ÷ طفلين)');
select t.expect((select total_days from public.mosque_ranking('2025-01-01', '2099-12-31') where name = 'المسجد الكبير') > 1,
  'مسجد الكبير له أيام حضور أكثر');
select t.logout();

-- مشرف بلا أي مسجد
select t.login(t.uid('nomosque@x.test'));
select t.expect((select count(*) from public.participants) = 0, 'مشرف بلا مسجد لا يرى أحدًا');
select t.expect((select count(*) from public.attendance) = 0, 'مشرف بلا مسجد لا يرى حضورًا');
select t.expect_err($$select public.record_attendance(gen_random_uuid(), (select ahmed from ctx), (select today from ctx))$$,
  'ERR_MOSQUE_NOT_ALLOWED', 'مشرف بلا مسجد لا يسجّل');
select t.expect_err($$insert into public.participants (name, mosque_id) values ('x', (select ma from mq))$$,
  'row-level security', 'مشرف بلا مسجد لا يضيف أطفالًا');
select t.logout();

-- مسجِّل في المسجد الكبير
select t.login(t.uid('rec1@x.test'));
select t.expect((select count(*) from public.participants) = 5, 'المسجِّل يرى أطفال مسجده فقط');
select t.expect_err($$select public.record_attendance(gen_random_uuid(), (select id from bilal), (select today from ctx))$$,
  'ERR_MOSQUE_NOT_ALLOWED', 'المسجِّل لا يسجّل لطفل من مسجد آخر');
select t.expect_err($$select * from public.mosque_ranking('2025-01-01', '2099-12-31')$$,
  'ERR_NOT_AUTHORIZED', 'المسجِّل لا يرى ترتيب المساجد');
select t.expect((select count(*) from public.user_mosques) = 1, 'المسجِّل يرى ربطه هو فقط');
select t.expect((select count(*) from public.mosques) = 2, 'المسجِّل يقرأ أسماء المساجد');
select t.logout();

-- مشرف المسجد الكبير يرى الترتيب العام أيضًا لكن لا يكتب في مسجد الرحمة
select t.login(t.uid('admin@x.test'));
select t.expect((select count(*) from public.participants) = 5, 'مشرف المسجد الكبير يرى أطفال مسجده فقط');
select t.expect((select count(*) from public.attendance_counts('2025-01-01', '2099-12-31')) = 7, 'يرى ترتيب الأطفال العام');
select t.expect_err($$select public.record_attendance(gen_random_uuid(), (select id from bilal), (select today from ctx))$$,
  'ERR_MOSQUE_NOT_ALLOWED', 'لا يسجّل لمسجد الرحمة');
select t.expect_err($$update public.participants set mosque_id = (select mb from mq) where name = 'أحمد'$$,
  'row-level security', 'لا ينقل طفلًا إلى مسجد غير مربوط به');
select t.logout();

-- مسجد موقوف
select t.login(t.uid('owner@x.test'));
update public.mosques set active = false where id = (select mb from mq);
select t.expect((select count(*) from public.mosque_ranking('2025-01-01', '2099-12-31')) = 1, 'المسجد الموقوف يخرج من ترتيب المساجد');
select t.logout();
select t.login(t.uid('admin2@x.test'));
select t.expect_err($$insert into public.participants (name, mosque_id) values ('جديد', (select mb from mq))$$,
  'row-level security', 'لا إضافة أطفال لمسجد موقوف');
select t.expect((select count(*) from public.participants) = 2, 'أطفال المسجد الموقوف يبقون ظاهرين');
select t.logout();
select t.expect_err($$delete from public.mosques where id = (select mb from mq)$$,
  'violates foreign key', 'لا يُحذف مسجد فيه أطفال');
select t.login(t.uid('owner@x.test'));
update public.mosques set active = true where id = (select mb from mq);
select t.logout();

-- ---------------------------------------------------------------------------
-- 13) طلبات التسجيل الذاتي
-- ---------------------------------------------------------------------------
insert into auth.users (email, raw_user_meta_data)
  values ('new1@x.test', '{"full_name":"  أحمد الإداري ","requested_mosque":"مسجد البحري"}'),
         ('new2@x.test', '{}'),
         ('new3@x.test', '{}');

select t.login(t.uid('new1@x.test'));
select t.expect((select count(*) from public.participants) = 0, 'حساب جديد بلا موافقة لا يرى أطفالًا');
select t.expect((select count(*) from public.mosques) = 0, 'حساب جديد بلا موافقة لا يرى مساجد');
select t.expect((select count(*) from public.attendance) = 0, 'حساب جديد بلا موافقة لا يرى حضورًا');
select t.expect_err($$select * from public.owner_list_pending_users()$$, 'ERR_NOT_AUTHORIZED', 'غير المالك لا يرى الطلبات');
select t.expect_err($$select public.owner_reject_signup(t.uid('new2@x.test'))$$, 'ERR_NOT_AUTHORIZED', 'غير المالك لا يرفض طلبات');
select t.expect_err($$insert into public.profiles (user_id, display_name, role) values (t.uid('new1@x.test'), 'x', 'owner')$$,
  'permission denied', 'لا يمنح نفسه دورًا');
select t.logout();

select t.login(t.uid('owner@x.test'));
select t.expect((select count(*) from public.owner_list_pending_users() where email like 'new%') = 3, 'المالك يرى 3 طلبات معلقة');
select t.expect((select count(*) from public.owner_list_pending_users() where email = 'stranger@x.test') = 1, 'أي حساب بلا ملف يظهر كطلب');
select t.expect((select full_name from public.owner_list_pending_users() where email = 'new1@x.test') = 'أحمد الإداري', 'الاسم المُدخل يظهر منظفًا');
select t.expect((select requested_mosque from public.owner_list_pending_users() where email = 'new1@x.test') = 'مسجد البحري', 'المسجد المطلوب يظهر');
select t.expect((select full_name from public.owner_list_pending_users() where email = 'new2@x.test') is null, 'بلا بيانات إضافية = null');
select public.owner_upsert_user('new1@x.test', 'أحمد الإداري', 'admin');
select t.expect((select count(*) from public.owner_list_pending_users() where email like 'new%') = 2, 'الموافق عليه يخرج من الطلبات');
select t.expect_err($$select public.owner_reject_signup(t.uid('new1@x.test'))$$, 'ERR_INVALID_INPUT', 'لا يُحذف منظم معتمد برفض الطلب');
select public.owner_reject_signup(t.uid('new2@x.test'));
select t.expect((select count(*) from public.owner_list_pending_users() where email like 'new%') = 1, 'الرفض يحذف الطلب');
select t.logout();

-- ---------------------------------------------------------------------------
-- 14) إضافة طفل بمعرّف من الجهاز (أوفلاين) — add_participant
-- ---------------------------------------------------------------------------
select t.login(t.uid('admin@x.test'));
select t.expect((select public.add_participant('aaaaaaaa-0000-4000-8000-000000000001', '  طفل أوفلاين ', (select ma from mq))->>'status') = 'created', 'إضافة طفل بمعرّف من الجهاز');
select t.expect((select count(*) from public.participants where id = 'aaaaaaaa-0000-4000-8000-000000000001' and name = 'طفل أوفلاين') = 1, 'الاسم يُنظَّف والطفل موجود');
select t.expect((select public.add_participant('aaaaaaaa-0000-4000-8000-000000000001', 'طفل أوفلاين', (select ma from mq))->>'status') = 'already_synced', 'إعادة الإرسال لا تكرّر');
select t.expect((select count(*) from public.participants where name = 'طفل أوفلاين') = 1, 'طفل واحد فقط بعد إعادة الإرسال');
select t.expect_err($$select public.add_participant('aaaaaaaa-0000-4000-8000-000000000001', 'اسم مختلف', (select ma from mq))$$, 'ERR_INVALID_INPUT', 'نفس المعرّف باسم مختلف مرفوض');
select t.expect_err($$select public.add_participant(gen_random_uuid(), 'x', (select mb from mq))$$, 'ERR_MOSQUE_NOT_ALLOWED', 'لا إضافة لمسجد غير مربوط');
select t.expect_err($$select public.add_participant(gen_random_uuid(), '   ', (select ma from mq))$$, 'ERR_INVALID_INPUT', 'اسم فارغ مرفوض');
select t.expect_err($$select public.add_participant(gen_random_uuid(), 'x', gen_random_uuid())$$, 'ERR_MOSQUE_NOT_FOUND', 'مسجد غير موجود مرفوض');
select t.expect((select created_by from public.participants where id = 'aaaaaaaa-0000-4000-8000-000000000001') = t.uid('admin@x.test'), 'created_by = المستخدم الحالي');
select t.logout();
select t.login(t.uid('rec1@x.test'));
select t.expect_err($$select public.add_participant(gen_random_uuid(), 'x', (select ma from mq))$$, 'ERR_NOT_AUTHORIZED', 'المسجِّل لا يضيف أطفالًا');
select t.logout();
select t.login(t.uid('owner@x.test'));
update public.mosques set active = false where id = (select mb from mq);
select t.expect_err($$select public.add_participant(gen_random_uuid(), 'x', (select mb from mq))$$, 'ERR_MOSQUE_NOT_ALLOWED', 'لا إضافة لمسجد موقوف');
update public.mosques set active = true where id = (select mb from mq);
select t.logout();
select t.login_anon();
select t.expect_err($$select public.add_participant(gen_random_uuid(), 'x', (select ma from mq))$$, 'permission denied', 'anon لا ينفذ الدالة');
select t.logout();

\echo '=== كل اختبارات قاعدة البيانات نجحت ==='
