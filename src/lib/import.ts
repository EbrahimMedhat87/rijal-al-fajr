import { normalizeArabic } from './text'

/** أسطر العناوين/الترويسات التي نتجاهلها عند لصق كشف جاهز */
const HEADER_WORDS = new Set(['الاسم', 'اسم', 'اسم الطفل', 'الأسماء', 'الاسماء', 'م', 'name', 'names', 'م.', 'مسلسل'])
const MARKS = /[✓✗✔✘✕✖☑☒×]/g
const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g
const LETTER = /[ء-يA-Za-z]/g
const MAX_NAME = 100

function letters(s: string): number {
  return (s.match(LETTER) ?? []).length
}

/** يستخرج الاسم من سطر واحد (قد يحتوي رقمًا تسلسليًا أو علامات حضور أو أعمدة CSV) */
export function cleanNameLine(raw: string): string | null {
  let line = raw.normalize('NFKC').replace(BIDI, '').replace(MARKS, ' ').trim()
  if (!line) return null
  if (/^سجل\s/.test(line)) return null // عنوان الكشف

  // CSV/Excel: نختار الخلية الأكثر حروفًا (العمود الذي فيه الاسم)
  if (/[\t,;،|]/.test(line)) {
    const cells = line
      .split(/[\t,;،|]/)
      .map((c) => c.trim().replace(/^"|"$/g, '').trim())
      .filter(Boolean)
    if (cells.length === 0) return null
    line = cells.reduce((best, c) => (letters(c) > letters(best) ? c : best))
  }

  line = line
    .replace(/^[\s\d٠-٩]+[-.)\]:–—ـ]*\s+/, '') // ترقيم في أول السطر: "1- " "١. " "12) "
    .replace(/^[\d٠-٩]+[-.)\]:–—]+/, '') // ترقيم ملتصق: "1-أحمد"
    .replace(/\s+[\d٠-٩]+\s*$/, '') // رقم تسلسلي في آخر السطر (كشوف RTL)
    .replace(/^[-•*·▪●○\s]+/, '') // نقاط القوائم
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!line) return null
  // ترويسة جدول: كل كلماتها من كلمات العناوين ("الاسم م")
  if (HEADER_WORDS.has(line.toLowerCase()) || line.split(' ').every((w) => HEADER_WORDS.has(w.toLowerCase()))) return null
  if (letters(line) < 2) return null
  return line.slice(0, MAX_NAME)
}

/** يحوّل نصًا ملصوقًا/ملفًا إلى قائمة أسماء نظيفة بنفس ترتيبها */
export function parseNameList(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map(cleanNameLine)
    .filter((n): n is string => n !== null)
}

export type ImportStatus = 'new' | 'exists' | 'existsElsewhere' | 'similarElsewhere' | 'dupInList'

export interface ImportItem {
  name: string
  status: ImportStatus
  /** اسم المسجد الآخر إن وُجد الاسم (أو ما يشبهه) عند مسجد آخر */
  otherMosque?: string
  /** الاسم الكامل للطفل المشابه في المسجد الآخر */
  similarTo?: string
  /** معرّف الطفل في المسجد الآخر (لخيار النقل) */
  otherId?: string
}

const tokens = (s: string): string[] => normalizeArabic(s).split(' ').filter(Boolean)

export interface SimilarMatch {
  id?: string
  name: string
  mosque_id: string
}

/**
 * أطفال في مساجد أخرى "غالبًا هم نفسه": أول 3 كلمات متطابقة (بعد تطبيع الهمزات والتاء المربوطة…).
 * مثال: "إبراهيم مدحت محمد" ≈ "ابراهيم مدحت محمد رفاعي".
 * الاسم الأقصر من 3 كلمات يُقارَن بالكامل وبنفس عدد الكلمات (حتى لا يُطابق "أحمد محمد" كل من يبدأ به)،
 * فالاسم من كلمة واحدة ("سفيان") يُكشف فقط لو يوجد طفل اسمه "سفيان" بالضبط في مسجد آخر.
 */
export function findSimilarElsewhere<T extends SimilarMatch>(name: string, existing: T[], mosqueId: string): T[] {
  const t = tokens(name)
  if (t.length < 1) return []
  const k = Math.min(3, t.length)
  const head = t.slice(0, k).join(' ')
  return existing.filter((c) => {
    if (c.mosque_id === mosqueId) return false
    const ct = tokens(c.name)
    if (ct.length < k) return false
    if (t.length < 3 && ct.length !== t.length) return false
    return ct.slice(0, k).join(' ') === head
  })
}

interface ExistingChild {
  id?: string
  name: string
  mosque_id: string
}

/**
 * يصنّف كل اسم: جديد / موجود في نفس المسجد / موجود في مسجد آخر / مكرر داخل القائمة.
 * المقارنة بعد تطبيع الحروف (أحمد = احمد، ة = ه، …).
 */
export function planImport(
  names: string[],
  existing: ExistingChild[],
  mosqueId: string,
  mosqueName: (id: string) => string
): ImportItem[] {
  const same = new Set<string>()
  const other = new Map<string, { mosqueId: string; id?: string }>()
  for (const c of existing) {
    const k = normalizeArabic(c.name)
    if (c.mosque_id === mosqueId) same.add(k)
    else if (!other.has(k)) other.set(k, { mosqueId: c.mosque_id, id: c.id })
  }
  const seen = new Set<string>()
  return names.map((name) => {
    const k = normalizeArabic(name)
    if (seen.has(k)) return { name, status: 'dupInList' as const }
    seen.add(k)
    if (same.has(k)) return { name, status: 'exists' as const }
    const o = other.get(k)
    if (o) return { name, status: 'existsElsewhere' as const, otherMosque: mosqueName(o.mosqueId), otherId: o.id }
    const sim = findSimilarElsewhere(name, existing, mosqueId)[0]
    if (sim) return { name, status: 'similarElsewhere' as const, otherMosque: mosqueName(sim.mosque_id), similarTo: sim.name, otherId: sim.id }
    return { name, status: 'new' as const }
  })
}
