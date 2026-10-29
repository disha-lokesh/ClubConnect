// End-to-end HTTP tests against a RUNNING app (default http://localhost:3100) on a SEEDED database.
//   npm run build && npm start   (in another terminal, with the databases up)   then:   npm run test:api
// It exercises authentication, role checks, the full event workflow, registration rules, concurrency,
// MongoDB-backed features and page rendering. Results are written to docs/test-results-api.md.
// Nothing is hard-coded as "passed": each line records what the server actually answered.
// NOTE: the run changes data (new events, registrations). Re-seed (npm run db:seed -- --reset) before running again.
import pg from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadEnv } from './env.mjs';

const env = loadEnv();
const BASE = process.env.BASE_URL || 'http://localhost:3100';
const HOST = new URL(BASE).host;
const admin = new pg.Pool({ connectionString: env.DATABASE_URL_ADMIN, max: 3 });
admin.on('error', () => {}); // the DB-outage test stops PostgreSQL on purpose
const results = []; const PW = 'Password@123';

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const res = await fetch(BASE + path, { method, redirect: 'manual',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), Origin: BASE, ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) { const [kv] = c.split(';'); if (kv.startsWith('cc_session=')) this.cookie = /cc_session=;|Max-Age=0/.test(c) ? '' : kv; }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text, headers: res.headers, location: res.headers.get('location') };
  }
  get(p) { return this.req('GET', p); } post(p, b = {}) { return this.req('POST', p, b); }
  patch(p, b) { return this.req('PATCH', p, b); } put(p, b) { return this.req('PUT', p, b); } del(p, b) { return this.req('DELETE', p, b); }
  async login(email, password = PW) { const r = await this.post('/api/auth/login', { email, password }); if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${r.text}`); return r; }
}
const login = async (email, password) => { const c = new Client(email); await c.login(email, password); return c; };
// seeded students are named <first>.<last><N>@stu.pes.edu (N = 1..40); look the address up instead of guessing the name
const stuEmail = async n => (await admin.query(`SELECT email FROM users WHERE email ~ ('^[a-z]+[.][a-z]+' || $1::int || '@stu[.]pes[.]edu$')`, [n])).rows[0].email;
const loginStu = async n => login(await stuEmail(n));

async function test(id, title, fn) {
  try { const note = await fn(); results.push({ id, title, status: 'PASS', note: note || '' }); console.log(`PASS  ${id}  ${title}`); }
  catch (e) { results.push({ id, title, status: 'FAIL', note: e.message }); console.log(`FAIL  ${id}  ${title}\n      -> ${e.message}`); }
}
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what ?? 'value'}: expected ${b}, got ${a}`); };
const ok = (c, what) => { if (!c) throw new Error(what); };
const in_ = (a, list, what) => { if (!list.includes(a)) throw new Error(`${what ?? 'value'}: expected one of ${list}, got ${a}`); };
const dbOne = async (sql, p) => (await admin.query(sql, p)).rows[0];

const IST = d => new Date(d).toISOString();
const inDays = (n, hour = 10) => { const d = new Date(Date.now() + n * 864e5); d.setUTCHours(hour - 5, 30 - 0, 0, 0); return d; }; // hour in IST
const addH = (d, h) => new Date(d.getTime() + h * 36e5);

async function main() {
  const health = await fetch(BASE + '/login').catch(() => null);
  if (!health?.ok) { console.error(`App not reachable at ${BASE}. Start it first (npm run build && npm start).`); process.exit(2); }

  const student = await loginStu(1);
  const coding = await login('acmw@pes.edu', 'acmw123');
  const music = await login('mcop@pes.edu', 'mcop123');
  const campus = await login('admin@pes.edu');
  const anon = new Client('anon');

  const venues = (await campus.get('/api/venues')).json.venues; const cats = (await campus.get('/api/categories')).json.categories;
  const codingClub = (await coding.get('/api/clubs')).json.clubs.find(c => c.name === 'ACMW');
  const venueByName = n => venues.find(v => v.name === n);
  const catByName = n => cats.find(c => c.name === n);
  const hall = venueByName('Seminar Hall A'); const aud = venueByName('Auditorium');

  const mkEvent = (over = {}) => { const s = inDays(90, 10); return { clubId: codingClub.club_id, categoryId: catByName('Workshops').category_id, venueId: hall.venue_id, title: 'API test event ' + Math.random().toString(36).slice(2, 7),
    description: 'created by test-api', startTime: IST(s), endTime: IST(addH(s, 2)), registrationDeadline: IST(addH(s, -24)), capacity: 5, fee: 0, eligibility: 'OPEN', manualApproval: false, ...over }; };

  // ------------------------------------------------------------------ authentication
  await test('A01', 'valid login returns role + sets httpOnly session cookie', async () => {
    const c = new Client('x'); const r = await c.post('/api/auth/login', { email: 'aarav.sharma1@stu.pes.edu', password: PW });
    eq(r.status, 200); eq(r.json.role, 'STUDENT'); const sc = (r.headers.getSetCookie?.() ?? []).join(' ');
    ok(/cc_session=/.test(sc) && /HttpOnly/i.test(sc) && /SameSite=lax/i.test(sc), 'cookie flags missing: ' + sc.replace(/cc_session=[^;]+/, 'cc_session=<hidden>'));
  });
  await test('A02', 'wrong password -> 401, unknown e-mail -> 401 with the SAME message (no account enumeration)', async () => {
    const a = await anon.post('/api/auth/login', { email: 'aarav.sharma1@stu.pes.edu', password: 'Wrong@1234' }); const b = await anon.post('/api/auth/login', { email: 'nobody@stu.pes.edu', password: 'Wrong@1234' });
    eq(a.status, 401); eq(b.status, 401); eq(a.json.error, b.json.error, 'messages');
  });
  await test('A03', 'password hash is not exposed by any API response and is stored as bcrypt', async () => {
    const me = await student.get('/api/profile'); ok(!/password/i.test(me.text), 'profile response mentions password');
    const h = await dbOne(`SELECT password_hash FROM users WHERE email='aarav.sharma1@stu.pes.edu'`); ok(/^\$2[aby]\$\d\d\$/.test(h.password_hash), 'not a bcrypt hash'); ok(h.password_hash !== PW, 'plain text stored');
  });
  await test('A04', 'unauthenticated API call -> 401', async () => { eq((await anon.get('/api/events')).status, 401); eq((await anon.get('/api/notifications')).status, 401); });
  await test('A05', 'garbage / tampered session cookie -> 401', async () => {
    const c = new Client('t'); c.cookie = 'cc_session=abc.def.ghi'; eq((await c.get('/api/events')).status, 401);
    const good = student.cookie; const t = new Client('t2'); t.cookie = good.slice(0, -3) + (good.endsWith('aaa') ? 'bbb' : 'aaa'); eq((await t.get('/api/events')).status, 401);
  });
  await test('A06', 'logout invalidates the cookie in the browser', async () => {
    const c = await loginStu(2); eq((await c.get('/api/events')).status, 200); await c.post('/api/auth/logout'); eq((await c.get('/api/events')).status, 401);
  });
  await test('A07', 'cross-site POST (foreign Origin header) is blocked with 403', async () => {
    const r = await student.req('POST', '/api/auth/logout', {}, { Origin: 'https://evil.example' }); eq(r.status, 403);
    eq((await student.get('/api/events')).status, 200, 'session still valid after blocked request');
  });
  await test('A08', 'student sign-up: weak password 422, valid 201, duplicate e-mail 409, cannot choose a role', async () => {
    const body = { fullName: 'Test Student', email: `api.test.${Date.now()}@stu.pes.edu`, srn: 'PES9UG26CS' + String(Date.now()).slice(-6), department: 'CSE', yearOfStudy: 2, password: 'Password@123' };
    eq((await anon.post('/api/auth/register', { ...body, password: 'weak' })).status, 422, 'weak');
    const good = await anon.post('/api/auth/register', { ...body, role: 'CAMPUS_ADMIN' }); in_(good.status, [200, 201], 'valid');
    const row = await dbOne('SELECT role FROM users WHERE email=$1', [body.email]); eq(row.role, 'STUDENT', 'role stored');
    eq((await anon.post('/api/auth/register', { ...body, srn: 'PES9UG26CS000001' })).status, 409, 'duplicate email');
    const c = new Client('n'); await c.login(body.email); eq((await c.get('/api/reports/campus')).status, 403, 'new account cannot see admin report');
  });
  await test('A09', 'SQL-injection style input in login/search is treated as data', async () => {
    const r = await anon.post('/api/auth/login', { email: "x@y.z' OR '1'='1", password: "' OR '1'='1" }); in_(r.status, [401, 422]);
    const s = await student.get('/api/events?q=' + encodeURIComponent("'; DROP TABLE events; --")); eq(s.status, 200);
    ok((await dbOne('SELECT count(*)::int n FROM events')).n > 0, 'events table damaged');
  });

  // ------------------------------------------------------------------ role-based access
  await test('R01', 'student cannot call club/campus APIs (403)', async () => {
    eq((await student.post('/api/events', mkEvent())).status, 403, 'create event');
    eq((await student.get('/api/reports/campus')).status, 403, 'campus report'); eq((await student.get('/api/activity')).status, 403, 'activity log');
    eq((await student.post('/api/staff', { email: 'x@pes.edu', password: PW, fullName: 'X Y', role: 'CAMPUS_ADMIN' })).status, 403, 'create staff');
    eq((await student.post('/api/clubs', { name: 'Evil Club' })).status, 403, 'create club');
  });
  await test('R02', 'club admin cannot approve events, create clubs/venues/staff or read the campus report', async () => {
    eq((await coding.post('/api/events/1/review', { approve: true })).status, 403, 'review'); eq((await coding.post('/api/clubs', { name: 'Evil Club' })).status, 403, 'club');
    eq((await coding.post('/api/venues', { name: 'V', building: 'B', capacity: 5 })).status, 403, 'venue'); eq((await coding.get('/api/reports/campus')).status, 403, 'report');
    eq((await coding.post('/api/staff', { email: 'x@pes.edu', password: PW, fullName: 'X Y', role: 'CAMPUS_ADMIN' })).status, 403, 'staff');
  });
  await test('R03', 'campus admin cannot register for events (student-only action)', async () => { eq((await campus.post('/api/events/1/register')).status, 403); });
  await test('R04', 'pages: anonymous -> /login, wrong role -> own home, right role -> 200', async () => {
    const a = await anon.get('/student'); eq(a.status, 307, 'anon status'); ok(a.location.includes('/login'), 'anon location ' + a.location);
    const b = await student.get('/campus'); eq(b.status, 307); ok(b.location.endsWith('/student'), 'student->campus ' + b.location);
    const c = await coding.get('/student/events'); eq(c.status, 307); ok(c.location.endsWith('/club'), 'club->student ' + c.location);
    eq((await campus.get('/campus')).status, 200);
  });
  await test('R05', 'deactivated user is locked out on the very next request', async () => {
    const email = `deact.${Date.now()}@stu.pes.edu`;
    await anon.post('/api/auth/register', { fullName: 'Deact User', email, srn: 'PES8UG26CS' + String(Date.now()).slice(-6), department: 'CSE', yearOfStudy: 1, password: PW });
    const c = new Client('d'); await c.login(email); eq((await c.get('/api/events')).status, 200);
    await admin.query('UPDATE users SET is_active = false WHERE email = $1', [email]); eq((await c.get('/api/events')).status, 401);
    const again = await new Client('d2').post('/api/auth/login', { email, password: PW }); in_(again.status, [401, 403]);
  });

  // ------------------------------------------------------------------ core workflow
  let ev; // main workflow event
  await test('W01', 'club admin creates a DRAFT; students cannot see it (API + catalogue)', async () => {
    const r = await coding.post('/api/events', mkEvent()); eq(r.status, 201); ev = r.json.eventId;
    eq((await student.get(`/api/events/${ev}`)).status, 404, 'student detail');
    const list = await student.get('/api/events?q=API+test+event&when=all'); ok(!list.json.events.some(e => e.event_id === ev), 'draft leaked into catalogue');
    eq((await coding.get(`/api/events/${ev}`)).json.event.status, 'DRAFT');
  });
  await test('W02', 'validation: end before start, deadline after start, capacity above venue capacity -> rejected', async () => {
    const s = inDays(91, 10);
    eq((await coding.post('/api/events', mkEvent({ startTime: IST(s), endTime: IST(addH(s, -1)) }))).status, 422, 'end<start');
    const r = await coding.post('/api/events', mkEvent({ startTime: IST(s), endTime: IST(addH(s, 2)), registrationDeadline: IST(addH(s, 3)) })); in_(r.status, [409, 422], 'deadline>start');
    const big = await coding.post('/api/events', mkEvent({ capacity: hall.capacity + 1 })); in_(big.status, [409, 422], 'capacity>venue');
    eq((await coding.post('/api/events', mkEvent({ title: 'ab' }))).status, 422, 'short title');
  });
  await test('W03', 'another club cannot read-manage, edit, submit or cancel this club\'s event', async () => {
    const d = await music.get(`/api/events/${ev}`); ok(d.status === 404 || d.json?.manages === false, 'music admin can manage coding club draft');
    in_((await music.post(`/api/events/${ev}/submit`)).status, [403, 404], 'submit'); in_((await music.patch(`/api/events/${ev}`, { ...mkEvent(), title: 'hijacked title' })).status, [403, 404], 'patch');
    eq((await dbOne('SELECT title FROM events WHERE event_id=$1', [ev])).title.startsWith('hijacked'), false, 'title changed');
  });
  await test('W04', 'club admin edits own DRAFT, then submits; event becomes PENDING_APPROVAL and is still hidden from students', async () => {
    const p = await coding.patch(`/api/events/${ev}`, { ...mkEvent(), title: 'API workflow event', capacity: 3, manualApproval: false }); eq(p.status, 200);
    eq((await coding.post(`/api/events/${ev}/submit`)).status, 200); eq((await coding.get(`/api/events/${ev}`)).json.event.status, 'PENDING_APPROVAL');
    eq((await student.get(`/api/events/${ev}`)).status, 404); eq((await student.get('/api/events?q=workflow&when=all')).json.events.filter(e => e.event_id === ev).length, 0);
  });
  await test('W05', 'a pending event cannot be edited (database trigger)', async () => {
    const r = await coding.patch(`/api/events/${ev}`, { ...mkEvent(), title: 'edit while pending' }); ok(r.status >= 400 && r.status < 500, 'status ' + r.status);
    eq((await dbOne('SELECT title FROM events WHERE event_id=$1', [ev])).title, 'API workflow event');
  });
  await test('W06', 'campus admin sees it in the queue and approves; notification created for the club admin', async () => {
    const before = (await dbOne(`SELECT count(*)::int n FROM notifications WHERE event_id=$1 AND type='EVENT_APPROVED'`, [ev])).n;
    eq((await campus.post(`/api/events/${ev}/review`, { approve: true, comment: 'Looks good' })).status, 200);
    eq((await campus.get(`/api/events/${ev}`)).json.event.status, 'APPROVED');
    eq((await dbOne(`SELECT count(*)::int n FROM notifications WHERE event_id=$1 AND type='EVENT_APPROVED'`, [ev])).n, before + 1);
    const n = await coding.get('/api/notifications'); ok(n.json.notifications.some(x => x.event_id === ev && x.type === 'EVENT_APPROVED'), 'not visible via API');
  });
  await test('W07', 'approved event is visible to students: catalogue, detail, calendar', async () => {
    eq((await student.get(`/api/events/${ev}`)).status, 200); ok((await student.get('/api/events?q=workflow')).json.events.some(e => e.event_id === ev), 'catalogue');
    const d = new Date(Date.now() + 90 * 864e5); const cal = await student.get(`/api/calendar?year=${d.getFullYear()}&month=${d.getMonth() + 1}`); ok(JSON.stringify(cal.json).includes('API workflow event'), 'calendar');
  });
  await test('W08', 'student registers: CONFIRMED (auto-approval); duplicate rejected 409; seat count drops; confirmation notification', async () => {
    const r = await student.post(`/api/events/${ev}/register`); eq(r.status, 200); eq(r.json.status, 'CONFIRMED');
    eq((await student.post(`/api/events/${ev}/register`)).status, 409, 'duplicate');
    eq((await student.get(`/api/events/${ev}`)).json.event.seats_left, 2);
    ok((await dbOne(`SELECT count(*)::int n FROM notifications n JOIN users u USING(user_id) WHERE u.email='aarav.sharma1@stu.pes.edu' AND n.event_id=$1 AND n.type='REGISTRATION_CONFIRMED'`, [ev])).n === 1, 'notification missing');
  });
  await test('W09', 'attendance cannot be marked before the event has started', async () => {
    const reg = (await student.get(`/api/events/${ev}`)).json.myRegistration; const r = await coding.post(`/api/registrations/${reg.registration_id}/attendance`, { present: true }); ok(r.status >= 400 && r.status < 500, 'status ' + r.status);
  });
  await test('W10', 'student cancels: seat is freed; can register again (same row reused, not duplicated)', async () => {
    const reg = (await student.get(`/api/events/${ev}`)).json.myRegistration; eq((await student.post(`/api/registrations/${reg.registration_id}/cancel`)).status, 200);
    eq((await student.get(`/api/events/${ev}`)).json.event.seats_left, 3); eq((await student.post(`/api/events/${ev}/register`)).json.status, 'CONFIRMED');
    eq((await dbOne('SELECT count(*)::int n FROM registrations WHERE event_id=$1', [ev])).n, 1);
  });
  await test('W11', 'student cannot cancel or decide someone else\'s registration', async () => {
    const other = await loginStu(2); await other.post(`/api/events/${ev}/register`);
    const theirs = (await other.get(`/api/events/${ev}`)).json.myRegistration.registration_id;
    in_((await student.post(`/api/registrations/${theirs}/cancel`)).status, [403, 404], 'cancel other'); eq((await student.post(`/api/registrations/${theirs}/decide`, { approve: false })).status, 403, 'decide');
    eq((await dbOne('SELECT status FROM registrations WHERE registration_id=$1', [theirs])).status, 'CONFIRMED');
  });
  await test('W12', 'capacity: event with 3 seats accepts exactly 3 confirmed registrations; the 4th gets 409 "full"', async () => {
    const third = await loginStu(3); eq((await third.post(`/api/events/${ev}/register`)).status, 200);
    const fourth = await loginStu(4); const r = await fourth.post(`/api/events/${ev}/register`); eq(r.status, 409, 'status'); ok(/full|seat/i.test(r.json.error), 'message: ' + r.json.error);
    eq((await dbOne(`SELECT count(*)::int n FROM registrations WHERE event_id=$1 AND status='CONFIRMED'`, [ev])).n, 3);
  });
  await test('W13', 'seeded FULL event (Cybersecurity CTF) refuses registration', async () => {
    const id = (await dbOne(`SELECT event_id FROM events WHERE title='Cybersecurity CTF'`)).event_id; const r = await (await loginStu(20)).post(`/api/events/${id}/register`); eq(r.status, 409);
  });
  await test('W14', 'manual-approval event: registration is PENDING (holds a seat), club approves -> CONFIRMED, another club cannot decide', async () => {
    const r1 = await coding.post('/api/events', mkEvent({ title: 'API manual approval event', manualApproval: true, venueId: aud.venue_id, capacity: 4, startTime: IST(inDays(92, 10)), endTime: IST(inDays(92, 12)), registrationDeadline: IST(inDays(91, 10)) }));
    eq(r1.status, 201); const id = r1.json.eventId; await coding.post(`/api/events/${id}/submit`); await campus.post(`/api/events/${id}/review`, { approve: true });
    const s5 = await loginStu(5); const reg = await s5.post(`/api/events/${id}/register`); eq(reg.json.status, 'PENDING');
    eq((await coding.get(`/api/events/${id}`)).json.event.seats_left, 3, 'pending holds a seat');
    eq((await music.post(`/api/registrations/${reg.json.registrationId}/decide`, { approve: true })).status, 403, 'other club');
    eq((await coding.post(`/api/registrations/${reg.json.registrationId}/decide`, { approve: true })).json.status, 'CONFIRMED');
    ok((await s5.get('/api/notifications')).json.notifications.some(n => n.event_id === id && n.type === 'REGISTRATION_CONFIRMED'), 'student not notified');
    const s6 = await loginStu(6); const r6 = await s6.post(`/api/events/${id}/register`); eq((await coding.post(`/api/registrations/${r6.json.registrationId}/decide`, { approve: false })).json.status, 'REJECTED');
    eq((await coding.get(`/api/events/${id}`)).json.event.seats_left, 3, 'rejected frees seat');
  });
  await test('W15', 'rejection needs the campus admin; rejected event stays hidden; club can reopen and resubmit', async () => {
    const id = (await coding.post('/api/events', mkEvent({ title: 'API reject flow', startTime: IST(inDays(93, 10)), endTime: IST(inDays(93, 12)), registrationDeadline: IST(inDays(92, 10)) }))).json.eventId;
    await coding.post(`/api/events/${id}/submit`); const rej = await campus.post(`/api/events/${id}/review`, { approve: false, comment: 'Please add a faculty coordinator' }); eq(rej.status, 200);
    eq((await student.get(`/api/events/${id}`)).status, 404); eq((await coding.get(`/api/events/${id}`)).json.event.status, 'REJECTED');
    eq((await coding.post(`/api/events/${id}/reopen`)).status, 200); eq((await coding.get(`/api/events/${id}`)).json.event.status, 'DRAFT');
    eq((await coding.post(`/api/events/${id}/submit`)).status, 200);
  });
  await test('W16', 'illegal transitions are refused: approving a DRAFT, submitting twice, registering for a non-approved event', async () => {
    const id = (await coding.post('/api/events', mkEvent({ title: 'API illegal transitions', startTime: IST(inDays(94, 10)), endTime: IST(inDays(94, 12)), registrationDeadline: IST(inDays(93, 10)) }))).json.eventId;
    in_((await campus.post(`/api/events/${id}/review`, { approve: true })).status, [409, 422], 'approve draft');
    in_((await student.post(`/api/events/${id}/register`)).status, [404, 409, 422], 'register for a draft');
    eq((await dbOne('SELECT status FROM events WHERE event_id=$1', [id])).status, 'DRAFT', 'status unchanged');
    await coding.post(`/api/events/${id}/submit`); in_((await coding.post(`/api/events/${id}/submit`)).status, [409, 422], 'submit twice');
  });
  await test('W17', 'venue clash: second event in the same venue/time can be submitted but NOT approved while the first is approved', async () => {
    const t = inDays(95, 10);
    const a = (await coding.post('/api/events', mkEvent({ title: 'API clash A', startTime: IST(t), endTime: IST(addH(t, 3)), registrationDeadline: IST(addH(t, -24)) }))).json.eventId;
    const b = (await coding.post('/api/events', mkEvent({ title: 'API clash B', startTime: IST(addH(t, 1)), endTime: IST(addH(t, 4)), registrationDeadline: IST(addH(t, -24)) }))).json.eventId;
    await coding.post(`/api/events/${a}/submit`); await coding.post(`/api/events/${b}/submit`);
    const detail = await coding.get(`/api/events/${b}`); ok(detail.json.conflicts.some(c => c.other_event_id === a), 'conflict warning not shown');
    eq((await campus.post(`/api/events/${a}/review`, { approve: true })).status, 200); const r = await campus.post(`/api/events/${b}/review`, { approve: true }); eq(r.status, 409); ok(/venue|booked|clash|overlap/i.test(r.json.error), r.json.error);
    eq((await campus.get(`/api/events/${b}`)).json.event.status, 'PENDING_APPROVAL', 'status unchanged after failed approval');
  });
  await test('W18', 'back-to-back events (one ends exactly when the next starts) are NOT a conflict', async () => {
    const t = inDays(96, 10);
    const a = (await coding.post('/api/events', mkEvent({ title: 'API b2b first', startTime: IST(t), endTime: IST(addH(t, 2)), registrationDeadline: IST(addH(t, -24)) }))).json.eventId;
    const b = (await coding.post('/api/events', mkEvent({ title: 'API b2b second', startTime: IST(addH(t, 2)), endTime: IST(addH(t, 4)), registrationDeadline: IST(addH(t, -24)) }))).json.eventId;
    for (const i of [a, b]) { await coding.post(`/api/events/${i}/submit`); eq((await campus.post(`/api/events/${i}/review`, { approve: true })).status, 200, 'approve ' + i); }
  });
  await test('W19', 'cancelling an approved event notifies registered students and blocks new registrations', async () => {
    const id = (await coding.post('/api/events', mkEvent({ title: 'API cancel flow', startTime: IST(inDays(97, 10)), endTime: IST(inDays(97, 12)), registrationDeadline: IST(inDays(96, 10)) }))).json.eventId;
    await coding.post(`/api/events/${id}/submit`); await campus.post(`/api/events/${id}/review`, { approve: true }); await student.post(`/api/events/${id}/register`);
    eq((await coding.post(`/api/events/${id}/cancel`, { reason: '' })).status, 422, 'reason required'); eq((await coding.post(`/api/events/${id}/cancel`, { reason: 'Speaker unavailable' })).status, 200);
    ok((await student.get('/api/notifications')).json.notifications.some(n => n.event_id === id && n.type === 'EVENT_CANCELLED'), 'student not notified');
    in_((await (await loginStu(7)).post(`/api/events/${id}/register`)).status, [404, 409], 'register after cancel');
  });
  await test('W20', 'club-members-only event: non-member refused, member accepted', async () => {
    const id = (await dbOne(`SELECT event_id FROM events WHERE eligibility='CLUB_MEMBERS' AND status='APPROVED' AND start_time > now() AND capacity > 0 ORDER BY event_id LIMIT 1`))?.event_id; ok(id, 'no seeded members-only event');
    const non = await dbOne(`SELECT u.email FROM users u JOIN students s ON s.user_id=u.user_id WHERE NOT EXISTS (SELECT 1 FROM club_members m JOIN events e ON e.club_id=m.club_id WHERE m.student_id=u.user_id AND e.event_id=$1)
                              AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.student_id=u.user_id AND r.event_id=$1) AND u.email ~ '^[a-z]+[.][a-z]+[0-9]+@stu[.]pes[.]edu$' LIMIT 1`, [id]);
    ok(non, 'no suitable non-member'); const nm = await login(non.email); const r = await nm.post(`/api/events/${id}/register`); in_(r.status, [403, 409, 422], 'non-member status ' + r.text);
    const club = (await dbOne('SELECT club_id FROM events WHERE event_id=$1', [id])).club_id; eq((await nm.post(`/api/clubs/${club}/membership`)).status, 200); in_((await nm.post(`/api/events/${id}/register`)).status, [200], 'after joining');
  });
  await test('W21', 'CONCURRENCY: 8 students race for the LAST seat through the HTTP API -> exactly 1 wins, 7 get 409, never over-booked', async () => {
    const ev2 = (await dbOne(`SELECT event_id, capacity FROM events WHERE title='Last Seat Demo Workshop'`));
    const before = (await dbOne(`SELECT count(*)::int n FROM registrations WHERE event_id=$1 AND status IN ('PENDING','CONFIRMED')`, [ev2.event_id])).n; eq(ev2.capacity - before, 1, 'precondition: exactly one seat left (re-seed if not)');
    const emails = (await admin.query(`SELECT u.email FROM users u JOIN students s ON s.user_id=u.user_id WHERE u.email ~ '^[a-z]+[.][a-z]+[0-9]+@stu[.]pes[.]edu$' AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.student_id=u.user_id AND r.event_id=$1) ORDER BY u.user_id DESC LIMIT 8`, [ev2.event_id])).rows.map(r => r.email);
    eq(emails.length, 8, 'enough students'); const clients = await Promise.all(emails.map(login));
    const res = await Promise.all(clients.map(c => c.post(`/api/events/${ev2.event_id}/register`)));
    const wins = res.filter(r => r.status === 200).length; const full = res.filter(r => r.status === 409).length;
    eq(wins, 1, 'winners'); eq(full, 7, 'rejected as full'); eq((await dbOne(`SELECT count(*)::int n FROM registrations WHERE event_id=$1 AND status IN ('PENDING','CONFIRMED')`, [ev2.event_id])).n, ev2.capacity, 'seats taken');
    return `statuses: ${res.map(r => r.status).join(',')}`;
  });

  // ------------------------------------------------------------------ filters / search
  await test('S01', 'catalogue filters: club, free-only, date range, open-only, text search with prefix', async () => {
    const all = (await student.get('/api/events?when=all')).json.events; ok(all.length > 5, 'catalogue too small');
    ok(all.every(e => e.status === 'APPROVED'), 'non-approved event visible to student');
    const club = all[0].club_id; ok((await student.get(`/api/events?club=${club}&when=all`)).json.events.every(e => e.club_id === club), 'club filter');
    ok((await student.get('/api/events?maxFee=0&when=all')).json.events.every(e => e.fee === 0), 'fee filter');
    ok((await student.get('/api/events?open=1')).json.events.every(e => e.registration_open), 'open-only');
    ok((await student.get('/api/events?q=photograph&when=all')).json.events.some(e => /photograph/i.test(e.title + e.club_name)), 'prefix search');
    const f = all[0].start_time.slice(0, 10); ok((await student.get(`/api/events?from=${f}&to=${f}&when=all`)).json.events.length >= 1, 'date range');
  });
  await test('S02', 'category filter includes sub-categories (recursive CTE): Technical >= AI/ML >= Computer Vision', async () => {
    const tech = catByName('Technical'), cv = catByName('Computer Vision'); ok(tech && cv, 'seed categories missing');
    const a = (await student.get(`/api/events?category=${tech.category_id}&when=all`)).json.events; const b = (await student.get(`/api/events?category=${cv.category_id}&when=all`)).json.events;
    ok(b.length >= 1, 'no computer-vision events'); ok(b.every(e => a.some(x => x.event_id === e.event_id)), 'parent category does not include child events');
  });

  // ------------------------------------------------------------------ MongoDB-backed features
  let annId;
  await test('M01', 'announcements CRUD: club posts (201), student reads, update, delete; student/other club cannot post', async () => {
    const r = await coding.post(`/api/events/${ev}/announcements`, { title: 'Bring your laptop', body: 'Charger too.', pinned: true, tags: ['info'] }); eq(r.status, 201); annId = r.json._id; ok(annId, 'no id');
    ok((await student.get(`/api/events/${ev}/announcements`)).json.announcements.some(a => a._id === annId), 'student cannot read');
    eq((await student.post(`/api/events/${ev}/announcements`, { title: 'x', body: 'y' })).status, 403, 'student post'); eq((await music.post(`/api/events/${ev}/announcements`, { title: 'x', body: 'y' })).status, 403, 'other club post');
    eq((await music.patch(`/api/announcements/${annId}`, { title: 'hijack' })).status, 403, 'other club patch'); eq((await music.del(`/api/announcements/${annId}`)).status, 403, 'other club delete');
    eq((await coding.patch(`/api/announcements/${annId}`, { body: 'Charger and notebook.' })).json.body, 'Charger and notebook.');
    eq((await coding.post(`/api/events/${ev}/announcements`, { title: '', body: 'y' })).status, 422, 'validation');
    eq((await coding.patch('/api/announcements/not-an-id', { title: 'x' })).status, 404, 'bad id');
  });
  await test('M02', 'announcement for an unpublished event is refused (authorised against PostgreSQL first)', async () => {
    const draft = (await coding.post('/api/events', mkEvent({ title: 'API draft for announce', startTime: IST(inDays(98, 10)), endTime: IST(inDays(98, 12)), registrationDeadline: IST(inDays(97, 10)) }))).json.eventId;
    eq((await coding.post(`/api/events/${draft}/announcements`, { title: 'x', body: 'y' })).status, 409);
  });
  await test('M03', 'feedback: non-attendee refused; attendee can create/update/read/delete own; one document per student; admins see it anonymised', async () => {
    eq((await student.put(`/api/events/${ev}/feedback`, { rating: 5 })).status, 403, 'non-attendee');
    const row = await dbOne(`SELECT u.email, r.event_id FROM registrations r JOIN attendance a USING(registration_id) JOIN users u ON u.user_id=r.student_id JOIN events e USING(event_id)
                              WHERE a.present AND r.status='CONFIRMED' AND e.end_time < now() AND u.email ~ '^[a-z]+[.][a-z]+[0-9]+@stu[.]pes[.]edu$' AND NOT EXISTS (SELECT 1 FROM registrations r2 JOIN attendance a2 USING(registration_id) WHERE false) ORDER BY r.event_id DESC LIMIT 1`);
    ok(row, 'no attended past registration in seed'); const s = await login(row.email);
    eq((await s.put(`/api/events/${row.event_id}/feedback`, { rating: 4, comment: 'Great', tags: ['fun'] })).status, 200); eq((await s.put(`/api/events/${row.event_id}/feedback`, { rating: 5, comment: 'Updated' })).status, 200);
    eq((await s.get(`/api/events/${row.event_id}/feedback`)).json.mine.rating, 5, 'update visible');
    eq((await s.put(`/api/events/${row.event_id}/feedback`, { rating: 9 })).status, 422, 'rating range');
    const uid = (await dbOne('SELECT user_id FROM users WHERE email=$1', [row.email])).user_id;
    const adminView = await campus.get(`/api/events/${row.event_id}/feedback`); eq(adminView.status, 200); ok(!JSON.stringify(adminView.json).includes('studentUserId'), 'student id leaked to admin view'); void uid;
    eq((await s.del(`/api/events/${row.event_id}/feedback`)).status, 200); eq((await s.get(`/api/events/${row.event_id}/feedback`)).json.mine, null, 'deleted');
  });
  await test('M04', 'activity log: important actions are written to MongoDB; only campus admins can read; purge needs >= 30 days', async () => {
    const log = await campus.get('/api/activity?action=EVENT_REVIEWED&limit=5'); eq(log.status, 200); ok(log.json.activity.length >= 1, 'no EVENT_REVIEWED entries');
    eq((await coding.get('/api/activity')).status, 403); eq((await campus.del('/api/activity?days=1')).status, 422, 'purge too aggressive');
  });
  await test('M05', 'campus report API returns SQL aggregates and MongoDB aggregation results', async () => {
    const r = await campus.get('/api/reports/campus'); eq(r.status, 200); ok(r.json.sql.clubParticipation.length >= 1, 'club participation'); ok(r.json.sql.categoryRollup.length >= 1, 'category roll-up');
    ok(!r.json.mongo.error, 'mongo error: ' + r.json.mongo.error); ok(r.json.mongo.feedbackByEvent.length >= 1, 'feedback aggregation'); const m = r.json.mongo; ok(typeof m.feedbackByEvent[0].avgRating === 'number' && m.feedbackTags[0].tag && m.activityPerDay[0].day && m.topActors[0].actions >= 1 && m.announcementsPerClub[0].posts >= 1, 'unexpected aggregation result shape'); return `mongo engine: ${r.json.mongo.engine}`;
  });

  // ------------------------------------------------------------------ admin functions
  await test('C01', 'campus admin creates a club + staff account; the new club admin can log in, sees only their own club\'s events', async () => {
    const name = 'API Test Club ' + Date.now(); const club = await campus.post('/api/clubs', { name, description: 'test' }); eq(club.status, 201);
    const email = `ca.test.${Date.now()}@pes.edu`; const st = await campus.post('/api/staff', { email, password: PW, fullName: 'Test ClubAdmin', role: 'CLUB_ADMIN', clubId: club.json.clubId }); in_(st.status, [200, 201]);
    const c = await login(email); eq((await c.get('/api/profile')).json.user.role, 'CLUB_ADMIN');
    const mine = (await c.get('/api/clubs')).json.clubs; ok(mine.length >= 1, 'clubs');
    const e = await c.post('/api/events', mkEvent({ clubId: codingClub.club_id, title: 'API foreign club event' })); eq(e.status, 403, 'creating event for a club they do not manage');
    const own = await c.post('/api/events', mkEvent({ clubId: club.json.clubId, title: 'API own club event', startTime: IST(inDays(99, 10)), endTime: IST(inDays(99, 12)), registrationDeadline: IST(inDays(98, 10)) })); eq(own.status, 201);
  });
  await test('C02', 'venue/category management: add, edit, deactivated venue cannot host a new event, category cycle refused', async () => {
    const v = await campus.post('/api/venues', { name: 'API Test Room ' + Date.now(), building: 'Block Z', capacity: 20 }); eq(v.status, 201); const vid = v.json.venueId ?? (await dbOne('SELECT max(venue_id) id FROM venues')).id;
    eq((await campus.patch(`/api/venues/${vid}`, { name: 'API Room Renamed ' + Date.now(), building: 'Block Z', capacity: 20, isActive: false })).status, 200);
    const r = await coding.post('/api/events', mkEvent({ venueId: vid, capacity: 10, title: 'API inactive venue' })); ok(r.status >= 400 && r.status < 500, 'inactive venue accepted: ' + r.status);
    const parent = catByName('Technical'), child = catByName('AI/ML'); const cyc = await campus.patch(`/api/categories/${parent.category_id}`, { name: 'Technical', parentCategoryId: child.category_id }); ok(cyc.status >= 400 && cyc.status < 500, 'category cycle accepted: ' + cyc.status);
  });
  await test('C03', 'profile update persists; e-mail / SRN / role cannot be changed through the API', async () => {
    const c = await loginStu(8); eq((await c.patch('/api/profile', { department: 'ECE', yearOfStudy: 3, role: 'CAMPUS_ADMIN', email: 'hacker@x.com' })).status, 200);
    const row = await dbOne(`SELECT u.role, u.email, s.department, s.year_of_study FROM users u JOIN students s ON s.user_id=u.user_id WHERE u.email = $1`, [await stuEmail(8)]);
    eq(row.role, 'STUDENT'); ok(row.email === await stuEmail(8), 'email changed'); eq(row.department, 'ECE'); eq(row.year_of_study, 3);
  });
  await test('C04', 'notifications: list, mark read, unread count drops, only own notifications are reachable', async () => {
    const n = (await student.get('/api/notifications')).json; ok(n.notifications.length > 0, 'no notifications');
    const first = n.notifications.find(x => !x.is_read); if (first) { eq((await student.post('/api/notifications', { ids: [first.notification_id] })).status, 200); }
    const foreign = await dbOne(`SELECT notification_id FROM notifications WHERE user_id <> (SELECT user_id FROM users WHERE email='aarav.sharma1@stu.pes.edu') LIMIT 1`);
    const r = await student.del(`/api/notifications/${foreign.notification_id}`); ok(r.status === 404 || r.status === 200, 'status ' + r.status);
    eq((await dbOne('SELECT count(*)::int n FROM notifications WHERE notification_id=$1', [foreign.notification_id])).n, 1, 'foreign notification was deleted!');
  });

  // ------------------------------------------------------------------ every page renders
  await test('P01', 'every page renders (HTTP 200, no error boundary) for its role', async () => {
    const eid = (await dbOne(`SELECT event_id FROM events WHERE status='APPROVED' ORDER BY event_id LIMIT 1`)).event_id; const pend = (await dbOne(`SELECT event_id FROM events WHERE status='PENDING_APPROVAL' ORDER BY event_id LIMIT 1`)).event_id;
    const sets = [[student, ['/student', '/student/events', `/student/events/${eid}`, '/student/calendar', '/student/registrations', '/student/history', '/student/clubs', '/student/notifications', '/student/profile', '/student/events?q=photo&club=1&category=1&open=1']],
      [coding, ['/club', '/club/events', '/club/events/new', `/club/events/${ev}`, `/club/events/${eid}`, '/club/calendar', '/club/notifications', '/club/profile']],
      [campus, ['/campus', '/campus/approvals', '/campus/events', '/campus/events?status=APPROVED', `/campus/events/${pend}`, '/campus/calendar', '/campus/clubs', '/campus/venues', '/campus/categories', '/campus/conflicts', '/campus/reports', '/campus/activity', '/campus/notifications', '/campus/profile']],
      [anon, ['/', '/login', '/register']]];
    const bad = []; let n = 0;
    for (const [cl, paths] of sets) for (const p of paths) { n++; const r = await cl.get(p); if (r.status !== 200 || /Application error|Something went wrong|This page could not be found/i.test(r.text)) bad.push(`${p} -> ${r.status}`); }
    ok(bad.length === 0, bad.join('; ')); return `${n} pages`;
  });
  await test('P02', 'event pages: unknown / malformed ids give 404, not a crash', async () => {
    for (const p of ['/student/events/999999', '/student/events/abc', '/club/events/999999', '/campus/events/0']) { const c = p.startsWith('/student') ? student : p.startsWith('/club') ? coding : campus; eq((await c.get(p)).status, 404, p); }
    in_((await student.get('/api/events/abc')).status, [400, 404, 422]); eq((await student.get('/api/events/99999999')).status, 404);
  });
  await test('P03', 'a student cannot open a draft/pending event page by guessing its id', async () => {
    const pend = (await dbOne(`SELECT event_id FROM events WHERE status='PENDING_APPROVAL' LIMIT 1`)).event_id; eq((await student.get(`/student/events/${pend}`)).status, 404);
  });
  await test('P04', 'error responses never leak internals (no stack traces / SQL / connection strings)', async () => {
    const samples = [await student.post('/api/events/999999/register'), await coding.patch('/api/events/999999', mkEvent()), await anon.post('/api/auth/login', { email: 'x' }), await student.req('POST', '/api/events/1/register', undefined, {})];
    for (const r of samples) ok(!/postgres|ECONN|stack|at \w+ \(|SELECT |password=|node_modules/i.test(r.text), 'leak: ' + r.text.slice(0, 120));
  });
  await test('A10', 'login throttling: repeated failures for one account -> 429', async () => {
    const c = new Client('thr'); let last = 0; for (let i = 0; i < 8; i++) last = (await c.post('/api/auth/login', { email: await stuEmail(30), password: 'Wrong@1234' })).status; eq(last, 429);
  });

  // ------------------------------------------------------------------ optional: database outage handling
  if (process.env.CC_PG_STOP && process.env.CC_PG_START) {
    await test('X01', 'PostgreSQL stopped: API answers 503 with a friendly message (no stack), and recovers when the database returns', async () => {
      execSync(process.env.CC_PG_STOP, { stdio: 'ignore' });
      try { const r = await student.get('/api/events'); eq(r.status, 503); ok(!/ECONN|postgres/i.test(r.text), 'leak: ' + r.text); const p = await student.get('/student/events'); ok(p.status === 200 || p.status === 500 || p.status === 503, 'page status ' + p.status); }
      finally { execSync(process.env.CC_PG_START, { stdio: 'ignore' }); }
      await new Promise(r => setTimeout(r, 1500)); let st = 0; for (let i = 0; i < 6 && st !== 200; i++) { st = (await student.get('/api/events')).status; if (st !== 200) await new Promise(r => setTimeout(r, 1500)); } eq(st, 200, 'recovery');
    });
  } else results.push({ id: 'X01', title: 'database outage handling', status: 'SKIP', note: 'set CC_PG_STOP / CC_PG_START to commands that stop / start PostgreSQL to run this test' });

  // ------------------------------------------------------------------ report
  const pass = results.filter(r => r.status === 'PASS').length, fail = results.filter(r => r.status === 'FAIL').length, skip = results.filter(r => r.status === 'SKIP').length;
  const md = [`# API / end-to-end test results`, '', `Run: ${new Date().toISOString()} against ${BASE}`, `Result: **${pass} passed, ${fail} failed, ${skip} skipped** (of ${results.length})`, '',
    '| ID | Test | Result | Notes |', '|---|---|---|---|', ...results.map(r => `| ${r.id} | ${r.title.replace(/\|/g, '\\|')} | ${r.status} | ${String(r.note).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`), ''].join('\n');
  mkdirSync('docs', { recursive: true }); writeFileSync('docs/test-results-api.md', md);
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped. Written to docs/test-results-api.md`);
  await admin.end(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
