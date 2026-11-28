-- 0009: (1) تطبيع أقوى للأسماء  (2) حذف كل أطفال مسجد دفعة واحدة  (3) إزالة منظم/مشرف

-- (1) نفس التطبيع الذي في التطبيق: التشكيل، الهمزات (أ إ آ ٱ → ا)، ى→ي، ة→ه، ؤ→و، ئ→ي،
--     و"عبد الرحمن" = "عبدالرحمن" (المسافة بعد "عبد" تُحذف)
create or replace function public.norm_ar(s text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(
    btrim(regexp_replace(
      translate(lower(regexp_replace(coalesce(s, ''), '[ً-ٰٟـ]', '', 'g')), 'أإآٱىةؤئ', 'اااايهوي'),
      '\s+', ' ', 'g')),
    '(^| )عبد +', '\1عبد', 'g')
$$;

-- (2) حذف كل أطفال مسجد (المالك فقط) مع كل سجلات حضورهم. المسجد نفسه والمنظمون يبقون.
--     p_dry_run = true (الافتراضي): يرجع الأعداد فقط بدون حذف. للحذف الفعلي لازم p_confirm_name = اسم المسجد بالضبط.
create function public.delete_mosque_children(p_mosque_id uuid, p_confirm_name text default null, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_mosque public.mosques%rowtype;
  v_children integer;
  v_valid integer;
  v_void integer;
  v_snapshot jsonb;
begin
  if not public.has_role(array['owner']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_mosque from public.mosques where id = p_mosque_id;
  if not found then
    raise exception 'ERR_MOSQUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(*) into v_children from public.participants where mosque_id = p_mosque_id;
  select count(*) filter (where a.status = 'valid'), count(*) filter (where a.status = 'void')
    into v_valid, v_void
    from public.attendance a join public.participants p on p.id = a.participant_id
   where p.mosque_id = p_mosque_id;

  if p_dry_run then
    return jsonb_build_object('status', 'dry_run', 'mosque', v_mosque.name, 'children', v_children,
                              'attendance_valid', v_valid, 'attendance_void', v_void);
  end if;

  if btrim(coalesce(p_confirm_name, '')) <> btrim(v_mosque.name) then
    raise exception 'ERR_CONFIRM_MISMATCH' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'child_no', p.child_no,
           'valid_days', (select count(*) from public.attendance a where a.participant_id = p.id and a.status = 'valid'))
           order by p.child_no), '[]'::jsonb)
    into v_snapshot from public.participants p where p.mosque_id = p_mosque_id;

  perform set_config('app.allow_participant_delete', 'on', true);
  delete from public.attendance where participant_id in (select id from public.participants where mosque_id = p_mosque_id);
  perform set_config('app.allow_participant_delete', 'off', true);
  delete from public.participants where mosque_id = p_mosque_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'mosque.delete_children', 'mosques', p_mosque_id::text,
          jsonb_build_object('mosque', v_mosque.name, 'children', v_children,
                             'attendance_valid', v_valid, 'attendance_void', v_void, 'snapshot', v_snapshot));
  return jsonb_build_object('status', 'deleted', 'mosque', v_mosque.name, 'children', v_children,
                            'attendance_valid', v_valid, 'attendance_void', v_void);
end $$;

-- (3) إزالة منظم (المالك فقط): يفكّ ربطه بكل المساجد، ولو ليس له سجل (لم يسجّل حضورًا ولم يضف أطفالًا)
--     يُحذف حسابه نهائيًا؛ ولو له سجل يُوقَف فقط (حتى لا يضيع من سجّل الحضور) ولا يستطيع استخدام النظام.
create function public.owner_remove_user(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile public.profiles%rowtype;
  v_history boolean;
  v_email text;
begin
  if not public.has_role(array['owner']) then
    raise exception 'ERR_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'ERR_INVALID_INPUT' using errcode = 'P0001';
  end if;
  select * into v_profile from public.profiles where user_id = p_user_id;
  if not found then
    raise exception 'ERR_USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_profile.role = 'owner' then
    raise exception 'ERR_INVALID_INPUT' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = p_user_id;

  v_history := exists (select 1 from public.participants where created_by = p_user_id)
            or exists (select 1 from public.attendance where recorded_by = p_user_id or voided_by = p_user_id);

  delete from public.user_mosques where user_id = p_user_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'user.remove', 'profiles', p_user_id::text,
          jsonb_build_object('name', v_profile.display_name, 'email', v_email, 'role', v_profile.role, 'had_history', v_history));

  if v_history then
    update public.profiles set active = false where user_id = p_user_id;
    return jsonb_build_object('status', 'deactivated');
  end if;
  delete from auth.users where id = p_user_id;
  return jsonb_build_object('status', 'deleted');
end $$;

revoke execute on function public.delete_mosque_children(uuid, text, boolean), public.owner_remove_user(uuid) from public, anon;
grant execute on function public.delete_mosque_children(uuid, text, boolean), public.owner_remove_user(uuid) to authenticated;
