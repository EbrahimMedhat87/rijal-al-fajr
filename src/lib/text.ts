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

export function matchesQuery(name: string, query: string): boolean {
  const q = normalizeArabic(query)
  return q === '' || normalizeArabic(name).includes(q)
}
