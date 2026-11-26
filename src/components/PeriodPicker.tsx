import { Chip, Field, inputClass } from './ui'
import { arabicMonthName, arabicQuarterName } from '../lib/dates'
import type { PeriodState } from '../lib/periods'
import type { PeriodKind } from '../lib/types'

const KIND_LABEL: Record<PeriodKind, string> = { day: 'يومي', month: 'شهري', quarter: 'ربع سنوي', all: 'منذ البداية' }

export default function PeriodPicker({
  value,
  onChange,
  kinds,
  minDate,
  maxDate
}: {
  value: PeriodState
  onChange: (p: PeriodState) => void
  kinds: PeriodKind[]
  minDate?: string
  maxDate?: string
}) {
  const years = (() => {
    const from = Number((minDate ?? `${value.year}`).slice(0, 4))
    const to = Number((maxDate ?? `${value.year}`).slice(0, 4))
    const out: number[] = []
    for (let y = Math.min(from, value.year); y <= Math.max(to, value.year); y++) out.push(y)
    return out
  })()

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {kinds.map((k) => (
          <Chip key={k} active={value.kind === k} onClick={() => onChange({ ...value, kind: k })}>
            {KIND_LABEL[k]}
          </Chip>
        ))}
      </div>

      {value.kind === 'day' && (
        <Field label="اليوم">
          <input
            type="date"
            dir="ltr"
            className={inputClass}
            value={value.day}
            min={minDate}
            max={maxDate}
            onChange={(e) => e.target.value && onChange({ ...value, day: e.target.value })}
          />
        </Field>
      )}

      {value.kind === 'month' && (
        <Field label="الشهر">
          <input
            type="month"
            dir="ltr"
            className={inputClass}
            value={value.month}
            min={minDate?.slice(0, 7)}
            max={maxDate?.slice(0, 7)}
            onChange={(e) => e.target.value && onChange({ ...value, month: e.target.value })}
          />
        </Field>
      )}

      {value.kind === 'quarter' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="السنة">
            <select className={inputClass} value={value.year} onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </Field>
          <Field label="الربع">
            <select className={inputClass} value={value.quarter} onChange={(e) => onChange({ ...value, quarter: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>{arabicQuarterName(q)} ({arabicMonthName((q - 1) * 3 + 1)}–{arabicMonthName(q * 3)})</option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </div>
  )
}
