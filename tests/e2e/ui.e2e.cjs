// اختبار e2e للواجهة في Chromium مع Supabase وهمي (mock) — يختبر الواجهة والـ offline والمزامنة، لا قاعدة البيانات الحقيقية.
// قاعدة البيانات والصلاحيات تُختبر بـ `npm run test:db`.
//
// التشغيل:
//   npm i -D playwright && npx playwright install chromium
//   VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=test npm run build
//   npx vite preview --port 4173 --strictPort &
//   node tests/e2e/ui.e2e.cjs                      # الساعة الحالية
//   FAKE_NOW=2026-11-25T22:30:00Z node tests/e2e/ui.e2e.cjs   # 00:30 بتوقيت القاهرة (حد اليوم)
//   SHOTS_DIR=./e2e-shots لتغيير مكان الصور
// اختبار e2e للواجهة في متصفح حقيقي مع Supabase وهمي (يحاكي سلوك دوال SQL التي اختُبرت على Postgres).
const { chromium } = require('playwright')
const fs = require('fs')
const SHOTS = process.env.SHOTS_DIR || './e2e-shots'
fs.mkdirSync(SHOTS, { recursive: true })

const BASE = 'http://localhost:4173'
const SB = 'https://example.supabase.co'

const NOW = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW) : new Date()
const todayCairo = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(NOW)
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const TODAY = todayCairo()

// ----------------------------- خادم وهمي -----------------------------
const USERS = {
  'owner@x.test': { id: '11111111-1111-1111-1111-111111111111', name: 'المالك', role: 'owner' },
  'rec@x.test': { id: '33333333-3333-3333-3333-333333333333', name: 'مسجل 1', role: 'recorder' }
}
const NAMES = ['أحمد', 'محمد', 'يوسف', 'عمر', 'خالد', 'إبراهيم']
const server = {
  participants: NAMES.map((n, i) => ({ id: `aaaaaaaa-0000-0000-0000-00000000000${i + 1}`, name: n, active: true })),
  attendance: [], // {id, participant_id, attendance_date, status, recorded_by, recorded_at, client_op_id, void_reason}
  campaign: { id: 'cccccccc-0000-0000-0000-000000000001', name: 'رجال الفجر', start_date: addDays(TODAY, -60), timezone: 'Africa/Cairo', status: 'active' },
  calls: { record: 0 },
  token: null
}
const P = (i) => server.participants[i].id
let seq = 0
function addAtt(pid, date, by = USERS['owner@x.test'].id, op = `seed-${++seq}`) {
  server.attendance.push({ id: `att-${++seq}`, participant_id: pid, attendance_date: date, status: 'valid', recorded_by: by, recorded_at: new Date().toISOString(), client_op_id: op, void_reason: null })
}
// بيانات تاريخية للترتيب: أحمد 5 أيام، محمد 5 أيام (تعادل)، يوسف 2، عمر 0
for (let i = 1; i <= 5; i++) { addAtt(P(0), addDays(TODAY, -i)); addAtt(P(1), addDays(TODAY, -i)) }
addAtt(P(2), addDays(TODAY, -1)); addAtt(P(2), addDays(TODAY, -2))

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (uid) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`

let currentUserId = null
const userById = (id) => Object.values(USERS).find((u) => u.id === id)

function counts(from, to) {
  return server.participants
    .map((p) => ({
      participant_id: p.id, name: p.name, active: p.active,
      days: server.attendance.filter((a) => a.participant_id === p.id && a.status === 'valid' && a.attendance_date >= from && a.attendance_date <= to).length
    }))
}

function handleRpc(name, body, uid) {
  const u = userById(uid)
  if (name === 'record_attendance') {
    server.calls.record++
    const dup = server.attendance.find((a) => a.client_op_id === body.p_client_op_id)
    if (dup) return { status: 200, json: { status: 'already_synced', attendance_id: dup.id } }
    if (body.p_date > TODAY) return { status: 400, json: { message: 'ERR_DATE_IN_FUTURE', code: 'P0001' } }
    const ex = server.attendance.find((a) => a.participant_id === body.p_participant_id && a.attendance_date === body.p_date && a.status === 'valid')
    if (ex) return { status: 200, json: { status: 'already_recorded', attendance_id: ex.id } }
    const row = { id: `att-${++seq}`, participant_id: body.p_participant_id, attendance_date: body.p_date, status: 'valid', recorded_by: uid, recorded_at: new Date().toISOString(), client_op_id: body.p_client_op_id, void_reason: null }
    server.attendance.push(row)
    return { status: 200, json: { status: 'created', attendance_id: row.id } }
  }
  if (name === 'attendance_counts') {
    if (u.role === 'recorder') return { status: 403, json: { message: 'ERR_NOT_AUTHORIZED', code: '42501' } }
    return { status: 200, json: counts(body.p_from, body.p_to) }
  }
  if (name === 'owner_list_users') {
    return { status: 200, json: Object.entries(USERS).map(([email, x]) => ({ user_id: x.id, email, display_name: x.name, role: x.role, active: true })) }
  }
  return { status: 404, json: { message: 'unknown rpc ' + name } }
}

function eq(url, key) { const v = url.searchParams.get(key); return v && v.startsWith('eq.') ? v.slice(3) : null }

async function setupMock(context, state) {
  await context.route(`${SB}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const method = req.method()
    const hdr = req.headers()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
    const ok = (json, status = 200, extra = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(json) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })

    state.requests.push(`${method} ${path}`)

    if (path === '/auth/v1/token') {
      const body = JSON.parse(req.postData() || '{}')
      const u = USERS[body.email]
      if (!u || body.password !== 'pass1234') return ok({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' }, 400)
      currentUserId = u.id
      const tok = jwt(u.id)
      return ok({ access_token: tok, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + u.id, user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: body.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } })
    }
    if (path === '/auth/v1/logout') return ok({}, 204)
    if (path === '/auth/v1/user') return ok({ id: currentUserId, email: 'x', aud: 'authenticated', role: 'authenticated' })

    // uid من التوكن
    const auth = (hdr['authorization'] || '').replace('Bearer ', '')
    let uid = null
    try { uid = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString()).sub } catch {}
    const u = userById(uid)
    if (path.startsWith('/rest/v1/') && !u) return ok({ message: 'JWT expired', code: 'PGRST301' }, 401)

    if (path.startsWith('/rest/v1/rpc/')) {
      const r = handleRpc(path.split('/').pop(), JSON.parse(req.postData() || '{}'), uid)
      return ok(r.json, r.status)
    }
    const wantsObject = (hdr['accept'] || '').includes('vnd.pgrst.object')
    const table = path.split('/').pop()

    if (table === 'profiles') {
      const id = eq(url, 'user_id')
      if (id) {
        const x = userById(id)
        const row = x ? { user_id: x.id, display_name: x.name, role: x.role, active: true } : null
        if (wantsObject) return row ? ok(row) : ok({ message: 'no rows' }, 406)
        return ok(row ? [row] : [])
      }
      return ok(Object.values(USERS).map((x) => ({ user_id: x.id, display_name: x.name })))
    }
    if (table === 'campaigns') {
      return wantsObject ? ok(server.campaign) : ok([server.campaign])
    }
    if (table === 'participants') {
      if (method === 'POST') {
        const b = JSON.parse(req.postData() || '{}')
        const row = { id: `aaaaaaaa-0000-0000-0000-0000000001${server.participants.length}`, name: b.name, active: true }
        server.participants.push(row)
        return wantsObject ? ok(row, 201) : ok([row], 201)
      }
      return ok([...server.participants].sort((a, b) => a.name.localeCompare(b.name, 'ar')))
    }
    if (table === 'attendance') {
      let rows = server.attendance.filter((a) => u.role !== 'recorder' || a.attendance_date >= addDays(TODAY, -1))
      const d = eq(url, 'attendance_date'); if (d) rows = rows.filter((a) => a.attendance_date === d)
      const st = eq(url, 'status'); if (st) rows = rows.filter((a) => a.status === st)
      const pid = eq(url, 'participant_id'); if (pid) rows = rows.filter((a) => a.participant_id === pid)
      const range = url.searchParams.getAll('attendance_date')
      range.forEach((c) => { if (c.startsWith('gte.')) rows = rows.filter((a) => a.attendance_date >= c.slice(4)); if (c.startsWith('lte.')) rows = rows.filter((a) => a.attendance_date <= c.slice(4)) })
      if (hdr['prefer']?.includes('count=exact')) return ok(rows.map((r) => ({ id: r.id })), 200, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` })
      return ok(rows)
    }
    if (table === 'audit_log') return ok([])
    return ok({ message: 'unhandled ' + path }, 404)
  })
}

// ----------------------------- مساعدات الاختبار -----------------------------
const results = []
function check(name, cond, extra = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? '  -> ' + extra : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login(page, email) {
  await page.goto(BASE + '/login')
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', 'pass1234')
  await page.click('button[type=submit]')
  await page.waitForURL(BASE + '/', { timeout: 10000 })
}

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'ar-EG', timezoneId: 'America/New_York', // توقيت الجهاز مختلف عمدًا
    acceptDownloads: true
  })
  const state = { requests: [] }
  await setupMock(context, state)
  if (process.env.FAKE_NOW) await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  // ---- 1) شاشة الدخول
  await page.goto(BASE + '/login')
  await page.waitForSelector('form')
  check('الصفحة RTL وبلغة عربية', (await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang].join())) === 'rtl,ar')
  check('لا يوجد رابط/زر لإنشاء حساب (لا تسجيل عام)', (await page.locator('text=/إنشاء حساب|تسجيل جديد|Sign up/i').count()) === 0)
  await page.screenshot({ path: `${SHOTS}/01-login.png` })

  // دخول خاطئ
  await page.fill('input[type=email]', 'owner@x.test'); await page.fill('input[type=password]', 'wrong')
  await page.click('button[type=submit]')
  await page.waitForSelector('text=غير صحيحة')
  check('كلمة مرور خاطئة تعرض رسالة عربية', true)

  // دخول صحيح كمالك
  await login(page, 'owner@x.test')
  await page.waitForSelector('text=الأطفال النشطون')
  await sleep(800)
  const nOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check('لا تمرير أفقي في الرئيسية (موبايل)', !(await nOverflow()))
  await page.screenshot({ path: `${SHOTS}/02-dashboard.png` })

  const idbCount = (store) => page.evaluate((s) => new Promise((res, rej) => {
    const r = indexedDB.open('rijal-al-fajr'); r.onerror = () => rej(r.error)
    r.onsuccess = () => { const db = r.result; const q = db.transaction(s).objectStore(s).count(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) }
  }), store)
  check('قائمة الأطفال خُزّنت في IndexedDB', (await idbCount('participants')) === 6)

  // ---- 2) تسجيل حضور أونلاين
  await page.click('a[href="/attendance"]')
  await page.waitForSelector('text=تسجيل الحضور')
  await page.waitForSelector('button:has-text("أحمد")')
  await page.screenshot({ path: `${SHOTS}/03-attendance.png` })
  const countToday = () => server.attendance.filter((a) => a.attendance_date === TODAY && a.status === 'valid').length
  await page.click('button:has-text("أحمد")')
  await sleep(1200)
  check('تسجيل أونلاين: سجل واحد في الخادم لليوم', countToday() === 1)
  const utcDate = NOW.toISOString().slice(0, 10)
  const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(NOW)
  console.log(`   NOW=${NOW.toISOString()}  Cairo=${TODAY}  UTC=${utcDate}  NewYork(device)=${nyDate}`)
  check('تاريخ السجل = تاريخ القاهرة (لا انزياح بتوقيت الجهاز)', server.attendance.some((a) => a.attendance_date === TODAY && a.recorded_by === USERS['owner@x.test'].id && a.participant_id === P(0)))
  check('الصف يتحول إلى "حاضر"', (await page.locator('li:has-text("أحمد")').innerText()).includes('حاضر'))
  check('الزر يُعطَّل بعد التسجيل (لا ضغط مزدوج)', await page.locator('li:has-text("أحمد") button').isDisabled())

  // ---- 3) بحث بالعربية يتجاهل الهمزة
  await page.fill('input[type=search]', 'ابراهيم')
  check('البحث "ابراهيم" يجد "إبراهيم"', (await page.locator('li:has-text("إبراهيم")').count()) === 1)
  await page.fill('input[type=search]', '')

  // ---- 4) أوفلاين: تسجيل، إغلاق/إعادة فتح، عودة الاتصال
  await context.setOffline(true)
  await sleep(300)
  check('شارة "غير متصل" تظهر', (await page.locator('header').innerText()).includes('غير متصل'))
  const before = server.attendance.length
  await page.click('button:has-text("محمد")')
  await sleep(500)
  const rowTxt = await page.locator('li:has-text("محمد")').innerText()
  check('أوفلاين: تأكيد فوري "محفوظ على الجهاز" + "بانتظار المزامنة"', rowTxt.includes('محفوظ على الجهاز') && rowTxt.includes('بانتظار المزامنة'), rowTxt)
  check('أوفلاين: لم يصل شيء للخادم', server.attendance.length === before)
  check('الشريط يعرض عدد المعلّق', (await page.locator('header').innerText()).includes('1 بانتظار المزامنة'))

  await page.click('button:has-text("يوسف")'); await sleep(300)
  await page.screenshot({ path: `${SHOTS}/04-offline.png` })
  check('معلّقان محليًا', (await idbCount('queue')) === 3)

  // إعادة فتح التطبيق وهو أوفلاين (من كاش الـ PWA)
  await sleep(1500) // نتأكد أن الـ service worker جاهز
  await page.reload()
  await page.waitForSelector('button:has-text("محمد")', { timeout: 15000 }).catch(() => {})
  const reopened = await page.locator('li:has-text("محمد")').innerText().catch(() => 'FAILED_TO_OPEN')
  check('إعادة فتح التطبيق بدون إنترنت تعمل وتُبقي السجل المعلّق', reopened.includes('محفوظ على الجهاز'), reopened)
  await page.screenshot({ path: `${SHOTS}/05-offline-reopened.png` })

  // ---- 5) تعارض: جهاز آخر سجّل "خالد" أثناء انقطاعنا
  await page.click('button:has-text("خالد")'); await sleep(300)
  addAtt(P(4), TODAY, USERS['rec@x.test'].id, 'other-device-op') // الجهاز الآخر سبقنا

  // عودة الاتصال
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await sleep(3500)
  const todayRows = server.attendance.filter((a) => a.attendance_date === TODAY && a.status === 'valid')
  const byPid = (i) => todayRows.filter((a) => a.participant_id === P(i)).length
  check('بعد عودة الاتصال: محمد ويوسف سُجّلا في الخادم', byPid(1) === 1 && byPid(2) === 1)
  check('تعارض خالد: سجل صالح واحد فقط (لا تكرار)', byPid(4) === 1)
  const body = await page.locator('main').innerText()
  check('الشريط: كل شيء متزامن بعد المزامنة', (await page.locator('header').innerText()).includes('كل شيء متزامن'))
  check('المنظم يُبلَّغ أن خالد سُجّل مسبقًا من جهاز آخر (على الصف نفسه)', (await page.locator('li:has-text("خالد")').innerText()).includes('سُجِّل مسبقًا من جهاز آخر'))
  await page.screenshot({ path: `${SHOTS}/06-after-sync.png` })

  // ---- 6) فشل نهائي + عدم فقدان
  // تاريخ مستقبلي لا يمكن اختياره من الواجهة (max=today)؛ نتحقق من ذلك:
  check('منتقي التاريخ يمنع المستقبل (max=اليوم)', (await page.locator('input[type=date]').getAttribute('max')) === TODAY)

  // ---- 7) الترتيب (مالك)
  await page.goto(BASE + '/rankings')
  await page.waitForSelector('ol li')
  await sleep(500)
  const ranks = await page.locator('ol li').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  console.log('   ترتيب الشهر/الربع الظاهر:', ranks.slice(0, 5).join(' | '))
  await page.screenshot({ path: `${SHOTS}/07-rankings.png` })
  // اختيار "منذ البداية" حيث التعادل بين أحمد ومحمد (5+1 vs 5+1)
  await page.click('button:has-text("منذ البداية")'); await sleep(800)
  const ranks2 = await page.locator('ol li').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  console.log('   ترتيب منذ البداية:', ranks2.join(' | '))
  const firstNums = ranks2.map((t) => t.split(' ')[0])
  check('الترتيب التنافسي: التعادل في المركز 1 والتالي يأخذ 3', firstNums[0] === '1' && firstNums[1] === '1' && firstNums[2] === '3', firstNums.join(','))
  check('شرح الفترة ظاهر بالعربية', (await page.locator('main').innerText()).includes('عند التعادل'))
  check('الأطفال بدون حضور بلا رتبة (—)', ranks2.slice(-1)[0].startsWith('—'))
  await page.screenshot({ path: `${SHOTS}/08-rankings-all.png` })

  // ---- 8) CSV
  await page.goto(BASE + '/reports')
  await page.waitForSelector('text=تصدير CSV')
  await page.click('button:has-text("منذ البداية")')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("تصدير الترتيب")')])
  const csvPath = `${SHOTS}/summary.csv`
  await dl.saveAs(csvPath)
  const raw = fs.readFileSync(csvPath)
  const text = raw.toString('utf8')
  check('CSV: يبدأ بـ BOM', raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
  check('CSV: العربية سليمة (أحمد/محمد/الترتيب)', text.includes('أحمد') && text.includes('محمد') && text.includes('الترتيب'))
  check('CSV: اسم الملف مناسب', /summary-all\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename())
  await page.screenshot({ path: `${SHOTS}/09-reports.png` })

  // ---- 9) الأطفال والإدارة
  await page.goto(BASE + '/participants'); await page.waitForSelector('text=+ إضافة')
  await page.screenshot({ path: `${SHOTS}/10-participants.png` })
  await page.goto(BASE + '/admin'); await page.waitForSelector('text=إعدادات المبادرة'); await sleep(600)
  check('صفحة الإدارة تعرض المنظمين للمالك', (await page.locator('main').innerText()).includes('rec@x.test'))
  await page.screenshot({ path: `${SHOTS}/11-admin.png` })

  // ---- 10) تسجيل الخروج ثم مسجِّل (Recorder)
  await page.click('button[aria-label="القائمة"]')
  page.once('dialog', (d) => d.accept())
  await page.click('button:has-text("تسجيل الخروج")')
  await page.waitForURL(/login/)
  check('الخروج يعيد إلى شاشة الدخول', true)
  check('الخروج مسح كاش الأطفال المقروء من الجهاز (خصوصية)', (await idbCount('participants')) === 0)

  await login(page, 'rec@x.test'); await sleep(1000)
  const nav = await page.locator('nav').innerText()
  check('Recorder: لا يرى "الترتيب" ولا "التقارير" في التنقل', !nav.includes('الترتيب') && !nav.includes('التقارير'), nav)
  await page.goto(BASE + '/rankings'); await sleep(800)
  check('Recorder: فتح /rankings يدويًا يعيده للرئيسية', new URL(page.url()).pathname === '/')
  await page.goto(BASE + '/admin'); await sleep(800)
  check('Recorder: /admin يعيده للرئيسية', new URL(page.url()).pathname === '/')
  await page.goto(BASE + '/attendance'); await page.waitForSelector('button:has-text("أحمد")')
  check('Recorder: لا يوجد منتقي تاريخ (اليوم فقط)', (await page.locator('input[type=date]').count()) === 0)
  await page.screenshot({ path: `${SHOTS}/12-recorder.png` })

  // ---- 11) لا أخطاء JS غير متوقعة
  const bad = errors.filter((e) => !/Failed to load resource|net::ERR|Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/i.test(e))
  check('لا أخطاء JavaScript غير متوقعة في الـ console', bad.length === 0, bad.slice(0, 3).join(' || '))

  await browser.close()
  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
})().catch((e) => { console.error('E2E CRASH', e); process.exit(2) })
