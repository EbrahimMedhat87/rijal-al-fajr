-- (اختياري) تنظيف الأرقام اللي لسه بادئة بها الأسماء بعد تشغيل 0006
-- يشيل الرقم من أول الاسم فقط. شغّل الاستعلام 2 في diagnose_adam.sql الأول وشوف العدد.
update public.participants
   set name = btrim(regexp_replace(name, '^\s*[0-9٠-٩]+[\s.\-)\]:]*', ''))
 where name ~ '^\s*[0-9٠-٩]+'
   and length(btrim(regexp_replace(name, '^\s*[0-9٠-٩]+[\s.\-)\]:]*', ''))) >= 2;
