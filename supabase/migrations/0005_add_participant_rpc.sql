-- إضافة طفل بمعرّف يولّده الجهاز (لدعم الإضافة بدون إنترنت ثم المزامنة).
-- idempotent: إعادة الإرسال بنفس المعرّف لا تُنشئ تكرارًا.
create or replace function public.add_participant(p_id uuid, p_name text, p_mosque_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_existing record;
begin
  if not public.has_role(array['owner', 'admin']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_id is null or length(v_name) not between 1 and 100 then
    raise exception 'ERR_INVALID_INPUT' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.mosques m where m.id = p_mosque_id) then
    raise exception 'ERR_MOSQUE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.can_access_mosque(p_mosque_id)
     or not exists (select 1 from public.mosques m where m.id = p_mosque_id and m.active) then
    raise exception 'ERR_MOSQUE_NOT_ALLOWED' using errcode = '42501';
  end if;

  select name, mosque_id into v_existing from public.participants where id = p_id;
  if found then
    -- نفس العملية أُعيد إرسالها (ضاع الرد): نجاح. معرّف موجود لطفل آخر: رفض.
    if v_existing.name = v_name and v_existing.mosque_id = p_mosque_id then
      return jsonb_build_object('status', 'already_synced', 'id', p_id);
    end if;
    raise exception 'ERR_INVALID_INPUT' using errcode = 'P0001';
  end if;

  insert into public.participants (id, name, mosque_id) values (p_id, v_name, p_mosque_id);
  return jsonb_build_object('status', 'created', 'id', p_id);
end $$;

revoke execute on function public.add_participant(uuid, text, uuid) from public, anon;
grant execute on function public.add_participant(uuid, text, uuid) to authenticated;
