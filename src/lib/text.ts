/** تطبيع النص العربي للبحث: يتجاهل التشكيل والهمزات وفروق الألف المقصورة/التاء المربوطة */
export function normalizeArabic(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '') // تشكيل + تطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** هل النص كله أرقام (عربية أو إنجليزية)؟ — يعني أن المستخدم يبحث برقم الطفل */
export function isNumericQuery(query: string): boolean {
  return /^\d+$/.test(normalizeArabic(query))
}

/** بحث بالاسم، أو برقم الطفل لو كتب أرقامًا فقط ("5" ⇒ الطفل رقم 5 وكل رقم يبدأ بـ 5) */
export function matchesQuery(name: string, query: string, childNo?: number | null): boolean {
  const q = normalizeArabic(query)
  if (q === '') return true
  if (/^\d+$/.test(q) && childNo != null && String(childNo).startsWith(q)) return true
  return normalizeArabic(name).includes(q)
}

/** ترتيب نتائج البحث بالرقم: الرقم المطابق تمامًا أولًا ثم الأصغر */
export function compareByNumberQuery(query: string, a: { child_no?: number | null }, b: { child_no?: number | null }): number {
  const q = normalizeArabic(query)
  const ea = a.child_no != null && String(a.child_no) === q ? 0 : 1
  const eb = b.child_no != null && String(b.child_no) === q ? 0 : 1
  return ea - eb || (a.child_no ?? 0) - (b.child_no ?? 0)
}
