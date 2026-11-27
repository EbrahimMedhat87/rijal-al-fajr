-- 0008: منع تكرار نفس الاسم داخل المسجد الواحد (بعد تطبيع الهمزات والتاء المربوطة…)
-- يُطبَّق فقط عند إضافة طفل أو تغيير اسمه/مسجده، فلا يمس التكرارات القديمة الموجودة (يمكن إيقافها أو تعديلها).
-- "أحمد محمد" و"احمد محمد" يُعتبران نفس الاسم؛ لو طفلان بنفس الاسم فعلًا يُضاف حرف مميز: "أحمد محمد - ع".

create function public.participants_unique_name() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.mosque_id is not distinct from old.mosque_id then
    return new;
  end if;
  if exists (
    select 1 from public.participants p
     where p.mosque_id = new.mosque_id and p.id <> new.id and public.norm_ar(p.name) = public.norm_ar(new.name)
  ) then
    raise exception 'ERR_DUPLICATE_NAME' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger participants_unique_name_trg
  before insert or update of name, mosque_id on public.participants
  for each row execute function public.participants_unique_name();

-- كشف التكرار بين المساجد: الاسم الكامل المطابق يُكشف حتى لو كلمة واحدة ("سفيان")
-- (الاسم الأقصر من 3 كلمات يُقارَن بالكامل وبنفس عدد الكلمات؛ من 3 كلمات فأكثر: أول 3 كلمات)
create or replace function public.find_similar_children(p_names text[], p_mosque_id uuid)
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
      select idx, t, cardinality(t) as n, least(3, cardinality(t)) as k from q where cardinality(t) >= 1 and t[1] <> ''
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
