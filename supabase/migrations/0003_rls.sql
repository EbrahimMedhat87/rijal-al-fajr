-- رجال الفجر — 0003: Row Level Security والصلاحيات على الجداول
-- المبدأ: لا وصول لـ anon إطلاقًا. المستخدم يجب أن يكون منظمًا نشطًا (profile.active).

alter table public.campaigns    enable row level security;
alter table public.profiles     enable row level security;
alter table public.participants enable row level security;
alter table public.attendance   enable row level security;
alter table public.audit_log    enable row level security;

-- ملاحظة: لا نستخدم FORCE ROW LEVEL SECURITY عمدًا. دوال الصلاحيات (security definer)
-- تعمل بصلاحيات المالك وتقرأ profiles؛ وجود FORCE كان سيجعلها تخضع للسياسات وتسبب recursion.

-- نبدأ من الصفر: نسحب كل الصلاحيات ثم نمنح الحد الأدنى
revoke all on public.campaigns, public.profiles, public.participants,
              public.attendance, public.audit_log
  from anon, authenticated;

grant select on public.campaigns, public.profiles, public.participants,
                public.attendance, public.audit_log
  to authenticated;

-- الأطفال: إضافة وتعديل (الاسم والحالة فقط). لا DELETE نهائيًا — الإيقاف بدل الحذف.
grant insert (name, active) on public.participants to authenticated;
grant update (name, active) on public.participants to authenticated;

-- الحضور والمنظمون والإعدادات: القراءة فقط مباشرة؛ الكتابة عبر دوال RPC المحمية بالدور.

-- ---------------------------------------------------------------------------
-- السياسات
-- ---------------------------------------------------------------------------
create policy campaigns_select on public.campaigns
  for select to authenticated
  using (public.is_member());

create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_member());

create policy participants_select on public.participants
  for select to authenticated
  using (public.is_member());

create policy participants_insert on public.participants
  for insert to authenticated
  with check (public.has_role(array['owner', 'admin']));

create policy participants_update on public.participants
  for update to authenticated
  using (public.has_role(array['owner', 'admin']))
  with check (public.has_role(array['owner', 'admin']));

-- Admin / Owner: كل السجلات. Recorder: اليوم وأمس فقط (يكفي لشاشة التحضير والمزامنة المتأخرة)،
-- فلا يستطيع بناء ترتيب أو تقرير تاريخي من الـ API حتى لو تجاوز الواجهة.
create policy attendance_select_admin on public.attendance
  for select to authenticated
  using (public.has_role(array['owner', 'admin']));

create policy attendance_select_recorder on public.attendance
  for select to authenticated
  using (public.has_role(array['recorder']) and attendance_date >= public.campaign_today() - 1);

create policy audit_select on public.audit_log
  for select to authenticated
  using (public.has_role(array['owner', 'admin']));
