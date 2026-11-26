export type Role = 'owner' | 'admin' | 'recorder'

export interface Campaign {
  id: string
  name: string
  start_date: string // YYYY-MM-DD
  timezone: string
  status: 'active' | 'closed'
}

export interface Participant {
  id: string
  name: string
  active: boolean
}

export interface Profile {
  user_id: string
  display_name: string
  role: Role
  active: boolean
}

export type OpStatus = 'pending' | 'syncing' | 'synced' | 'failed'
export type ServerResult = 'created' | 'already_synced' | 'already_recorded'

/** عملية حضور محفوظة على الجهاز (طابور المزامنة) */
export interface QueuedOp {
  opId: string // client_op_id (UUID)
  userId: string // الحساب الذي سجّل (للنسب الصحيح عند المزامنة)
  participantId: string
  date: string // YYYY-MM-DD بتوقيت المبادرة
  deviceCreatedAt: string // ISO
  status: OpStatus
  attempts: number
  errorCode?: string
  serverResult?: ServerResult
  updatedAt: number // ms
}

/** حضور معروف من الخادم لتاريخ معيّن (كاش للقراءة بدون إنترنت) */
export interface CachedAttendance {
  key: string // `${date}|${participantId}`
  date: string
  participantId: string
}

export interface MetaRow {
  key: string
  value: unknown
}

export interface RankedRow {
  participantId: string
  name: string
  active: boolean
  days: number
  rank: number | null // null = بدون حضور في الفترة (غير مُرتَّب)
}

export type PeriodKind = 'day' | 'month' | 'quarter' | 'all'
export interface DateRange {
  from: string
  to: string
}
