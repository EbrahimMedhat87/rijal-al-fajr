// طبقة الوصول للبيانات: كل استدعاءات Supabase هنا. الأخطاء ترفع Error ليتعامل معها المستدعي.
import type { PostgrestError } from '@supabase/supabase-js'
import { db, getMeta, replaceAttendanceCache, replaceParticipants, setMeta } from './db'
import { supabase } from './supabase'
import type { Campaign, DateRange, Participant, Profile, Role } from './types'

function check<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw res.error
  return res.data as T
}

const PAGE = 1000
/** يجلب كل الصفوف على صفحات (حد PostgREST الافتراضي 1000 صف) */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const rows = check(await build(from, from + PAGE - 1)) ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

// ---------------- الملف الشخصي والإعدادات ----------------
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const res = await supabase.from('profiles').select('user_id, display_name, role, active').eq('user_id', userId).maybeSingle()
  return check(res) as Profile | null
}

export async function fetchCampaign(): Promise<Campaign | null> {
  const res = await supabase.from('campaigns').select('id, name, start_date, timezone, status').eq('status', 'active').maybeSingle()
  const c = check(res) as Campaign | null
  if (c) await setMeta(db, 'campaign', c)
  return c
}

export const cachedCampaign = () => getMeta<Campaign>(db, 'campaign')

// ---------------- الأطفال والحضور (مع الكاش المحلي) ----------------
export async function refreshParticipants(): Promise<void> {
  const rows = await fetchAll<Participant>((f, t) =>
    supabase.from('participants').select('id, name, active').order('name').range(f, t)
  )
  await replaceParticipants(db, rows)
  await setMeta(db, 'participantsSyncedAt', Date.now())
}

export async function refreshAttendanceDate(date: string): Promise<void> {
  const rows = await fetchAll<{ participant_id: string }>((f, t) =>
    supabase.from('attendance').select('participant_id').eq('attendance_date', date).eq('status', 'valid').range(f, t)
  )
  await replaceAttendanceCache(db, date, rows.map((r) => r.participant_id))
}

export async function addParticipant(name: string): Promise<void> {
  check(await supabase.from('participants').insert({ name: name.trim() }).select('id').single())
  await refreshParticipants()
}

export async function updateParticipant(id: string, patch: { name?: string; active?: boolean }): Promise<void> {
  const res = await supabase.from('participants').update(patch).eq('id', id).select('id')
  const rows = check(res) as { id: string }[]
  if (!rows || rows.length === 0) throw new Error('permission denied')
  await refreshParticipants()
}

// ---------------- الترتيب والتقارير ----------------
export interface CountRowDb {
  participant_id: string
  name: string
  active: boolean
  days: number
}

export async function fetchCounts(range: DateRange): Promise<CountRowDb[]> {
  const res = await supabase.rpc('attendance_counts', { p_from: range.from, p_to: range.to })
  return (check(res) ?? []).map((r: CountRowDb) => ({ ...r, days: Number(r.days) }))
}

export interface AttendanceRowDb {
  id: string
  participant_id: string
  attendance_date: string
  status: 'valid' | 'void'
  recorded_by: string
  recorded_at: string
  void_reason: string | null
}

export async function fetchAttendanceRange(range: DateRange): Promise<AttendanceRowDb[]> {
  return fetchAll<AttendanceRowDb>((f, t) =>
    supabase
      .from('attendance')
      .select('id, participant_id, attendance_date, status, recorded_by, recorded_at, void_reason')
      .gte('attendance_date', range.from)
      .lte('attendance_date', range.to)
      .order('attendance_date')
      .order('recorded_at')
      .range(f, t)
  )
}

export async function fetchParticipantHistory(participantId: string, limit: number): Promise<AttendanceRowDb[]> {
  const res = await supabase
    .from('attendance')
    .select('id, participant_id, attendance_date, status, recorded_by, recorded_at, void_reason')
    .eq('participant_id', participantId)
    .order('attendance_date', { ascending: false })
    .order('recorded_at', { ascending: false })
    .limit(limit)
  return check(res) as AttendanceRowDb[]
}

export async function countValidDays(participantId: string, range: DateRange): Promise<number> {
  const res = await supabase
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('participant_id', participantId)
    .eq('status', 'valid')
    .gte('attendance_date', range.from)
    .lte('attendance_date', range.to)
  if (res.error) throw res.error
  return res.count ?? 0
}

export async function voidAttendance(attendanceId: string, reason: string): Promise<void> {
  check(await supabase.rpc('void_attendance', { p_attendance_id: attendanceId, p_reason: reason }))
}

export async function fetchProfileNames(): Promise<Record<string, string>> {
  const rows = check(await supabase.from('profiles').select('user_id, display_name')) as { user_id: string; display_name: string }[]
  return Object.fromEntries(rows.map((r) => [r.user_id, r.display_name]))
}

// ---------------- الإدارة ----------------
export interface UserRow {
  user_id: string
  email: string | null
  display_name: string
  role: Role
  active: boolean
}

export async function listUsers(): Promise<UserRow[]> {
  return (check(await supabase.rpc('owner_list_users')) ?? []) as UserRow[]
}

export async function upsertUser(email: string, displayName: string, role: Role, active: boolean): Promise<void> {
  check(await supabase.rpc('owner_upsert_user', { p_email: email, p_display_name: displayName, p_role: role, p_active: active }))
}

export async function updateCampaign(name: string, startDate: string, timezone: string): Promise<void> {
  check(await supabase.rpc('owner_update_campaign', { p_name: name, p_start_date: startDate, p_timezone: timezone }))
  await fetchCampaign()
}

export interface AuditRow {
  id: number
  occurred_at: string
  actor_id: string | null
  action: string
  entity: string
  entity_id: string | null
  details: Record<string, unknown>
}

export async function fetchAudit(limit = 100): Promise<AuditRow[]> {
  const res = await supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(limit)
  return check(res) as AuditRow[]
}
