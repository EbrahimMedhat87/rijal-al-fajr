import { describe, expect, it } from 'vitest'
import { classifyError } from '../src/lib/backend'

describe('classifyError', () => {
  it('أخطاء قاعدة البيانات المنطقية نهائية (ليست transient)', () => {
    const e = classifyError({ message: 'ERR_DATE_IN_FUTURE', code: 'P0001' }, 400)
    expect(e).toMatchObject({ code: 'ERR_DATE_IN_FUTURE', transient: false })
  })
  it('ERR_NOT_AUTHORIZED نهائي', () => {
    expect(classifyError({ message: 'ERR_NOT_AUTHORIZED', code: '42501' }, 403)).toMatchObject({ transient: false })
  })
  it('انقطاع الشبكة transient', () => {
    expect(classifyError({ message: 'TypeError: Failed to fetch' }, 0)).toMatchObject({ code: 'NETWORK', transient: true })
    expect(classifyError(null, undefined)).toMatchObject({ code: 'NETWORK', transient: true })
  })
  it('أخطاء الخادم 5xx و429 transient', () => {
    expect(classifyError({ message: 'oops' }, 503)).toMatchObject({ transient: true })
    expect(classifyError({ message: 'slow down' }, 429)).toMatchObject({ transient: true })
  })
  it('انتهاء الجلسة transient (لا نفقد العملية، المنظم يعيد الدخول)', () => {
    expect(classifyError({ message: 'JWT expired', code: 'PGRST301' }, 401)).toMatchObject({ code: 'AUTH_EXPIRED', transient: true })
  })
  it('خطأ 4xx غير معروف نهائي كي لا تُعاد المحاولة للأبد', () => {
    expect(classifyError({ message: 'weird' }, 400)).toMatchObject({ code: 'ERR_UNKNOWN', transient: false })
  })
})
