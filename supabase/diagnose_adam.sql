-- تشخيص (قراءة فقط — لا يغيّر شيئًا). شغّله في Supabase → SQL Editor وابعتلي النتيجة لو لسه فيه لخبطة.

-- 1) كل الأطفال اللي اسمهم فيه "آدم": المسجد، الرقم، وكام يوم حضور صالح/ملغي لكل واحد
select m.name as mosque, p.child_no, p.name, p.active,
       (select count(*) from public.attendance a where a.participant_id = p.id and a.status = 'valid') as valid_days,
       (select count(*) from public.attendance a where a.participant_id = p.id and a.status = 'void')  as voided_days,
       p.id
  from public.participants p join public.mosques m on m.id = p.mosque_id
 where public.norm_ar(p.name) like '%ادم%'
 order by m.name, p.child_no;

-- 2) أي أسماء لسه بادئة برقم (أرقام كشف قديمة جوه الاسم)
select m.name as mosque, count(*) as kids_with_number_prefix
  from public.participants p join public.mosques m on m.id = p.mosque_id
 where p.name ~ '^\s*[0-9٠-٩]+'
 group by m.name;

-- 3) أسماء مكررة تمامًا داخل نفس المسجد
select m.name as mosque, public.norm_ar(p.name) as norm_name, count(*) as copies
  from public.participants p join public.mosques m on m.id = p.mosque_id
 group by m.name, public.norm_ar(p.name) having count(*) > 1 order by copies desc;
