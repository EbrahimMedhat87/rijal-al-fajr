-- 1) رقم لكل طفل داخل مسجده (1، 2، 3 …) للبحث السريع
-- 2) إلغاء حضور مسجَّل بالخطأ (للمسجِّل في سجلاته هو خلال يوم/أمس، وللمشرف/المالك في أي وقت)

alter table public.participants add column if not exists child_no integer;

-- ترقيم الموجودين: بترتيب الإضافة داخل كل مسجد (بدون تسجيل تعديلات في سجل التدقيق)
alter table public.participants disable trigger participants_touch;
alter table public.participants disable trigger participants_audit;
alter table public.participants disable trigger participants_guard_trg;

-- (أ) مساجد كل أسماء أطفالها تبدأ برقم فريد ("12 أحمد …"): يُحفظ الرقم كرقم للطفل ويُحذف من الاسم
with parsed as (
  select id, mosque_id,
         nullif(translate((regexp_match(name, '^\s*([0-9٠-٩]{1,4})\s+'))[1], '٠١٢٣٤٥٦٧٨٩', '0123456789'), '')::int as num
    from public.participants
), ok as (
  select mosque_id from parsed
   group by mosque_id
  having count(*) = count(num) and count(distinct num) = count(*) and min(num) >= 1
)
update public.participants p
   set child_no = pr.num,
       name = btrim(regexp_replace(p.name, '^\s*[0-9٠-٩]{1,4}\s+', ''))
  from parsed pr
 where pr.id = p.id and pr.mosque_id in (select mosque_id from ok);

-- (ب) الباقي: ترقيم تسلسلي بترتيب الإضافة داخل كل مسجد (بعد أعلى رقم موجود)
with base as (
  select mosque_id, coalesce(max(child_no), 0) as mx from public.participants group by mosque_id
), r as (
  select p.id, b.mx + row_number() over (partition by p.mosque_id order by p.created_at, p.ctid) as rn
    from public.participants p join base b on b.mosque_id = p.mosque_id
   where p.child_no is null
)
update public.participants p set child_no = r.rn from r where r.id = p.id;

alter table public.participants enable trigger participants_touch;
alter table public.participants enable trigger participants_audit;
alter table public.participants enable trigger participants_guard_trg;

-- قواعد الترقيم:
--  • طفل جديد: يأخذ أصغر رقم فاضي في المسجد (يملأ الفراغات اللي سابها أطفال انتقلوا لمسجد آخر)
--  • طفل منقول لمسجد جديد: يأخذ (أعلى رقم موجود + 1) هناك — ولا يُعاد ترتيب أحد
--  • تعديل الرقم يدويًا: مسموح بشرط ألا يكون مستخدمًا (قيد الفريد)
create function public.participants_assign_child_no() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.child_no is null then
      perform 1 from public.mosques where id = new.mosque_id for update; -- يمنع طفلين متزامنين من أخذ نفس الرقم
      select n into new.child_no
        from generate_series(1, (select coalesce(max(p.child_no), 0) + 1 from public.participants p where p.mosque_id = new.mosque_id)) n
       where not exists (select 1 from public.participants p where p.mosque_id = new.mosque_id and p.child_no = n)
       order by n limit 1;
    end if;
  else
    if new.mosque_id is distinct from old.mosque_id then
      perform 1 from public.mosques where id = new.mosque_id for update;
      select coalesce(max(p.child_no), 0) + 1 into new.child_no from public.participants p where p.mosque_id = new.mosque_id;
    elsif new.child_no is distinct from old.child_no then
      if new.child_no is null or new.child_no < 1 then
        raise exception 'ERR_INVALID_INPUT' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger participants_assign_child_no_trg
  before insert or update of mosque_id, child_no on public.participants
  for each row execute function public.participants_assign_child_no();

alter table public.participants alter column child_no set not null;
alter table public.participants add constraint participants_mosque_child_no_key unique (mosque_id, child_no);
alter table public.participants add constraint participants_child_no_positive check (child_no >= 1);

grant update (child_no) on public.participants to authenticated;

-- إلغاء الحضور حسب (الطفل، اليوم): يُبطِل السجل الصالح مع تسجيله في سجل التدقيق.
create function public.undo_attendance(p_participant_id uuid, p_date date, p_reason text default 'تسجيل بالخطأ') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.attendance;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'تسجيل بالخطأ');
  v_role text;
begin
  select role::text into v_role from public.profiles where user_id = auth.uid() and active;
  if v_role is null or v_role not in ('owner', 'admin', 'recorder') then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not public.can_access_participant(p_participant_id) then
    raise exception 'ERR_MOSQUE_NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_row from public.attendance
   where participant_id = p_participant_id and attendance_date = p_date and status = 'valid'
   for update;
  if not found then
    raise exception 'ERR_ATTENDANCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_role = 'recorder'
     and (v_row.recorded_by is distinct from auth.uid() or p_date < public.campaign_today() - 1) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;

  update public.attendance
     set status = 'void', void_reason = v_reason, voided_by = auth.uid(), voided_at = now()
   where id = v_row.id;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'attendance.void', 'attendance', v_row.id::text,
          jsonb_build_object('participant_id', v_row.participant_id, 'attendance_date', v_row.attendance_date,
                             'recorded_by', v_row.recorded_by, 'reason', v_reason, 'via', 'undo'));

  return jsonb_build_object('status', 'voided', 'attendance_id', v_row.id);
end $$;

revoke execute on function public.undo_attendance(uuid, date, text), public.participants_assign_child_no() from public, anon;
grant execute on function public.undo_attendance(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- كشف التكرار بين المساجد (أول 3 كلمات) — يرى المشرف اسم الطفل واسم مسجده فقط
-- (ضروري لأن المشرف لا يرى أطفال المساجد الأخرى بسبب عزل المساجد)
-- ---------------------------------------------------------------------------
create function public.norm_ar(s text) returns text
language sql immutable parallel safe as $$
  select btrim(regexp_replace(
    translate(lower(regexp_replace(coalesce(s, ''), '[\u064B-\u065F\u0670\u0640]', '', 'g')), 'أإآٱىة', 'اااايه'),
    '\s+', ' ', 'g'))
$$;

create function public.find_similar_children(p_names text[], p_mosque_id uuid)
returns table (idx integer, participant_id uuid, name text, child_no integer, mosque_id uuid, mosque_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.has_role(array['owner', 'admin']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not public.can_access_mosque(p_mosque_id) then
    raise exception 'ERR_MOSQUE_NOT_ALLOWED' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_names), 0) > 500 then
    raise exception 'ERR_INVALID_INPUT' using errcode = 'P0001';
  end if;
  return query
    with q as (
      select i as idx,
             string_to_array(public.norm_ar(p_names[i]), ' ') as t
        from generate_subscripts(p_names, 1) i
    ), qk as (
      select idx, t, cardinality(t) as n, least(3, cardinality(t)) as k from q where cardinality(t) >= 2
    ), cand as (
      select p.id, p.name, p.child_no, p.mosque_id, m.name as mname,
             string_to_array(public.norm_ar(p.name), ' ') as ct
        from public.participants p join public.mosques m on m.id = p.mosque_id
       where p.mosque_id <> p_mosque_id
    ), hit as (
      select qk.idx, c.id, c.name, c.child_no, c.mosque_id, c.mname,
             row_number() over (partition by qk.idx order by c.name) as rn
        from qk join cand c
          on cardinality(c.ct) >= qk.k
         and (qk.n >= 3 or cardinality(c.ct) = qk.n)
         and c.ct[1:qk.k] = qk.t[1:qk.k]
    )
    select hit.idx, hit.id, hit.name, hit.child_no, hit.mosque_id, hit.mname from hit where hit.rn <= 3 order by hit.idx, hit.rn;
end $$;

-- نقل طفل إلى مسجد (بدل تكراره): تاريخ حضوره كله يبقى معه، ويأخذ رقمًا جديدًا في المسجد الجديد.
-- المالك: أي نقل. المشرف: إلى مسجد من مساجده فقط. كل نقل يُسجَّل في سجل التدقيق.
create function public.transfer_child(p_participant_id uuid, p_to_mosque_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_from uuid;
  v_name text;
begin
  if not public.has_role(array['owner', 'admin']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.mosques m where m.id = p_to_mosque_id and m.active) then
    raise exception 'ERR_MOSQUE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.can_access_mosque(p_to_mosque_id) then
    raise exception 'ERR_MOSQUE_NOT_ALLOWED' using errcode = '42501';
  end if;
  select mosque_id, name into v_from, v_name from public.participants where id = p_participant_id for update;
  if not found then
    raise exception 'ERR_PARTICIPANT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_from = p_to_mosque_id then
    return jsonb_build_object('status', 'already_there');
  end if;
  update public.participants set mosque_id = p_to_mosque_id, active = true where id = p_participant_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'participant.transfer', 'participants', p_participant_id::text,
          jsonb_build_object('name', v_name, 'from_mosque', v_from, 'to_mosque', p_to_mosque_id));
  return jsonb_build_object('status', 'transferred');
end $$;

revoke execute on function public.norm_ar(text), public.find_similar_children(text[], uuid), public.transfer_child(uuid, uuid) from public, anon;
grant execute on function public.norm_ar(text), public.find_similar_children(text[], uuid), public.transfer_child(uuid, uuid) to authenticated;

-- الترتيب/التقارير: نُرجع رقم الطفل أيضًا
drop function public.attendance_counts(date, date, uuid);
create function public.attendance_counts(p_from date, p_to date, p_mosque_id uuid default null)
returns table (participant_id uuid, name text, active boolean, mosque_id uuid, mosque_name text, days bigint, child_no integer)
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
    select p.id, p.name, p.active, p.mosque_id, m.name, coalesce(counts.n, 0)::bigint, p.child_no
      from public.participants p
      join public.mosques m on m.id = p.mosque_id
      left join counts on counts.pid = p.id
     where (p.active or counts.n > 0)
       and (p_mosque_id is null or p.mosque_id = p_mosque_id);
end $$;
revoke execute on function public.attendance_counts(date, date, uuid) from public, anon;
grant execute on function public.attendance_counts(date, date, uuid) to authenticated;
