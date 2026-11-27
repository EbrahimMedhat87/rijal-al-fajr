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
const MA = 'bbbbbbbb-0000-0000-0000-00000000000a' // مسجد النور
const MB = 'bbbbbbbb-0000-0000-0000-00000000000b' // مسجد الرحمة
const MOSQUES = [{ id: MA, name: 'مسجد النور', active: true }, { id: MB, name: 'مسجد الرحمة', active: true }]
const server = {
  participants: NAMES.map((n, i) => ({ id: `aaaaaaaa-0000-0000-0000-00000000000${i + 1}`, name: n, active: true, mosque_id: i < 5 ? MA : MB })),
  userMosques: { [USERS['rec@x.test'].id]: [MA] },
  pending: [{ user_id: '44444444-4444-4444-4444-444444444444', email: 'new@x.test', full_name: 'إداري جديد', requested_mosque: 'مسجد الرحمة', created_at: new Date().toISOString() }],
  signups: [],
  upserts: [],
  attendance: [], // {id, participant_id, attendance_date, status, recorded_by, recorded_at, client_op_id, void_reason}
  campaign: { id: 'cccccccc-0000-0000-0000-000000000001', name: 'رجال الفجر', start_date: addDays(TODAY, -60), timezone: 'Africa/Cairo', status: 'active' },
  calls: { record: 0 },
  token: null
}
const P = (i) => server.participants[i].id
// رقم الطفل داخل المسجد (مثل الخادم): تسلسلي لكل مسجد، ولا يُعاد استخدامه
// طفل جديد: أصغر رقم فاضي (يملأ الفراغات) | طفل منقول (moved=true): أعلى رقم + 1
const assignNo = (p, moved = false) => {
  const used = new Set(server.participants.filter((x) => x !== p && x.mosque_id === p.mosque_id).map((x) => x.child_no))
  if (moved) { p.child_no = Math.max(0, ...used) + 1; return }
  let n = 1; while (used.has(n)) n++
  p.child_no = n
}
server.participants.forEach((p) => assignNo(p))
const nrm = (s) => s.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase().trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
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

function counts(from, to, mosqueId = null) {
  return server.participants
    .filter((p) => !mosqueId || p.mosque_id === mosqueId)
    .map((p) => ({
      participant_id: p.id, name: p.name, active: p.active, child_no: p.child_no, mosque_id: p.mosque_id, mosque_name: MOSQUES.find((m) => m.id === p.mosque_id).name,
      days: server.attendance.filter((a) => a.participant_id === p.id && a.status === 'valid' && a.attendance_date >= from && a.attendance_date <= to).length
    }))
}

function handleRpc(name, body, uid) {
  const u = userById(uid)
  if (name === 'add_participant') {
    server.calls.addParticipant = (server.calls.addParticipant || 0) + 1
    const ex = server.participants.find((x) => x.id === body.p_id)
    if (ex) return { status: 200, json: { status: 'already_synced', id: ex.id } }
    const np = { id: body.p_id, name: body.p_name.trim(), active: true, mosque_id: body.p_mosque_id }; server.participants.push(np); assignNo(np)
    return { status: 200, json: { status: 'created', id: body.p_id } }
  }
  if (name === 'record_attendance') {
    server.calls.record++
    if (!server.participants.find((x) => x.id === body.p_participant_id)) return { status: 400, json: { message: 'ERR_PARTICIPANT_NOT_FOUND', code: 'P0002' } }
    const dup = server.attendance.find((a) => a.client_op_id === body.p_client_op_id)
    if (dup) return { status: 200, json: { status: 'already_synced', attendance_id: dup.id } }
    if (body.p_date > TODAY) return { status: 400, json: { message: 'ERR_DATE_IN_FUTURE', code: 'P0001' } }
    const ex = server.attendance.find((a) => a.participant_id === body.p_participant_id && a.attendance_date === body.p_date && a.status === 'valid')
    if (ex) return { status: 200, json: { status: 'already_recorded', attendance_id: ex.id } }
    const row = { id: `att-${++seq}`, participant_id: body.p_participant_id, attendance_date: body.p_date, status: 'valid', recorded_by: uid, recorded_at: new Date().toISOString(), client_op_id: body.p_client_op_id, void_reason: null }
    server.attendance.push(row)
    return { status: 200, json: { status: 'created', attendance_id: row.id } }
  }
  if (name === 'undo_attendance') {
    server.calls.undo = (server.calls.undo || 0) + 1
    const row = server.attendance.find((a) => a.participant_id === body.p_participant_id && a.attendance_date === body.p_date && a.status === 'valid')
    if (!row) return { status: 400, json: { message: 'ERR_ATTENDANCE_NOT_FOUND', code: 'P0002' } }
    if (u.role === 'recorder' && row.recorded_by !== uid) return { status: 400, json: { message: 'ERR_NOT_AUTHORIZED', code: '42501' } }
    row.status = 'void'; row.void_reason = body.p_reason || 'تسجيل بالخطأ'
    return { status: 200, json: { status: 'voided', attendance_id: row.id } }
  }
  if (name === 'find_similar_children') {
    server.calls.similar = (server.calls.similar || 0) + 1
    const out = []
    body.p_names.forEach((nm, i) => {
      const t = nrm(nm); if (t.length < 2) return
      const k = Math.min(3, t.length)
      server.participants.filter((c) => c.mosque_id !== body.p_mosque_id).filter((c) => { const ct = nrm(c.name); return ct.length >= k && (t.length >= 3 || ct.length === t.length) && ct.slice(0, k).join(' ') === t.slice(0, k).join(' ') }).slice(0, 3)
        .forEach((c) => out.push({ idx: i + 1, participant_id: c.id, name: c.name, child_no: c.child_no, mosque_id: c.mosque_id, mosque_name: MOSQUES.find((m) => m.id === c.mosque_id).name }))
    })
    return { status: 200, json: out }
  }
  if (name === 'transfer_child') {
    const c = server.participants.find((x) => x.id === body.p_participant_id)
    if (!c) return { status: 400, json: { message: 'ERR_PARTICIPANT_NOT_FOUND', code: 'P0002' } }
    if (c.mosque_id === body.p_to_mosque_id) return { status: 200, json: { status: 'already_there' } }
    c.mosque_id = body.p_to_mosque_id; assignNo(c, true); server.calls.transfer = (server.calls.transfer || 0) + 1
    return { status: 200, json: { status: 'transferred' } }
  }
  if (name === 'attendance_counts') {
    if (u.role === 'recorder') return { status: 403, json: { message: 'ERR_NOT_AUTHORIZED', code: '42501' } }
    return { status: 200, json: counts(body.p_from, body.p_to, body.p_mosque_id) }
  }
  if (name === 'mosque_ranking') {
    if (u.role === 'recorder') return { status: 403, json: { message: 'ERR_NOT_AUTHORIZED', code: '42501' } }
    const rows = MOSQUES.map((m) => {
      const c = counts(body.p_from, body.p_to, m.id)
      const total = c.reduce((a, x) => a + x.days, 0)
      return { mosque_id: m.id, name: m.name, children: c.length, present: c.filter((x) => x.days > 0).length, total_days: total, avg_days: c.length ? Math.round((total / c.length) * 100) / 100 : 0 }
    })
    return { status: 200, json: rows }
  }
  if (name === 'owner_list_users') {
    return { status: 200, json: Object.entries(USERS).map(([email, x]) => ({ user_id: x.id, email, display_name: x.name, role: x.role, active: true, created_at: new Date().toISOString(), mosque_ids: server.userMosques[x.id] || [] })) }
  }
  if (name === 'owner_list_pending_users') return { status: 200, json: server.pending }
  if (name === 'owner_reject_signup') { server.pending = server.pending.filter((x) => x.user_id !== body.p_user_id); return { status: 200, json: null } }
  if (name === 'owner_upsert_user') {
    const pend = server.pending.find((x) => x.email === body.p_email)
    const id = pend ? pend.user_id : (USERS[body.p_email] || {}).id
    server.upserts.push(body)
    USERS[body.p_email] = { id, name: body.p_display_name, role: body.p_role }
    server.pending = server.pending.filter((x) => x.email !== body.p_email)
    return { status: 200, json: id }
  }
  if (name === 'owner_set_user_mosques') { server.userMosques[body.p_user_id] = body.p_mosque_ids; return { status: 200, json: null } }
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
    if (path === '/auth/v1/signup') {
      const body = JSON.parse(req.postData() || '{}')
      if (body.email === 'dup@x.test') return ok({ code: 422, error_code: 'user_already_exists', msg: 'User already registered', message: 'User already registered' }, 422)
      server.signups.push(body)
      return ok({ id: '55555555-5555-5555-5555-555555555555', aud: 'authenticated', role: '', email: body.email, confirmation_sent_at: new Date().toISOString(), app_metadata: {}, user_metadata: body.data || {}, identities: [{ id: 'x' }], created_at: new Date().toISOString() })
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
    if (table === 'mosques') {
      const mine = server.userMosques[uid] || []
      return ok(MOSQUES.filter((m) => u.role === 'owner' || mine.includes(m.id)))
    }
    if (table === 'user_mosques') {
      const id = eq(url, 'user_id') || uid
      return ok((server.userMosques[id] || []).map((m) => ({ mosque_id: m })))
    }
    if (table === 'participants') {
      if (method === 'POST') {
        const b = JSON.parse(req.postData() || '{}')
        const rows = (Array.isArray(b) ? b : [b]).map((x, idx) => ({ id: `aaaaaaaa-1111-0000-0000-${String(server.participants.length + 100 + idx).padStart(12, '0')}`, name: x.name, active: true, mosque_id: x.mosque_id }))
        rows.forEach((r) => { server.participants.push(r); assignNo(r) })
        server.bulkCalls = (server.bulkCalls || 0) + 1
        return wantsObject ? ok(rows[0], 201) : ok(rows, 201)
      }
      const mine = server.userMosques[uid] || []
      return ok([...server.participants].filter((p) => u.role === 'owner' || mine.includes(p.mosque_id)).sort((a, b) => a.name.localeCompare(b.name, 'ar')))
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
  await page.screenshot({ path: `${SHOTS}/01-login.png` })

  // ---- 1ب) إنشاء حساب ذاتي (منظم جديد)
  check('شاشة الدخول فيها رابط "منظم جديد؟ أنشئ حسابك"', (await page.locator('text=منظم جديد؟ أنشئ حسابك').count()) === 1)
  await page.click('text=منظم جديد؟ أنشئ حسابك')
  check('نموذج الإنشاء يطلب الاسم والمسجد', (await page.locator('form input').count()) === 4)
  await page.screenshot({ path: `${SHOTS}/01b-signup.png` })
  const signupForm = async (email) => {
    const inputs = page.locator('form input')
    await inputs.nth(0).fill('أحمد الإداري'); await inputs.nth(1).fill('مسجد البحري')
    await inputs.nth(2).fill(email); await inputs.nth(3).fill('longpass123')
    await page.click('button[type=submit]')
  }
  await signupForm('dup@x.test')
  await page.waitForSelector('text=مسجّل بالفعل')
  check('بريد مسجّل مسبقًا: رسالة واضحة', true)
  await page.reload(); await page.waitForSelector('form'); await page.click('text=منظم جديد؟ أنشئ حسابك')
  await signupForm('fresh@x.test')
  await page.waitForSelector('text=تم إنشاء حسابك')
  check('إنشاء حساب: يُرسَل الاسم والمسجد المطلوب كبيانات للمالك', server.signups.length === 1 && server.signups[0].data.full_name === 'أحمد الإداري' && server.signups[0].data.requested_mosque === 'مسجد البحري', JSON.stringify(server.signups))
  check('بعد الإنشاء: رسالة نجاح وعودة لوضع الدخول', (await page.locator('button[type=submit]').innerText()).includes('دخول'))
  await page.screenshot({ path: `${SHOTS}/01c-signup-done.png` })
  await page.reload(); await page.waitForSelector('form')

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
  check('الزر يُعطَّل بعد التسجيل (لا ضغط مزدوج)', await page.locator('button[aria-label="أحمد — حاضر"]').isDisabled())

  // ---- 3) بحث بالعربية يتجاهل الهمزة
  await page.fill('input[type=search]', 'ابراهيم'); await sleep(200)
  check('البحث "ابراهيم" يجد "إبراهيم"', (await page.locator('li:has-text("إبراهيم")').count()) === 1)
  await page.fill('input[type=search]', ''); await sleep(200)

  // ---- 3ب) رقم الطفل + البحث بالرقم
  check('كل صف يعرض رقم الطفل (6 أرقام)', (await page.locator('main li [data-testid=child-no]').count()) === 6, String(await page.locator('main li [data-testid=child-no]').count()) + ' / li=' + (await page.locator('main li').count()))
  check('أحمد رقمه 1 (أول طفل في مسجد النور) وإبراهيم رقمه 1 في مسجد الرحمة', (await page.locator('li:has-text("أحمد") [data-testid=child-no]').innerText()).trim() === '1' && (await page.locator('li:has-text("إبراهيم") [data-testid=child-no]').innerText()).trim() === '1')
  await page.fill('input[type=search]', '2'); await sleep(200)
  check('البحث بالرقم "2": يظهر الطفل رقم 2 (محمد) فقط', (await page.locator('main li').count()) === 1 && (await page.locator('main li').innerText()).includes('محمد'), await page.locator('main li').allInnerTexts().then((x) => x.join('|')))
  await page.fill('input[type=search]', '٣'); await sleep(200)
  check('البحث بالرقم العربي "٣": يظهر يوسف', (await page.locator('main li').count()) === 1 && (await page.locator('main li').innerText()).includes('يوسف'))
  await page.fill('input[type=search]', '9'); await sleep(200)
  check('رقم غير موجود: لا نتائج', (await page.locator('main li').count()) === 0)
  await page.fill('input[type=search]', ''); await sleep(200)

  // ---- 3ج) شريط البحث الثابت: لا يترك فراغًا فوقه يمرّ منه المحتوى (مشكلة iOS: padding الحاوية يُحسب في موضع sticky)
  await page.setViewportSize({ width: 390, height: 430 })
  await sleep(300)
  const geo0 = await page.evaluate(() => {
    const main = document.querySelector('main'); const bar = document.querySelector('input[type=search]').parentElement
    const mainTop = main.getBoundingClientRect().top
    main.scrollTop = 99999
    return { padTop: getComputedStyle(main).paddingTop, scrollable: main.scrollHeight > main.clientHeight, barTop: Math.round(bar.getBoundingClientRect().top - mainTop), barPos: getComputedStyle(bar).position }
  })
  await sleep(100)
  const geo = await page.evaluate(() => {
    const main = document.querySelector('main'); const bar = document.querySelector('input[type=search]').parentElement
    const mt = main.getBoundingClientRect().top; const bb = bar.getBoundingClientRect()
    // أي صف ظاهر جزئيًا بين أعلى الحاوية وأعلى الشريط؟
    const peeking = [...main.querySelectorAll('ul li')].filter((li) => { const r = li.getBoundingClientRect(); return r.bottom > mt + 1 && r.top < bb.top - 1 && r.bottom <= bb.top + 1 })
    return { barTop: Math.round(bb.top - mt), peeking: peeking.length }
  })
  check('الحاوية بلا padding علوي (حل مشكلة iOS) والشريط sticky', geo0.padTop === '0px' && geo0.barPos === 'sticky', JSON.stringify(geo0))
  check('بعد التمرير: الشريط ملتصق بأعلى الحاوية بلا فراغ، ولا صفوف تمرّ فوقه', geo0.scrollable && geo.barTop === 0 && geo.peeking === 0, JSON.stringify({ geo0, geo }))
  await page.screenshot({ path: `${SHOTS}/03b-sticky.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.querySelector('main').scrollTop = 0 })

  // ---- 3د) إلغاء الحضور (أونلاين): أحمد سُجّل خطأً
  check('صف الحاضر فيه زر "إلغاء" وصف غير الحاضر بدونه', (await page.locator('button[aria-label="إلغاء حضور أحمد"]').count()) === 1 && (await page.locator('button[aria-label="إلغاء حضور محمد"]').count()) === 0)
  await page.click('button[aria-label="إلغاء حضور أحمد"]'); await page.waitForSelector('[role=dialog]')
  await page.screenshot({ path: `${SHOTS}/03c-undo-confirm.png` })
  await page.click('[role=dialog] button:has-text("رجوع")'); await sleep(200)
  check('الرجوع من التأكيد لا يلغي شيئًا', countToday() === 1 && !server.calls.undo)
  await page.click('button[aria-label="إلغاء حضور أحمد"]')
  await page.click('[role=dialog] button:has-text("نعم، ألغِ الحضور")'); await sleep(1000)
  check('إلغاء الحضور: السجل صار void في الخادم مع السبب', countToday() === 0 && server.attendance.some((a) => a.participant_id === P(0) && a.attendance_date === TODAY && a.status === 'void' && a.void_reason === 'تسجيل بالخطأ'))
  check('الصف رجع "لم يُسجَّل" (زر حاضر) وبلا زر إلغاء', (await page.locator('button[aria-label^="أحمد — تسجيل حضور"]').count()) === 1 && (await page.locator('button[aria-label="إلغاء حضور أحمد"]').count()) === 0)
  check('العدّاد رجع صفرًا', (await page.locator('main .text-3xl').first().innerText()).trim() === '0' && !(await page.locator('li:has-text("أحمد")').innerText()).includes('✓'))
  await page.click('button:has-text("أحمد")'); await sleep(1200)
  check('يمكن إعادة تسجيل الحضور بعد الإلغاء (سجل صالح جديد)', countToday() === 1 && server.attendance.filter((a) => a.participant_id === P(0) && a.attendance_date === TODAY).length === 2)

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

  // إلغاء حضور محفوظ على الجهاز فقط (يعمل بدون إنترنت)
  await page.click('button[aria-label="إلغاء حضور محمد"]')
  await page.click('[role=dialog] button:has-text("نعم، ألغِ الحضور")'); await sleep(500)
  check('أوفلاين: إلغاء حضور معلّق يحذفه محليًا بدون إنترنت', (await page.locator('li:has-text("محمد")').innerText()).includes('حاضر') && (await page.locator('button[aria-label^="محمد — تسجيل حضور"]').count()) === 1 && (await idbCount('queue')) === 1 && !(await page.locator('header').innerText()).includes('بانتظار المزامنة'))
  // حضور أحمد وصل للخادم: إلغاؤه يحتاج إنترنت
  await page.click('button[aria-label="إلغاء حضور أحمد"]')
  await page.click('[role=dialog] button:has-text("نعم، ألغِ الحضور")'); await sleep(500)
  check('أوفلاين: إلغاء حضور وصل للخادم يرفض برسالة "يحتاج إنترنت" ويبقى حاضرًا', (await page.locator('body').innerText()).includes('يحتاج إنترنت') && (await page.locator('li:has-text("أحمد")').innerText()).includes('✓') && countToday() === 1)
  await page.click('[role=dialog] button:has-text("رجوع")'); await sleep(200)
  await page.click('button:has-text("محمد")'); await sleep(300)
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

  // "حضور وهمي": عملية متزامنة قديمة على الجهاز (الخادم لا يعرف لها حضورًا — أُلغي من مكان آخر)
  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('rijal-al-fajr'); r.onerror = () => rej(r.error)
    r.onsuccess = () => {
      const d = r.result; const tx = d.transaction('queue', 'readwrite')
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date())
      tx.objectStore('queue').put({ opId: 'stale-op-1', userId: '11111111-1111-1111-1111-111111111111', participantId: 'aaaaaaaa-0000-0000-0000-000000000004', date: today, deviceCreatedAt: new Date(1000).toISOString(), status: 'synced', attempts: 0, serverResult: 'created', updatedAt: Date.now() - 120000 })
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
    }
  }))
  await page.reload()
  await page.waitForSelector('button:has-text("محمد")', { timeout: 15000 }).catch(() => {})
  check('(قبل التصحيح) أوفلاين: الحضور الوهمي لعمر يظهر "حاضر" بسبب بقايا محلية', (await page.locator('li:has-text("عمر")').innerText()).includes('✓'), await page.locator('li:has-text("عمر")').innerText())

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
  check('(بعد التصحيح) عند الاتصال: الحضور الوهمي لعمر اختفى لأن الخادم لا يعرفه، وصار قابلًا للتسجيل', !(await page.locator('li:has-text("عمر")').innerText()).includes('✓') && (await page.locator('button[aria-label^="عمر — تسجيل حضور"]').count()) === 1 && (await idbCount('queue')) >= 1 && !(await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('rijal-al-fajr'); r.onsuccess = () => { const q = r.result.transaction('queue').objectStore('queue').get('stale-op-1'); q.onsuccess = () => res(!!q.result) } }))))
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

  // ---- 9ب) المساجد: الأطفال حسب المسجد
  await page.goto(BASE + '/participants'); await page.waitForSelector('text=+ إضافة'); await sleep(600)
  check('المالك يرى شرائح المساجد', (await page.locator('button:has-text("مسجد النور")').count()) === 1 && (await page.locator('button:has-text("مسجد الرحمة")').count()) === 1)
  check('"كل المساجد": 6 أطفال', (await page.locator('main ul li').count()) === 6)
  await page.click('button:has-text("مسجد الرحمة")'); await sleep(300)
  check('تصفية مسجد الرحمة: طفل واحد فقط (إبراهيم)', (await page.locator('main ul li').count()) === 1 && (await page.locator('main ul li').innerText()).includes('إبراهيم'))

  // ---- 9ج) استيراد قائمة أسماء (كشف جاهز) إلى مسجد الرحمة
  await page.click('button:has-text("استيراد")')
  await page.waitForSelector('textarea')
  const pasted = [
    'سجل الغياب - أسرة الفجر - مسجد الرحمة',
    'الاسم م',
    '✓ ✓ ✓  علي حسن محمود  ١',
    '✗ ✓ ✓  سعيد عبد الله  ٢',
    '3- علي  حسن محمود',
    'إبراهيم',
    'احمد',
    '',
    '٤. ياسين أشرف'
  ].join('\n')
  await page.fill('textarea', pasted)
  check('زر المعاينة يعرض عدد الأسماء المنظّفة (6)', (await page.locator('button:has-text("معاينة")').innerText()).includes('6'), await page.locator('button:has-text("معاينة")').innerText())
  await page.click('button:has-text("معاينة")')
  await page.waitForSelector('ul[aria-label="معاينة الأسماء"]')
  const prevItems = await page.locator('ul[aria-label="معاينة الأسماء"] li').evaluateAll((els) => els.map((e) => ({ t: e.innerText.replace(/\s+/g, ' ').trim(), on: e.querySelector('input').checked })))
  console.log('   معاينة الاستيراد:', JSON.stringify(prevItems))
  const byName = (n) => prevItems.find((x) => x.t.startsWith(n))
  check('المعاينة: الجدد محددون (علي، سعيد، ياسين)', byName('علي حسن محمود')?.on && byName('سعيد عبد الله')?.on && byName('ياسين أشرف')?.on)
  check('المعاينة: "إبراهيم" موجود بالفعل → غير محدد', byName('إبراهيم') && !byName('إبراهيم').on && byName('إبراهيم').t.includes('موجود بالفعل'))
  check('المعاينة: "احمد" عند مسجد آخر → غير محدد مع اسم المسجد', byName('احمد') && !byName('احمد').on && byName('احمد').t.includes('مسجد النور'))
  check('المعاينة: التكرار داخل القائمة يُكتشف ويُستبعد (علي حسن محمود مرتين)', prevItems.length === 6 && prevItems.filter((x) => x.t.includes('مكرر في القائمة') && !x.on).length === 1, JSON.stringify(prevItems))
  await page.screenshot({ path: `${SHOTS}/10b-import-preview.png` })
  const addBtn = await page.locator('button:has-text("إضافة 3 طفل")').count()
  check('زر الإضافة يعرض عدد المحدد (3)', addBtn === 1)
  const nBefore = server.participants.length
  await page.click('button:has-text("إضافة 3 طفل")')
  await page.waitForSelector('text=تمت إضافة 3 طفل', { timeout: 5000 })
  await sleep(600)
  const added = server.participants.slice(nBefore)
  check('الاستيراد: 3 أطفال أُضيفوا في طلب واحد لمسجد الرحمة', added.length === 3 && added.every((x) => x.mosque_id === MB) && server.bulkCalls === 1, JSON.stringify(added))
  check('الاستيراد: الأسماء نظيفة (بلا أرقام/علامات)', added.map((x) => x.name).sort().join('|') === ['سعيد عبد الله', 'علي حسن محمود', 'ياسين أشرف'].sort().join('|'), added.map((x) => x.name).join('|'))
  check('القائمة تحدّثت: 4 أطفال في مسجد الرحمة', (await page.locator('main ul li').count()) === 4, (await page.locator('main ul li').evaluateAll((e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')))).join('|'))

  // رفع ملف CSV
  await page.click('button:has-text("استيراد")'); await page.waitForSelector('textarea')
  await page.setInputFiles('input[type=file]', { name: 'names.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿الاسم,م\nكريم سامح,1\nزياد علاء,2\n', 'utf8') })
  await sleep(300)
  check('رفع CSV: يقرأ الأسماء بالعربية (معاينة 2)', (await page.locator('button:has-text("معاينة")').innerText()).includes('2'), await page.locator('button:has-text("معاينة")').innerText())
  await page.click('button[aria-label="إغلاق"]')

  // استيراد اسم يشبه طفلًا في مسجد آخر: الفحص من الخادم + نقله بدل تكراره
  await page.click('button:has-text("استيراد")'); await page.waitForSelector('textarea')
  await page.selectOption('[role=dialog] select', MA)
  await page.fill('textarea', 'سعيد عبد الله الجمال\nفارس نادر عادل')
  await page.click('button:has-text("معاينة")')
  await page.waitForSelector('ul[aria-label="معاينة الأسماء"]')
  const simRows = await page.locator('ul[aria-label="معاينة الأسماء"] li').evaluateAll((els) => els.map((e) => ({ t: e.innerText.replace(/\s+/g, ' ').trim(), on: e.querySelector('input').checked })))
  check('الاستيراد: الاسم المشابه (من الخادم) يظهر "يشبه طفلًا في مسجد آخر" وغير محدد، والجديد محدد', simRows[0].t.includes('يشبه طفلًا في مسجد آخر') && simRows[0].t.includes('سعيد عبد الله') && !simRows[0].on && simRows[1].on, JSON.stringify(simRows))
  await page.screenshot({ path: `${SHOTS}/10e-import-similar.png` })
  const sKid = server.participants.find((x) => x.name === 'سعيد عبد الله')
  await page.click('ul[aria-label="معاينة الأسماء"] li:first-child button:has-text("نقله هنا")')
  await page.click('button:has-text("تأكيد: انقله من")'); await sleep(900)
  check('الاستيراد: النقل بدل التكرار ينقل الطفل لمسجد النور ويُستبعد من الإضافة', sKid.mosque_id === MA && (await page.locator('text=تم نقله إلى هذا المسجد').count()) === 1 && (await page.locator('button:has-text("إضافة 1 طفل")').count()) === 1)
  await page.click('button[aria-label="إغلاق"]')

  // ---- 9د) ترتيب المساجد
  await page.goto(BASE + '/rankings'); await page.waitForSelector('text=ترتيب المساجد'); await sleep(500)
  await page.click('button:has-text("منذ البداية")'); await sleep(500)
  await page.click('button:has-text("ترتيب المساجد")'); await sleep(900)
  const mrows = await page.locator('ol li').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  console.log('   ترتيب المساجد:', mrows.join(' | '))
  check('ترتيب المساجد: صفان والنور أولًا (أعلى متوسط)', mrows.length === 2 && mrows[0].includes('مسجد النور') && mrows[0].startsWith('1'), mrows.join(' | '))
  await page.screenshot({ path: `${SHOTS}/09b-mosque-ranking.png` })
  await page.click('button:has-text("ترتيب الأطفال")'); await sleep(600)
  await page.click('button:has-text("مسجد الرحمة")'); await sleep(900)
  const crow = await page.locator('ol li').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  check('ترتيب الأطفال مع تصفية مسجد: أطفال الرحمة فقط', crow.length === 3 && crow.every((t) => !t.includes('أحمد')), crow.join(' | '))

  // ---- 9هـ) طلبات التسجيل: قبول وربط بمسجد
  await page.goto(BASE + '/admin'); await page.waitForSelector('text=طلبات تسجيل جديدة'); await sleep(400)
  const pendTxt = await page.locator('main').innerText()
  check('الإدارة: طلب التسجيل يظهر بالاسم والبريد والمسجد المطلوب', pendTxt.includes('إداري جديد') && pendTxt.includes('new@x.test') && pendTxt.includes('مسجد الرحمة'))
  await page.screenshot({ path: `${SHOTS}/11b-pending.png` })
  await page.click('button:has-text("قبول")'); await page.waitForSelector('[role=dialog]')
  const dlg = page.locator('[role=dialog]')
  check('نموذج القبول معبّأ مسبقًا (الاسم/البريد) والمسجد المقترح محدد', (await dlg.locator('input[type=email]').inputValue()) === 'new@x.test' && (await dlg.locator('label:has-text("مسجد الرحمة") input').isChecked()) && !(await dlg.locator('label:has-text("مسجد النور") input').isChecked()))
  await page.screenshot({ path: `${SHOTS}/11c-approve.png` })
  await dlg.locator('button[type=submit]').click(); await sleep(900)
  check('القبول: الدور مشرف + ربط بمسجد الرحمة فقط', server.upserts.length === 1 && server.upserts[0].p_role === 'admin' && JSON.stringify(server.userMosques['44444444-4444-4444-4444-444444444444']) === JSON.stringify([MB]), JSON.stringify([server.upserts, server.userMosques]))
  const afterTxt = await page.locator('main').innerText()
  check('بعد القبول: يختفي من الطلبات ويظهر في المنظمين', (await page.locator('h2:has-text("طلبات تسجيل جديدة")').count()) === 0 && afterTxt.includes('new@x.test'), JSON.stringify({ hasPendingTitle: afterTxt.includes('طلبات تسجيل جديدة'), hasEmail: afterTxt.includes('new@x.test'), pending: server.pending.length }))

  // ---- 9و) تنبيه الأسماء المشابهة (أول 3 كلمات) في مسجد آخر
  await page.goto(BASE + '/participants'); await page.waitForSelector('text=+ إضافة'); await sleep(600)
  await page.click('button:has-text("مسجد النور")'); await sleep(200)
  await page.click('button:has-text("+ إضافة")'); await page.waitForSelector('[role=dialog]')
  const nameInput = page.locator('[role=dialog] input').first()
  await nameInput.fill('علي حسن محمود الشريف'); await sleep(900)
  check('التنبيه يُحسب في الخادم (المشرف لا يرى أطفال المساجد الأخرى)', (server.calls.similar || 0) >= 1)
  const dtxt = await page.locator('[role=dialog]').innerText()
  check('تنبيه الاسم المشابه: يذكر "غالبًا مكرر" واسم الطفل والمسجد الآخر', dtxt.includes('غالبًا مكرر') && dtxt.includes('علي حسن محمود') && dtxt.includes('مسجد الرحمة'), dtxt)
  check('الزر يصبح "إضافة رغم ذلك" (لا منع، فقط تنبيه)', (await page.locator('[role=dialog] button[type=submit]').innerText()).includes('رغم ذلك'))
  await page.screenshot({ path: `${SHOTS}/10c-similar-warning.png` })
  await nameInput.fill('سامي رضا هاني'); await sleep(900)
  check('اسم مختلف: لا تنبيه', !(await page.locator('[role=dialog]').innerText()).includes('غالبًا مكرر'))
  // نقل الطفل بدل تكراره (مع بقاء سجل حضوره)
  const moveKid = server.participants.find((x) => x.name === 'علي حسن محمود')
  addAtt(moveKid.id, addDays(TODAY, -3)); addAtt(moveKid.id, addDays(TODAY, -4))
  const oldNo = moveKid.child_no
  await nameInput.fill('علي حسن محمود الشريف'); await sleep(900)
  await page.click('[role=dialog] button:has-text("نقله هنا بدل تكراره")')
  check('النقل يطلب تأكيدًا ويشرح أن السجل يبقى', (await page.locator('[role=dialog]').innerText()).includes('بيفضل معاه'))
  await page.screenshot({ path: `${SHOTS}/10c2-transfer-confirm.png` })
  await page.click('[role=dialog] button:has-text("تأكيد النقل")'); await sleep(900)
  check('النقل: الطفل صار في مسجد النور بنفس الاسم والمعرّف (لا تكرار)', moveKid.mosque_id === MA && server.participants.filter((x) => x.name === 'علي حسن محمود').length === 1 && server.calls.transfer === 2 /* الأولى من الاستيراد */, JSON.stringify({ m: moveKid.mosque_id, n: server.participants.filter((x) => x.name === 'علي حسن محمود').length, t: server.calls.transfer }))
  check('النقل: يأخذ رقمًا جديدًا في المسجد الجديد وسجل حضوره (يومان) باقٍ', moveKid.child_no === Math.max(...server.participants.filter((x) => x !== moveKid && x.mosque_id === MA).map((x) => x.child_no)) + 1 && server.attendance.filter((a) => a.participant_id === moveKid.id && a.status === 'valid').length === 2, `${oldNo} -> ${moveKid.child_no}`)
  check('بعد النقل: يُغلق النموذج ويظهر الطفل في قائمة النور', (await page.locator('[role=dialog]').count()) === 0 && (await page.locator('main li:has-text("علي حسن محمود")').count()) === 1)

  // ---- 9ز) إضافة طفل بدون إنترنت ثم مزامنته (مع حضوره)
  await page.click('button:has-text("مسجد الرحمة")'); await sleep(300)
  await page.reload(); await page.waitForSelector('text=+ إضافة'); await sleep(1500) // كاش الـ PWA جاهز
  const partsBefore = server.participants.length
  await context.setOffline(true); await sleep(300)
  check('أوفلاين: زر "+ إضافة" ما زال مفعّلًا', !(await page.locator('button:has-text("+ إضافة")').isDisabled()))
  await page.click('button:has-text("+ إضافة")'); await page.waitForSelector('[role=dialog]')
  await page.locator('[role=dialog] input').first().fill('طفل أوفلاين تجربة')
  await page.click('[role=dialog] button[type=submit]')
  await page.waitForSelector('text=على هذا الجهاز', { timeout: 5000 })
  await sleep(500)
  check('أوفلاين: الطفل محفوظ محليًا ولم يصل للخادم', (await idbCount('newChildren')) === 1 && server.participants.length === partsBefore)
  check('أوفلاين: يظهر في القائمة بشارة "بانتظار الإرسال"', (await page.locator('main li:has-text("طفل أوفلاين تجربة")').innerText()).includes('بانتظار الإرسال'))
  await page.screenshot({ path: `${SHOTS}/10d-offline-child.png` })
  await page.click('nav a:has-text("التحضير")'); await page.waitForSelector('input[type=search]'); await sleep(400)
  await page.click('button:has-text("طفل أوفلاين تجربة")'); await sleep(500)
  check('أوفلاين: يمكن تحضير الطفل الجديد فورًا', (await page.locator('li:has-text("طفل أوفلاين تجربة")').innerText()).includes('محفوظ على الجهاز'))
  check('الشريط يعرض عنصرين معلّقين (الطفل + حضوره)', (await page.locator('header').innerText()).includes('2 بانتظار المزامنة'), await page.locator('header').innerText())
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await sleep(4000)
  const newKid = server.participants.find((x) => x.name === 'طفل أوفلاين تجربة')
  check('بعد عودة الاتصال: الطفل أُنشئ في الخادم في المسجد الصحيح (مرة واحدة)', !!newKid && newKid.mosque_id === MB && server.participants.filter((x) => x.name === 'طفل أوفلاين تجربة').length === 1 && server.calls.addParticipant === 1)
  check('الطفل الجديد في الرحمة أخذ أصغر رقم فاضي (رقم من انتقلوا) وليس آخر رقم', newKid.child_no === oldNo && newKid.child_no < Math.max(...server.participants.filter((x) => x.mosque_id === MB).map((x) => x.child_no)), `${newKid.child_no} vs freed ${oldNo}`)
  check('وحضوره سُجّل بعد الطفل (بدون رفض)', !!newKid && server.attendance.some((a) => a.participant_id === newKid.id && a.attendance_date === TODAY && a.status === 'valid'))
  check('الطابور المحلي فاضي والشريط "كل شيء متزامن"', (await idbCount('newChildren')) === 0 && (await page.locator('header').innerText()).includes('كل شيء متزامن'))

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
  check('Recorder (مسجد واحد): لا شرائح مساجد، يرى اسم مسجده فقط', (await page.locator('main').innerText()).includes('مسجد النور') && (await page.locator('button:has-text("كل المساجد")').count()) === 0)
  check('Recorder: يرى أطفال مسجد النور فقط (5 + المنقول) ولا يرى أطفال الرحمة', (await page.locator('main li').count()) === 7 && (await page.locator('main').innerText()).includes('أحمد') && !(await page.locator('main').innerText()).includes('إبراهيم'))
  await page.goto(BASE + '/participants'); await page.waitForSelector('main ul li')
  check('Recorder: لا زر إضافة ولا استيراد', (await page.locator('button:has-text("استيراد")').count()) === 0 && (await page.locator('button:has-text("+ إضافة")').count()) === 0)
  await page.screenshot({ path: `${SHOTS}/12-recorder.png` })

  // ---- 11) لا أخطاء JS غير متوقعة
  const bad = errors.filter((e) => !/Failed to load resource|net::ERR|Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/i.test(e))
  check('لا أخطاء JavaScript غير متوقعة في الـ console', bad.length === 0, bad.slice(0, 3).join(' || '))

  await browser.close()
  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
})().catch((e) => { console.error('E2E CRASH', e); process.exit(2) })
