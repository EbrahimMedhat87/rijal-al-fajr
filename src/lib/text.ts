/** تطبيع النص العربي للبحث: يتجاهل التشكيل والهمزات وفروق الألف المقصورة/التاء المربوطة */
export function normalizeArabic(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '') // تشكيل + تطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(^| )عبد +/g, '$1عبد') // "عبد الرحمن" = "عبدالرحمن"
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

export type SortMode = 'no' | 'name'

interface Sortable {
  name: string
  child_no?: number | null
  mosque_id: string
}

/**
 * ترتيب قائمة الأطفال: افتراضيًا بالرقم (1، 2، 3 …) داخل كل مسجد، والأطفال بلا رقم (لم يُرسَلوا بعد) في الآخر؛ أو أبجديًا.
 * لو المستخدم يبحث برقم: المطابق تمامًا أولًا.
 */
export function compareChildren(a: Sortable, b: Sortable, mode: SortMode, query: string, mosqueName: (id: string) => string): number {
  if (isNumericQuery(query)) {
    const c = compareByNumberQuery(query, a, b)
    if (c) return c
  }
  if (mode === 'no') {
    if (a.mosque_id !== b.mosque_id) return mosqueName(a.mosque_id).localeCompare(mosqueName(b.mosque_id), 'ar')
    const an = a.child_no ?? Number.MAX_SAFE_INTEGER
    const bn = b.child_no ?? Number.MAX_SAFE_INTEGER
    if (an !== bn) return an - bn
  }
  return a.name.localeCompare(b.name, 'ar')
}

/** ترتيب نتائج البحث بالرقم: الرقم المطابق تمامًا أولًا ثم الأصغر */
export function compareByNumberQuery(query: string, a: { child_no?: number | null }, b: { child_no?: number | null }): number {
  const q = normalizeArabic(query)
  const ea = a.child_no != null && String(a.child_no) === q ? 0 : 1
  const eb = b.child_no != null && String(b.child_no) === q ? 0 : 1
  return ea - eb || (a.child_no ?? 0) - (b.child_no ?? 0)
}
