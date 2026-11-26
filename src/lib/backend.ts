import type { SupabaseClient } from '@supabase/supabase-js'
import { BackendError, type AttendanceBackend, type RecordInput, type RecordResult } from './sync'

interface PgError {
  message?: string
  code?: string
}

/** يحوّل خطأ PostgREST/الشبكة إلى BackendError (transient أو نهائي) */
export function classifyError(error: PgError | null | undefined, status?: number): BackendError {
  const msg = error?.message ?? ''
  const m = /\bERR_[A-Z_]+\b/.exec(msg)
  if (m) return new BackendError(m[0], false, msg) // خطأ منطقي من دوال قاعدة البيانات

  if (status === 401 || error?.code === 'PGRST301' || /jwt/i.test(msg)) {
    return new BackendError('AUTH_EXPIRED', true, msg) // الجلسة تحتاج تجديد/دخول — لا نفقد شيئًا
  }
  if (!status || status === 408 || status === 429 || status >= 500 || /failed to fetch|network|load failed|timeout/i.test(msg)) {
    return new BackendError('NETWORK', true, msg)
  }
  if (error?.code === '42501' || status === 403) return new BackendError('ERR_NOT_AUTHORIZED', false, msg)
  return new BackendError('ERR_UNKNOWN', false, msg)
}

export function createSupabaseBackend(client: SupabaseClient): AttendanceBackend {
  return {
    async record(input: RecordInput): Promise<RecordResult> {
      let res
      try {
        res = await client.rpc('record_attendance', {
          p_client_op_id: input.opId,
          p_participant_id: input.participantId,
          p_date: input.date,
          p_device_created_at: input.deviceCreatedAt
        })
      } catch (e) {
        throw new BackendError('NETWORK', true, String(e))
      }
      if (res.error) throw classifyError(res.error, res.status)
      const data = res.data as { status: RecordResult['status']; attendance_id?: string } | null
      if (!data?.status) throw new BackendError('NETWORK', true, 'empty response')
      return { status: data.status, attendanceId: data.attendance_id }
    }
  }
}
