-- رجال الفجر — 0002: دوال الصلاحيات والعمليات (RPC)
-- كل الدوال security definer مع search_path ثابت، وتتحقق من الدور داخلها.

-- ---------------------------------------------------------------------------
-- دوال مساعدة للصلاحيات (تستخدمها سياسات RLS)
-- ---------------------------------------------------------------------------
create function public.current_user_role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from public.profiles p where p.user_id = auth.uid() and p.active
$$;

create function public.is_member() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.active)
$$;

create function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_user_role() = any (roles), false)
$$;

-- تاريخ اليوم بتوقيت المبادرة (تستخدمه سياسات RLS)
create function public.campaign_today() returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone c.timezone)::date from public.campaigns c where c.status = 'active'
$$;

-- ---------------------------------------------------------------------------
-- تسجيل حضور (يُستخدم من الشاشة مباشرة ومن طابور المزامنة)
--   النتيجة: { status: 'created' | 'already_synced' | 'already_recorded', attendance_id }
--   * created          : سُجِّل الآن
--   * already_synced   : نفس العملية (client_op_id) وصلت من قبل — إعادة إرسال آمنة
--   * already_recorded : الطفل مسجَّل حاضرًا في هذا اليوم من عملية أخرى (جهاز آخر مثلًا)
--   أي حالة أخرى ترفع خطأ برمز ثابت ERR_* يقرؤه التطبيق.
-- ---------------------------------------------------------------------------
create function public.record_attendance(
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
begin
  if v_role is null then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_client_op_id is null or p_participant_id is null or p_date is null then
    raise exception 'ERR_INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- إعادة إرسال نفس العملية: نجاح صامت
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
  -- المسجِّل (recorder): اليوم أو أمس فقط (أمس لتغطية مزامنة متأخرة بعد العمل بدون إنترنت)
  if v_role = 'recorder' and p_date < v_today - 1 then
    raise exception 'ERR_DATE_NOT_ALLOWED' using errcode = '42501';
  end if;

  if not exists (select 1 from public.participants where id = p_participant_id) then
    raise exception 'ERR_PARTICIPANT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- بدون هدف محدد: يتجاهل التعارض مع أي قيد فريد (العملية أو الطفل/اليوم)
  insert into public.attendance
    (campaign_id, participant_id, attendance_date, recorded_by, client_op_id, device_created_at)
  values
    (v_campaign.id, p_participant_id, p_date, v_uid, p_client_op_id, p_device_created_at)
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('status', 'created', 'attendance_id', v_id);
  end if;

  -- تعارض: نحدد السبب
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
-- إبطال سجل حضور (Admin / Owner) — يتطلب سببًا ويُكتب في سجل التدقيق
-- ---------------------------------------------------------------------------
create function public.void_attendance(p_attendance_id uuid, p_reason text) returns jsonb
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
-- عدّاد أيام الحضور لكل طفل في فترة (للترتيب والتقارير) — Admin / Owner فقط
--   security invoker => سياسات RLS تطبَّق أيضًا.
--   يشمل الأطفال النشطين (حتى لو 0) + أي طفل غير نشط له حضور صالح في الفترة.
--   الترتيب نفسه (competition ranking) يتم في التطبيق من هذه الأعداد.
-- ---------------------------------------------------------------------------
create function public.attendance_counts(p_from date, p_to date)
returns table (participant_id uuid, name text, active boolean, days bigint)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
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
    select p.id, p.name, p.active, coalesce(counts.n, 0)::bigint
      from public.participants p
      left join counts on counts.pid = p.id
     where p.active or counts.n > 0;
end $$;

-- ---------------------------------------------------------------------------
-- إدارة المنظمين (Owner فقط)
--   المنظم يُنشأ أولًا من لوحة Supabase (Authentication > Users > Add user)،
--   ثم يُربط هنا بالبريد والدور. لا يوجد تسجيل عام.
-- ---------------------------------------------------------------------------
create function public.owner_list_users() returns table (
  user_id uuid, email text, display_name text, role text, active boolean, created_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role(array['owner']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return query
    select p.user_id, u.email::text, p.display_name, p.role, p.active, p.created_at
      from public.profiles p
      left join auth.users u on u.id = p.user_id
     order by p.created_at;
end $$;

create function public.owner_upsert_user(
  p_email text, p_display_name text, p_role text, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
begin
  if not public.has_role(array['owner']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'admin', 'recorder') then
    raise exception 'ERR_INVALID_ROLE' using errcode = 'P0001';
  end if;
  if p_display_name is null or length(btrim(p_display_name)) = 0 then
    raise exception 'ERR_INVALID_INPUT' using errcode = 'P0001';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'ERR_AUTH_USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.profiles (user_id, display_name, role, active)
  values (v_user, btrim(p_display_name), p_role, coalesce(p_active, true))
  on conflict (user_id) do update
     set display_name = excluded.display_name, role = excluded.role, active = excluded.active;

  return v_user;
end $$;

-- ---------------------------------------------------------------------------
-- إعدادات المبادرة (Owner فقط)
-- ---------------------------------------------------------------------------
create function public.owner_update_campaign(p_name text, p_start_date date, p_timezone text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role(array['owner']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  update public.campaigns
     set name = btrim(p_name), start_date = p_start_date, timezone = btrim(p_timezone)
   where status = 'active';
  if not found then
    raise exception 'ERR_NO_ACTIVE_CAMPAIGN' using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- إنشاء أول Owner (يُشغَّل يدويًا من SQL Editor فقط — غير متاح لأي مستخدم تطبيق)
--   يعمل فقط إذا لم يوجد أي منظم بعد.
-- ---------------------------------------------------------------------------
create function public.bootstrap_first_owner(
  p_email         text,
  p_display_name  text,
  p_campaign_name text default 'رجال الفجر',
  p_start_date    date default null,
  p_timezone      text default 'Africa/Cairo'
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
begin
  if exists (select 1 from public.profiles) then
    raise exception 'ERR_ALREADY_BOOTSTRAPPED' using errcode = 'P0001';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'ERR_AUTH_USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.profiles (user_id, display_name, role, active)
  values (v_user, btrim(p_display_name), 'owner', true);

  if not exists (select 1 from public.campaigns where status = 'active') then
    insert into public.campaigns (name, start_date, timezone)
    values (p_campaign_name,
            coalesce(p_start_date, (now() at time zone p_timezone)::date),
            p_timezone);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- صلاحيات التنفيذ: لا شيء متاح للعامة/anon
-- ---------------------------------------------------------------------------
revoke execute on function
  public.current_user_role(), public.is_member(), public.has_role(text[]), public.campaign_today(),
  public.record_attendance(uuid, uuid, date, timestamptz),
  public.void_attendance(uuid, text),
  public.attendance_counts(date, date),
  public.owner_list_users(),
  public.owner_upsert_user(text, text, text, boolean),
  public.owner_update_campaign(text, date, text),
  public.bootstrap_first_owner(text, text, text, date, text)
from public, anon;

grant execute on function
  public.current_user_role(), public.is_member(), public.has_role(text[]), public.campaign_today(),
  public.record_attendance(uuid, uuid, date, timestamptz),
  public.void_attendance(uuid, text),
  public.attendance_counts(date, date),
  public.owner_list_users(),
  public.owner_upsert_user(text, text, text, boolean),
  public.owner_update_campaign(text, date, text)
to authenticated;

-- bootstrap_first_owner: لا يُمنح لـ authenticated إطلاقًا
revoke execute on function public.bootstrap_first_owner(text, text, text, date, text) from authenticated;
