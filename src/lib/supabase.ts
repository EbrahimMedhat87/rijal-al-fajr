import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT'))

// عند غياب الإعداد نُنشئ عميلًا وهميًا فقط كي لا ينهار الاستيراد؛ التطبيق يعرض شاشة إعداد بدلًا من أي شيء آخر.
export const supabase = createClient(
  isConfigured ? url! : 'https://placeholder.invalid',
  isConfigured ? key! : 'placeholder',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  }
)
