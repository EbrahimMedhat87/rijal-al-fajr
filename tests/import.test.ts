import { describe, expect, it } from 'vitest'
import sheetNormalized from './fixtures/bahari-sheet.txt?raw'
import sheetRaw from './fixtures/bahari-sheet-raw.txt?raw'
import { cleanNameLine, findSimilarElsewhere, parseNameList, planImport } from '../src/lib/import'

describe('cleanNameLine', () => {
  it('يشيل الترقيم بأشكاله', () => {
    expect(cleanNameLine('1- أحمد محمد')).toBe('أحمد محمد')
    expect(cleanNameLine('١. أحمد محمد')).toBe('أحمد محمد')
    expect(cleanNameLine('12) أحمد محمد')).toBe('أحمد محمد')
    expect(cleanNameLine('3-أحمد محمد')).toBe('أحمد محمد')
    expect(cleanNameLine('• أحمد محمد')).toBe('أحمد محمد')
    expect(cleanNameLine('أحمد محمد   ٧')).toBe('أحمد محمد')
  })
  it('يتجاهل الترويسات والأسطر الفاضية والأرقام وحدها', () => {
    for (const s of ['', '   ', 'الاسم', 'م', '١٢', '✓ ✗ ✓', 'سجل الغياب  -أسرة الفجر  -مسجد البحري']) expect(cleanNameLine(s)).toBeNull()
  })
  it('CSV: يأخذ عمود الاسم', () => {
    expect(cleanNameLine('1,أحمد محمد علي,01012345678')).toBe('أحمد محمد علي')
    expect(cleanNameLine('أحمد محمد\t5\t✓')).toBe('أحمد محمد')
    expect(cleanNameLine('"محمد علي"')).toBe('محمد علي')
  })
  it('يحوّل أشكال العرض العربية للحروف العادية ويشيل علامات الاتجاه', () => {
    expect(cleanNameLine('‫ﺃﺣﻤﺪ ﻣﺤﻤﺪ‬')).toBe('أحمد محمد')
  })
  it('لا يمسّ الأسماء العادية ولا يقصّ أجزاءها', () => {
    expect(cleanNameLine('عبد الرحمن أحمد زكريا')).toBe('عبد الرحمن أحمد زكريا')
    expect(cleanNameLine('محمد أحمد - ع')).toBe('محمد أحمد - ع')
  })
  it('يقصّ الأسماء الطويلة جدًا عند 100 حرف', () => {
    expect(cleanNameLine('أ'.repeat(300))!.length).toBe(100)
  })
})

describe('كشف مسجد البحري الحقيقي (مستخرج من الـ PDF)', () => {
  const names = parseNameList(sheetNormalized)
  it('يستخرج 79 اسمًا بالترتيب بدون ترويسات ولا أرقام', () => {
    expect(names).toHaveLength(79)
    expect(names[0]).toBe('إبراهيم سامي الأهدل')
    expect(names[78]).toBe('يوسف محمد مختار عساف')
    expect(names.every((n) => !/[\d٠-٩✓✗]/.test(n))).toBe(true)
    expect(new Set(names).size).toBe(79)
  })
  it('يعمل أيضًا على النص الخام (بأشكال العرض واتجاه الكتابة)', () => {
    const raw = parseNameList(sheetRaw)
    expect(raw).toEqual(names)
  })
})

describe('planImport', () => {
  const mname = (id: string) => (id === 'b' ? 'مسجد ب' : 'مسجد أ')
  const existing = [
    { name: 'أحمد محمد', mosque_id: 'a' },
    { name: 'خالد سعيد', mosque_id: 'b' }
  ]
  it('يميّز الجديد والموجود والمكرر', () => {
    const r = planImport(['احمد محمد', 'خالد سعيد', 'علي حسن', 'علي  حسن', 'علي حسن'], existing, 'a', mname)
    expect(r.map((x) => x.status)).toEqual(['exists', 'existsElsewhere', 'new', 'dupInList', 'dupInList'])
    expect(r[1].otherMosque).toBe('مسجد ب')
  })
  it('نفس الاسم في مسجد آخر لا يُعد تكرارًا داخل نفس المسجد', () => {
    expect(planImport(['أحمد محمد'], existing, 'b', mname)[0].status).toBe('existsElsewhere')
  })
})

describe('findSimilarElsewhere (أول 3 كلمات)', () => {
  const ex = [
    { name: 'ابراهيم مدحت محمد رفاعي', mosque_id: 'b' },
    { name: 'أحمد محمد', mosque_id: 'b' },
    { name: 'محمود حسن علي سالم', mosque_id: 'a' }
  ]
  it('المثال المطلوب: إبراهيم مدحت محمد ≈ ابراهيم مدحت محمد رفاعي (الهمزة لا تفرق)', () => {
    const r = findSimilarElsewhere('إبراهيم مدحت محمد', ex, 'a')
    expect(r.map((x) => x.name)).toEqual(['ابراهيم مدحت محمد رفاعي'])
  })
  it('الاسم الأطول يُقارَن بأول 3 كلمات فقط', () => {
    expect(findSimilarElsewhere('ابراهيم مدحت محمد عبد الله', ex, 'a')).toHaveLength(1)
  })
  it('أول كلمتين فقط متطابقتين لا تكفي', () => {
    expect(findSimilarElsewhere('ابراهيم مدحت علي', ex, 'a')).toHaveLength(0)
  })
  it('لا يعتبر نفس المسجد', () => {
    expect(findSimilarElsewhere('محمود حسن علي', ex, 'a')).toHaveLength(0)
    expect(findSimilarElsewhere('محمود حسن علي', ex, 'b')).toHaveLength(1)
  })
  it('كلمة واحدة لا تُقارَن، وكلمتان تُقارَنان بالكامل فقط', () => {
    expect(findSimilarElsewhere('أحمد', ex, 'a')).toHaveLength(0)
    expect(findSimilarElsewhere('احمد محمد', ex, 'a')).toHaveLength(1)
    expect(findSimilarElsewhere('احمد محمد علي', ex, 'a')).toHaveLength(0)
  })
  it('planImport يعلّم المشابه عند مسجد آخر ويذكر الاسم الكامل والمسجد', () => {
    const r = planImport(['إبراهيم مدحت محمد'], ex, 'a', (id) => (id === 'b' ? 'مسجد ب' : 'مسجد أ'))
    expect(r[0]).toMatchObject({ status: 'similarElsewhere', otherMosque: 'مسجد ب', similarTo: 'ابراهيم مدحت محمد رفاعي' })
  })
})

describe('planImport: معرّف الطفل في المسجد الآخر (لخيار النقل)', () => {
  it('existsElsewhere و similarElsewhere يحملان otherId', () => {
    const existing = [
      { id: 'c1', name: 'أحمد محمد علي', mosque_id: 'B' },
      { id: 'c2', name: 'إبراهيم مدحت محمد رفاعي', mosque_id: 'B' }
    ]
    const r = planImport(['احمد محمد علي', 'ابراهيم مدحت محمد'], existing, 'A', () => 'مسجد ب')
    expect(r[0]).toMatchObject({ status: 'existsElsewhere', otherId: 'c1' })
    expect(r[1]).toMatchObject({ status: 'similarElsewhere', otherId: 'c2' })
  })
})
