const MESSAGES: Record<string, string> = {
  NETWORK: 'لا يوجد اتصال بالإنترنت أو الخادم لا يستجيب',
  AUTH_EXPIRED: 'انتهت الجلسة — سجّل الدخول مرة أخرى لإكمال المزامنة',
  ERR_NOT_AUTHORIZED: 'ليست لديك صلاحية لهذا الإجراء',
  ERR_DATE_IN_FUTURE: 'لا يمكن تسجيل حضور في تاريخ مستقبلي',
  ERR_BEFORE_CAMPAIGN_START: 'التاريخ قبل بداية المبادرة',
  ERR_DATE_NOT_ALLOWED: 'المسجِّل يستطيع التسجيل لليوم أو أمس فقط',
  ERR_PARTICIPANT_NOT_FOUND: 'الطفل غير موجود',
  ERR_MOSQUE_NOT_ALLOWED: 'هذا الطفل ليس في مسجد مربوط بحسابك',
  ERR_MOSQUE_NOT_FOUND: 'المسجد غير موجود',
  ERR_NO_ACTIVE_CAMPAIGN: 'لا توجد مبادرة نشطة — يجب إعدادها من المالك',
  ERR_REASON_REQUIRED: 'سبب الإبطال مطلوب',
  ERR_ATTENDANCE_ALREADY_VOID: 'هذا السجل مُبطَل بالفعل',
  ERR_ATTENDANCE_NOT_FOUND: 'سجل الحضور غير موجود',
  ERR_LAST_OWNER: 'لا يمكن إيقاف أو خفض آخر مالك',
  ERR_AUTH_USER_NOT_FOUND: 'لا يوجد حساب بهذا البريد — لازم المنظم ينشئ حسابه الأول من شاشة الدخول (منظم جديد؟ أنشئ حسابك)',
  ERR_INVALID_ROLE: 'دور غير صالح',
  ERR_INVALID_INPUT: 'بيانات غير صالحة',
  ERR_DUPLICATE_NAME: 'الاسم موجود بالفعل في هذا المسجد — لو طفل آخر بنفس الاسم أضف حرفًا مميزًا (مثال: محمد أحمد - ع)',
  ERR_USER_NOT_FOUND: 'المستخدم غير موجود',
  ERR_CONFIRM_MISMATCH: 'اسم المسجد المكتوب غير مطابق — اكتبه زي ما هو بالظبط',
  ERR_START_DATE_AFTER_ATTENDANCE: 'لا يمكن تأخير تاريخ البداية بعد سجلات حضور موجودة',
  ERR_CHILD_NOT_SAVED: 'الطفل نفسه لم يُقبَل من الخادم، فلم يُرسَل حضوره',
  ERR_UNKNOWN: 'خطأ غير متوقع'
}

export function arabicError(code: string | undefined | null, fallback?: string): string {
  if (code && MESSAGES[code]) return MESSAGES[code]
  return fallback ?? MESSAGES.ERR_UNKNOWN
}

/** يستخرج رمز ERR_* أو رسالة مفهومة من أي خطأ قادم من supabase-js */
export function errorToArabic(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e)
  const m = /\bERR_[A-Z_]+\b/.exec(msg)
  if (m) return arabicError(m[0])
  if (/not recognized/i.test(msg)) return 'اسم المنطقة الزمنية غير صحيح (مثال: Africa/Cairo)'
  if (/failed to fetch|network|load failed/i.test(msg)) return MESSAGES.NETWORK
  if (/participants_mosque_child_no_key/.test(msg)) return 'الرقم ده مستخدم لطفل آخر في نفس المسجد'
  if (/duplicate key/i.test(msg)) return 'الاسم مستخدم من قبل'
  if (/row-level security|permission denied/i.test(msg)) return MESSAGES.ERR_NOT_AUTHORIZED
  return 'حدث خطأ غير متوقع، حاول مرة أخرى'
}
