import { describe, expect, it } from 'vitest'
import { toCsv } from '../src/lib/csv'

describe('toCsv', () => {
  it('يبدأ بـ BOM ويحفظ العربية كما هي', () => {
    const out = toCsv(['الاسم', 'الأيام'], [['أحمد', 12]])
    expect(out.charCodeAt(0)).toBe(0xfeff)
    expect(out).toContain('الاسم,الأيام')
    expect(out).toContain('أحمد,12')
  })
  it('فواصل الأسطر CRLF وينتهي بسطر جديد', () => {
    const out = toCsv(['a'], [['1'], ['2']])
    expect(out.slice(1)).toBe('a\r\n1\r\n2\r\n')
  })
  it('يهرّب الفواصل وعلامات الاقتباس والأسطر الجديدة', () => {
    const out = toCsv(['n'], [['أحمد, محمد'], ['قال "نعم"'], ['سطر1\nسطر2']])
    expect(out).toContain('"أحمد, محمد"')
    expect(out).toContain('"قال ""نعم"""')
    expect(out).toContain('"سطر1\nسطر2"')
  })
  it('يمنع حقن المعادلات في Excel', () => {
    const out = toCsv(['n'], [['=HYPERLINK("http://x")'], ['+1'], ['-1+1'], ['@SUM(A1)']])
    expect(out).toContain("'=HYPERLINK")
    expect(out).toContain("'+1")
    expect(out).toContain("'-1+1")
    expect(out).toContain("'@SUM(A1)")
  })
  it('الأرقام السالبة الحقيقية (number) لا تُعدَّل، والقيم الفارغة تصبح خلية فارغة', () => {
    const out = toCsv(['a', 'b'], [[-5, null], [undefined, 0]])
    expect(out).toContain('-5,')
    expect(out).toContain(',0')
  })
})
