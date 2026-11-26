// تصدير CSV يحفظ العربية: UTF-8 مع BOM (ليفتحه Excel صحيحًا) وفواصل أسطر CRLF.

const BOM = '﻿'

/** يمنع تفسير الخلية كمعادلة في Excel (CSV injection) */
function neutralize(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = typeof value === 'number' ? String(value) : neutralize(String(value))
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(','))
  return BOM + lines.join('\r\n') + '\r\n'
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
