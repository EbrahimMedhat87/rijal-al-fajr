import { useAppData } from '../lib/app-data'
import { useSession } from '../lib/auth'
import { Banner, Chip } from './ui'

/** اختيار المسجد. مسجد واحد: اسمه فقط. أكثر: شرائح للتبديل. بدون مسجد: تنبيه. */
export default function MosqueSwitcher({ allowAll = true }: { allowAll?: boolean }) {
  const { profile } = useSession()
  const { mosques, selectedMosque, selectMosque } = useAppData()
  const active = mosques.filter((m) => m.active)

  if (mosques.length === 0) {
    return (
      <div className="mb-3">
        <Banner tone="gold">
          {profile.role === 'owner'
            ? 'لم تُضَف مساجد بعد. أضفها من الإدارة ثم أضف الأطفال لكل مسجد.'
            : 'حسابك غير مربوط بأي مسجد. تواصل مع المالك ليربطك بمسجدك.'}
        </Banner>
      </div>
    )
  }
  if (mosques.length === 1) {
    return <div className="mb-3 text-sm font-semibold text-brand-800">🕌 {mosques[0].name}</div>
  }
  return (
    <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="المسجد">
      {allowAll && (
        <Chip active={selectedMosque === 'all'} onClick={() => selectMosque('all')}>
          كل المساجد
        </Chip>
      )}
      {active.map((m) => (
        <Chip key={m.id} active={selectedMosque === m.id} onClick={() => selectMosque(m.id)}>
          {m.name}
        </Chip>
      ))}
    </div>
  )
}
