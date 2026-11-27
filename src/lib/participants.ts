import { db } from './db'
import { useLive } from './hooks'
import { useSync } from './sync-context'
import type { Participant } from './types'

export type LocalParticipant = Participant & { pending?: boolean }

/** الأطفال المخزنون + الأطفال التي أضافها هذا المستخدم على هذا الجهاز وتنتظر الإرسال (علامة pending) */
export async function readAllParticipants(userId: string): Promise<LocalParticipant[]> {
  const [rows, queued] = await Promise.all([
    db.participants.toArray(),
    db.newChildren.where('status').anyOf('pending', 'syncing').toArray()
  ])
  const ids = new Set(rows.map((p) => p.id))
  return [
    ...rows,
    ...queued
      .filter((c) => c.userId === userId && !ids.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, active: true, mosque_id: c.mosque_id, pending: true }))
  ]
}

export function useAllParticipants(): LocalParticipant[] | undefined {
  const { userId } = useSync()
  return useLive(() => readAllParticipants(userId), [userId])
}
