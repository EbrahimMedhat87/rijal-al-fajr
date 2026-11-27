-- 0007: حذف طفل نهائيًا مع كل سجل حضوره (للمالك، وللمشرف على أطفال مسجده فقط)
-- الحضور محمي من الحذف بمشغّل (attendance_immutable). نسمح بالحذف فقط من داخل delete_participant
-- عبر علامة داخل نفس المعاملة (transaction-local) لا يستطيع العميل ضبطها.
-- قبل الحذف يُحفظ في سجل التدقيق: بيانات الطفل وعدد وتواريخ حضوره، فيمكن تتبّع ما حدث أو إعادته يدويًا.

create or replace function public.attendance_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.allow_participant_delete', true), '') = 'on' then
      return old;
    end if;
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

create function public.delete_participant(p_participant_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p public.participants%rowtype;
  v_valid integer;
  v_void integer;
  v_dates jsonb;
begin
  if not public.has_role(array['owner', 'admin']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_p from public.participants where id = p_participant_id for update;
  if not found or not public.can_access_participant(p_participant_id) then
    raise exception 'ERR_PARTICIPANT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(*) filter (where status = 'valid'),
         count(*) filter (where status = 'void'),
         coalesce(jsonb_agg(attendance_date order by attendance_date) filter (where status = 'valid'), '[]'::jsonb)
    into v_valid, v_void, v_dates
    from public.attendance where participant_id = p_participant_id;

  perform set_config('app.allow_participant_delete', 'on', true);
  delete from public.attendance where participant_id = p_participant_id;
  perform set_config('app.allow_participant_delete', 'off', true);
  delete from public.participants where id = p_participant_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'participant.delete', 'participants', p_participant_id::text,
          jsonb_build_object('name', v_p.name, 'mosque_id', v_p.mosque_id, 'child_no', v_p.child_no,
                             'created_at', v_p.created_at, 'attendance_valid', v_valid,
                             'attendance_void', v_void, 'valid_dates', v_dates));
  return jsonb_build_object('status', 'deleted', 'attendance_deleted', v_valid + v_void);
end $$;

revoke execute on function public.delete_participant(uuid) from public, anon;
grant execute on function public.delete_participant(uuid) to authenticated;
