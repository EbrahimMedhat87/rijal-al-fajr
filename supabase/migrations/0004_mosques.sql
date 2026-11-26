-- رجال الفجر — 0004: المساجد
--  * كل طفل تابع لمسجد واحد، وكل إداري/مسجِّل مربوط بمسجد أو أكثر. المالك يرى كل المساجد.
--  * العزل بين المساجد مفروض بـ RLS ودوال الصلاحيات (وليس في الواجهة فقط).
--  * الإداري يستطيع قراءة ترتيب الأطفال والمساجد على مستوى كل المساجد (قرار المالك)، لكن لا يقرأ
--    سجلات الحضور ولا يعدّل أطفال مسجد غير مربوط به.
-- يُشغَّل مرة واحدة بعد 0001–0003. آمن لو وُجد أطفال بالفعل (يُنشأ لهم "المسجد الرئيسي").

-- ---------------------------------------------------------------------------
-- الجداول
-- ---------------------------------------------------------------------------
create table public.mosques (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 100),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index mosques_name_uidx on public.mosques (lower(btrim(name)));

create function public.mosques_guard() returns trigger
language plpgsql as $$
begin
  new.name := btrim(new.name);
  return new;
end $$;

create trigger mosques_guard_trg  before insert or update on public.mosques for each row execute function public.mosques_guard();
create trigger mosques_touch      before update on public.mosques for each row execute function public.touch_updated_at();
create trigger mosques_audit      after insert or update on public.mosques for each row execute function public.audit_row();

create table public.user_mosques (
  user_id    uuid not null references public.profiles (user_id) on delete cascade,
  mosque_id  uuid not null references public.mosques (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, mosque_id)
);
create index user_mosques_mosque_idx on public.user_mosques (mosque_id);
create trigger user_mosques_audit after insert or delete on public.user_mosques for each row execute function public.audit_row();

alter table public.participants add column mosque_id uuid references public.mosques (id) on delete restrict;

-- لو يوجد أطفال بالفعل: ننشئ مسجدًا افتراضيًا ونربط به الأطفال وكل المنظمين غير المالك
do $$
declare v uuid;
begin
  if exists (select 1 from public.participants) then
    insert into public.mosques (name) values ('المسجد الرئيسي') returning id into v;
    update public.participants set mosque_id = v where mosque_id is null;
    insert into public.user_mosques (user_id, mosque_id)
      select p.user_id, v from public.profiles p where p.role <> 'owner';
  end if;
end $$;

alter table public.participants alter column mosque_id set not null;
create index participants_mosque_idx on public.participants (mosque_id);

-- ---------------------------------------------------------------------------
-- دوال الصلاحيات
-- ---------------------------------------------------------------------------
create function public.can_access_mosque(p_mosque uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when public.current_user_role() is null then false
    when public.current_user_role() = 'owner' then true
    else exists (select 1 from public.user_mosques um where um.user_id = auth.uid() and um.mosque_id = p_mosque)
  end
$$;

create function public.can_access_participant(p_participant uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select public.can_access_mosque(p.mosque_id) from public.participants p where p.id = p_participant), false)
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.mosques      enable row level security;
alter table public.user_mosques enable row level security;

revoke all on public.mosques, public.user_mosques from anon, authenticated;
grant select on public.mosques, public.user_mosques to authenticated;
grant insert (name, active) on public.mosques to authenticated;
grant update (name, active) on public.mosques to authenticated;

-- أسماء المساجد يقرأها كل المنظمين (تظهر في ترتيب المساجد). الكتابة للمالك فقط.
create policy mosques_select on public.mosques
  for select to authenticated using (public.is_member());
create policy mosques_insert on public.mosques
  for insert to authenticated with check (public.has_role(array['owner']));
create policy mosques_update on public.mosques
  for update to authenticated
  using (public.has_role(array['owner'])) with check (public.has_role(array['owner']));

create policy user_mosques_select on public.user_mosques
  for select to authenticated
  using ((user_id = auth.uid() and public.is_member()) or public.has_role(array['owner']));

-- الأطفال: حسب المسجد
grant insert (mosque_id) on public.participants to authenticated;
grant update (mosque_id) on public.participants to authenticated;

drop policy participants_select on public.participants;
drop policy participants_insert on public.participants;
drop policy participants_update on public.participants;

create policy participants_select on public.participants
  for select to authenticated
  using (public.can_access_mosque(mosque_id));

create policy participants_insert on public.participants
  for insert to authenticated
  with check (
    public.has_role(array['owner', 'admin'])
    and public.can_access_mosque(mosque_id)
    and exists (select 1 from public.mosques m where m.id = mosque_id and m.active)
  );

create policy participants_update on public.participants
  for update to authenticated
  using (public.has_role(array['owner', 'admin']) and public.can_access_mosque(mosque_id))
  with check (public.has_role(array['owner', 'admin']) and public.can_access_mosque(mosque_id));

-- الحضور: يُقرأ فقط لأطفال المساجد المتاحة. المسجِّل: اليوم وأمس فقط.
drop policy attendance_select_admin on public.attendance;
drop policy attendance_select_recorder on public.attendance;

create policy attendance_select on public.attendance
  for select to authenticated
  using (
    public.can_access_participant(participant_id)
    and (
      public.has_role(array['owner', 'admin'])
      or (public.has_role(array['recorder']) and attendance_date >= public.campaign_today() - 1)
    )
  );

-- ---------------------------------------------------------------------------
-- تسجيل الحضور: نفس المنطق السابق + التحقق من المسجد
-- ---------------------------------------------------------------------------
create or replace function public.record_attendance(
  p_client_op_id      uuid,
  p_participant_id    uuid,
  p_date              date,
  p_device_created_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role     text := public.current_user_role();
  v_uid      uuid := auth.uid();
  v_campaign public.campaigns;
  v_today    date;
  v_id       uuid;
  v_mosque   uuid;
begin
  if v_role is null then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_client_op_id is null or p_participant_id is null or p_date is null then
    raise exception 'ERR_INVALID_INPUT' using errcode = 'P0001';
  end if;

  select a.id into v_id from public.attendance a where a.client_op_id = p_client_op_id;
  if found then
    return jsonb_build_object('status', 'already_synced', 'attendance_id', v_id);
  end if;

  select * into v_campaign from public.campaigns c where c.status = 'active';
  if not found then
    raise exception 'ERR_NO_ACTIVE_CAMPAIGN' using errcode = 'P0001';
  end if;

  v_today := (now() at time zone v_campaign.timezone)::date;

  if p_date > v_today then
    raise exception 'ERR_DATE_IN_FUTURE' using errcode = 'P0001';
  end if;
  if p_date < v_campaign.start_date then
    raise exception 'ERR_BEFORE_CAMPAIGN_START' using errcode = 'P0001';
  end if;
  if v_role = 'recorder' and p_date < v_today - 1 then
    raise exception 'ERR_DATE_NOT_ALLOWED' using errcode = '42501';
  end if;

  select p.mosque_id into v_mosque from public.participants p where p.id = p_participant_id;
  if not found then
    raise exception 'ERR_PARTICIPANT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.can_access_mosque(v_mosque) then
    raise exception 'ERR_MOSQUE_NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.attendance
    (campaign_id, participant_id, attendance_date, recorded_by, client_op_id, device_created_at)
  values
    (v_campaign.id, p_participant_id, p_date, v_uid, p_client_op_id, p_device_created_at)
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('status', 'created', 'attendance_id', v_id);
  end if;

  select a.id into v_id from public.attendance a where a.client_op_id = p_client_op_id;
  if found then
    return jsonb_build_object('status', 'already_synced', 'attendance_id', v_id);
  end if;

  select a.id into v_id
    from public.attendance a
   where a.campaign_id = v_campaign.id
     and a.participant_id = p_participant_id
     and a.attendance_date = p_date
     and a.status = 'valid';
  if found then
    return jsonb_build_object('status', 'already_recorded', 'attendance_id', v_id);
  end if;

  raise exception 'ERR_CONFLICT_UNRESOLVED' using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------
-- الإبطال: Admin لمسجده، Owner للكل
-- ---------------------------------------------------------------------------
create or replace function public.void_attendance(p_attendance_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.attendance;
begin
  if not public.has_role(array['owner', 'admin']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'ERR_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_row from public.attendance where id = p_attendance_id for update;
  if not found then
    raise exception 'ERR_ATTENDANCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.can_access_participant(v_row.participant_id) then
    raise exception 'ERR_MOSQUE_NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_row.status = 'void' then
    raise exception 'ERR_ATTENDANCE_ALREADY_VOID' using errcode = 'P0001';
  end if;

  update public.attendance
     set status = 'void', void_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now()
   where id = p_attendance_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'attendance.void', 'attendance', p_attendance_id::text,
          jsonb_build_object(
            'participant_id', v_row.participant_id,
            'attendance_date', v_row.attendance_date,
            'recorded_by', v_row.recorded_by,
            'reason', btrim(p_reason)));

  return jsonb_build_object('status', 'voided', 'attendance_id', p_attendance_id);
end $$;

-- ---------------------------------------------------------------------------
-- الترتيب (Owner / Admin): على مستوى كل المساجد، مع فلتر اختياري بالمسجد
-- ---------------------------------------------------------------------------
drop function public.attendance_counts(date, date);

create function public.attendance_counts(p_from date, p_to date, p_mosque_id uuid default null)
returns table (participant_id uuid, name text, active boolean, mosque_id uuid, mosque_name text, days bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role(array['owner', 'admin']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return query
    with c as (select id from public.campaigns where status = 'active'),
    counts as (
      select a.participant_id as pid, count(*) as n
        from public.attendance a, c
       where a.campaign_id = c.id
         and a.status = 'valid'
         and a.attendance_date between p_from and p_to
       group by a.participant_id
    )
    select p.id, p.name, p.active, p.mosque_id, m.name, coalesce(counts.n, 0)::bigint
      from public.participants p
      join public.mosques m on m.id = p.mosque_id
      left join counts on counts.pid = p.id
     where (p.active or counts.n > 0)
       and (p_mosque_id is null or p.mosque_id = p_mosque_id);
end $$;

-- ترتيب المساجد: المتوسط = إجمالي أيام الحضور ÷ عدد الأطفال (النشطين أو من حضر في الفترة)
create function public.mosque_ranking(p_from date, p_to date)
returns table (mosque_id uuid, name text, children bigint, present bigint, total_days bigint, avg_days numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role(array['owner', 'admin']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return query
    with c as (select id from public.campaigns where status = 'active'),
    counts as (
      select a.participant_id as pid, count(*) as n
        from public.attendance a, c
       where a.campaign_id = c.id
         and a.status = 'valid'
         and a.attendance_date between p_from and p_to
       group by a.participant_id
    ),
    kids as (
      select p.mosque_id as mid, coalesce(counts.n, 0) as n
        from public.participants p
        left join counts on counts.pid = p.id
       where p.active or counts.n > 0
    )
    select m.id, m.name,
           count(k.mid)::bigint,
           (count(*) filter (where k.n > 0))::bigint,
           coalesce(sum(k.n), 0)::bigint,
           coalesce(round(sum(k.n)::numeric / nullif(count(k.mid), 0), 2), 0)
      from public.mosques m
      left join kids k on k.mid = m.id
     where m.active
     group by m.id, m.name;
end $$;

-- ---------------------------------------------------------------------------
-- إدارة المنظمين والمساجد (Owner)
-- ---------------------------------------------------------------------------
drop function public.owner_list_users();

create function public.owner_list_users() returns table (
  user_id uuid, email text, display_name text, role text, active boolean, created_at timestamptz, mosque_ids uuid[]
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role(array['owner']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return query
    select p.user_id, u.email::text, p.display_name, p.role, p.active, p.created_at,
           coalesce(array(select um.mosque_id from public.user_mosques um where um.user_id = p.user_id), '{}'::uuid[])
      from public.profiles p
      left join auth.users u on u.id = p.user_id
     order by p.created_at;
end $$;

create function public.owner_set_user_mosques(p_user_id uuid, p_mosque_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ids uuid[] := coalesce(p_mosque_ids, '{}'::uuid[]);
begin
  if not public.has_role(array['owner']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user_id) then
    raise exception 'ERR_AUTH_USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(v_ids) m where not exists (select 1 from public.mosques x where x.id = m)) then
    raise exception 'ERR_MOSQUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.user_mosques where user_id = p_user_id and not (mosque_id = any (v_ids));
  insert into public.user_mosques (user_id, mosque_id)
    select p_user_id, s.m from (select distinct unnest(v_ids) as m) s
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- طلبات التسجيل: الإداري يسجّل حسابه بنفسه من شاشة الدخول، فيظهر للمالك هنا
-- (حساب بلا ملف في profiles = لا يرى أي بيانات إطلاقًا؛ الصلاحية تبدأ بموافقة المالك)
-- ---------------------------------------------------------------------------
create function public.owner_list_pending_users() returns table (
  user_id uuid, email text, full_name text, requested_mosque text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role(array['owner']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text,
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'requested_mosque'), ''),
           u.created_at
      from auth.users u
     where not exists (select 1 from public.profiles p where p.user_id = u.id)
     order by u.created_at desc;
end $$;

-- رفض طلب: يحذف الحساب فقط إن لم يكن له ملف منظم (لا يمكن حذف منظم موجود بهذه الدالة)
create function public.owner_reject_signup(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role(array['owner']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where user_id = p_user_id) then
    raise exception 'ERR_INVALID_INPUT' using errcode = 'P0001';
  end if;
  delete from auth.users where id = p_user_id;
end $$;

-- ---------------------------------------------------------------------------
-- صلاحيات التنفيذ
-- ---------------------------------------------------------------------------
revoke execute on function
  public.can_access_mosque(uuid), public.can_access_participant(uuid),
  public.attendance_counts(date, date, uuid), public.mosque_ranking(date, date),
  public.owner_list_users(), public.owner_set_user_mosques(uuid, uuid[]),
  public.owner_list_pending_users(), public.owner_reject_signup(uuid)
from public, anon;

grant execute on function
  public.can_access_mosque(uuid), public.can_access_participant(uuid),
  public.attendance_counts(date, date, uuid), public.mosque_ranking(date, date),
  public.owner_list_users(), public.owner_set_user_mosques(uuid, uuid[]),
  public.owner_list_pending_users(), public.owner_reject_signup(uuid)
to authenticated;
