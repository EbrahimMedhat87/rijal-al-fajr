-- رجال الفجر — 0001: الجداول والقيود والـ triggers
-- يُشغَّل مرة واحدة على مشروع Supabase جديد (SQL Editor أو supabase db push).

-- ---------------------------------------------------------------------------
-- campaigns: إعدادات المبادرة (صف واحد نشط فقط)
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  start_date  date not null,
  timezone    text not null default 'Africa/Cairo',
  status      text not null default 'active' check (status in ('active', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- مبادرة نشطة واحدة فقط في أي وقت
create unique index campaigns_one_active on public.campaigns ((true)) where status = 'active';

-- ---------------------------------------------------------------------------
-- profiles: المنظمون المعتمدون (مرتبطون بـ Supabase Auth)
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) > 0),
  role         text not null check (role in ('owner', 'admin', 'recorder')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- participants: الأطفال (الاسم فقط — لا بيانات حساسة)
-- ---------------------------------------------------------------------------
create table public.participants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 100),
  active      boolean not null default true,
  created_by  uuid references public.profiles (user_id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index participants_name_idx on public.participants (name);

-- ---------------------------------------------------------------------------
-- attendance: سجلات الحضور
--   * لا تُحذف أبدًا؛ التصحيح يتم بالإبطال (void) مع سبب وسجل تدقيق.
--   * participant_id بدون cascade: إيقاف الطفل لا يمسح تاريخه، ولا يمكن حذفه أصلًا.
-- ---------------------------------------------------------------------------
create table public.attendance (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns (id) on delete restrict,
  participant_id    uuid not null references public.participants (id) on delete restrict,
  attendance_date   date not null,                       -- تاريخ فقط (YYYY-MM-DD) بتوقيت المبادرة
  status            text not null default 'valid' check (status in ('valid', 'void')),
  recorded_by       uuid not null references public.profiles (user_id) on delete restrict,
  recorded_at       timestamptz not null default now(),  -- وقت الخادم
  client_op_id      uuid not null,                       -- معرّف العملية من الجهاز (لمنع التكرار عند إعادة الإرسال)
  device_created_at timestamptz,                         -- وقت إنشاء السجل على الجهاز (للمعلومية فقط)
  void_reason       text,
  voided_by         uuid references public.profiles (user_id) on delete restrict,
  voided_at         timestamptz,
  constraint attendance_void_consistency check (
    (status = 'valid' and void_reason is null and voided_by is null and voided_at is null)
    or
    (status = 'void' and length(btrim(coalesce(void_reason, ''))) > 0
       and voided_by is not null and voided_at is not null)
  )
);

-- كل عملية من جهاز تُسجَّل مرة واحدة فقط (idempotency)
create unique index attendance_client_op_uidx on public.attendance (client_op_id);

-- سجل صالح واحد فقط لكل طفل في اليوم الواحد للمبادرة الواحدة (القيد الأساسي ضد التكرار)
create unique index attendance_one_valid_per_day
  on public.attendance (campaign_id, participant_id, attendance_date)
  where status = 'valid';

create index attendance_valid_date_idx
  on public.attendance (campaign_id, attendance_date)
  where status = 'valid';

create index attendance_participant_idx
  on public.attendance (participant_id, attendance_date desc);

-- ---------------------------------------------------------------------------
-- audit_log: سجل التدقيق (يُكتب بالـ triggers والدوال فقط)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb
);

create index audit_log_occurred_idx on public.audit_log (occurred_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger campaigns_touch    before update on public.campaigns    for each row execute function public.touch_updated_at();
create trigger profiles_touch     before update on public.profiles     for each row execute function public.touch_updated_at();
create trigger participants_touch before update on public.participants for each row execute function public.touch_updated_at();

-- المنطقة الزمنية يجب أن تكون اسمًا صحيحًا (IANA)
create function public.campaigns_validate() returns trigger
language plpgsql as $$
begin
  perform now() at time zone new.timezone;   -- يرفع خطأ لو الاسم غير صحيح
  if tg_op = 'UPDATE' and new.start_date > old.start_date then
    if exists (
      select 1 from public.attendance a
      where a.campaign_id = new.id and a.status = 'valid' and a.attendance_date < new.start_date
    ) then
      raise exception 'ERR_START_DATE_AFTER_ATTENDANCE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger campaigns_validate_trg
  before insert or update on public.campaigns
  for each row execute function public.campaigns_validate();

-- لا يجوز ترك المبادرة بدون Owner نشط
create function public.profiles_guard_last_owner() returns trigger
language plpgsql as $$
begin
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active) then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'owner' and p.active and p.user_id <> old.user_id
    ) then
      raise exception 'ERR_LAST_OWNER' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger profiles_guard_last_owner_trg
  before update or delete on public.profiles
  for each row execute function public.profiles_guard_last_owner();

-- الطفل: created_by تلقائي، وعدم تعديل الحقول الثابتة
create function public.participants_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.name := btrim(new.name);
  return new;
end $$;

create trigger participants_guard_trg
  before insert or update on public.participants
  for each row execute function public.participants_guard();

-- الحضور: لا حذف، ولا تعديل إلا الإبطال (valid -> void) مرة واحدة
create function public.attendance_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ERR_ATTENDANCE_NO_DELETE' using errcode = 'P0001';
  end if;
  if old.status = 'void' then
    raise exception 'ERR_ATTENDANCE_ALREADY_VOID' using errcode = 'P0001';
  end if;
  if new.campaign_id      is distinct from old.campaign_id
     or new.participant_id   is distinct from old.participant_id
     or new.attendance_date  is distinct from old.attendance_date
     or new.recorded_by      is distinct from old.recorded_by
     or new.recorded_at      is distinct from old.recorded_at
     or new.client_op_id     is distinct from old.client_op_id
     or new.device_created_at is distinct from old.device_created_at
     or new.id               is distinct from old.id then
    raise exception 'ERR_ATTENDANCE_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger attendance_immutable_trg
  before update or delete on public.attendance
  for each row execute function public.attendance_immutable();

-- تدقيق عام للتغييرات الإدارية (الأطفال، المنظمون، الإعدادات)
create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r jsonb;
  d jsonb;
begin
  r := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
      into d
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value and n.key <> 'updated_at';
    if d = '{}'::jsonb then
      return new;
    end if;
  else
    d := r;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name,
          coalesce(r ->> 'id', r ->> 'user_id'), d);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger participants_audit after insert or update on public.participants for each row execute function public.audit_row();
create trigger profiles_audit     after insert or update or delete on public.profiles for each row execute function public.audit_row();
create trigger campaigns_audit    after insert or update on public.campaigns for each row execute function public.audit_row();
