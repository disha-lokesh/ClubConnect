// Database-level test suite: constraints, triggers, functions, RBAC/RLS, workflow, concurrency.
// Runs against a SEEDED database (npm run db:setup). Every test runs in its own transaction that is rolled back,
// except the concurrency tests, which commit and then clean up after themselves.
// Output is printed and also written to docs/test-results-db.md. Nothing here is hard-coded as "passed".
import pg from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadEnv } from './env.mjs';

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL_ADMIN, max: 12 });
const ROLE = { STUDENT: 'app_student', CLUB_ADMIN: 'app_club_admin', CAMPUS_ADMIN: 'app_campus_admin' };
const results = [];

// ---- helpers -------------------------------------------------------------------------------------------
async function q(sql, p) { return (await pool.query(sql, p)).rows; }
const one = async (sql, p) => (await q(sql, p))[0];
const uidOf = async email => (await one('SELECT user_id FROM users WHERE email=$1', [email])).user_id;
const evId = async title => (await one('SELECT event_id FROM events WHERE title=$1', [title])).event_id;

// run fn(c) inside a txn acting as <role> for <userId>; always rolled back unless commit=true
async function as(role, userId, fn, { commit = false } = {}) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (role) await c.query(`SET LOCAL ROLE ${ROLE[role]}`);
    if (userId != null) await c.query(`SELECT set_config('app.user_id', $1, true)`, [String(userId)]);
    const r = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return r;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
// statement expected to FAIL; returns error info (uses a savepoint so the txn survives)
async function fails(c, sql, params) {
  await c.query('SAVEPOINT sp');
  try { await c.query(sql, params); await c.query('RELEASE sp'); return null; }
  catch (e) { await c.query('ROLLBACK TO sp'); return { code: e.code, message: e.message }; }
}
function check(cond, msg) { if (!cond) throw new Error(msg); }
function expectErr(err, code, frag) {
  check(err, 'expected an error but the statement succeeded');
  check(err.code === code, `expected SQLSTATE ${code} but got ${err.code}: ${err.message}`);
  if (frag) check(err.message.toLowerCase().includes(frag.toLowerCase()), `message "${err.message}" should contain "${frag}"`);
  return `${err.code}: ${err.message}`;
}
async function test(id, name, fn) {
  try { const detail = await fn(); results.push({ id, name, ok: true, detail: String(detail ?? '') }); console.log(`PASS ${id} ${name}`); }
  catch (e) { results.push({ id, name, ok: false, detail: e.message }); console.log(`FAIL ${id} ${name}\n     ${e.message}`); }
}

// ---- fixtures ------------------------------------------------------------------------------------------
const admin = await uidOf('admin@pes.edu');
const coding = await uidOf('acmw@pes.edu');
const music = await uidOf('mcop@pes.edu');
const photo = await uidOf('pixels@pes.edu');
const studs = (await q(`SELECT user_id FROM users WHERE role='STUDENT' ORDER BY user_id`)).map(r => r.user_id);
const E = {
  ctf: await evId('Cybersecurity CTF'), cv: await evId('Computer Vision Workshop'), master: await evId('Portrait Photography Masterclass'),
  rust: await evId('Rust for Beginners'), last: await evId('Last Seat Demo Workshop'), hack: await evId('24-Hour Hackathon'),
  bands: await evId('Battle of Bands'), web: await evId('Intro to Web Dev Bootcamp'), draft: await evId('Photography Exhibition'),
  rejected: await evId('Late Night Concert'), musicProd: await evId('Music Production Workshop'),
};
const notRegistered = async (eventId, n) => (await q(
  `SELECT user_id FROM users u WHERE role='STUDENT' AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.event_id=$1 AND r.student_id=u.user_id) ORDER BY user_id LIMIT $2`, [eventId, n])).map(r => r.user_id);

// ================================================================ CONSTRAINTS (run as table owner)
await test('TC-01', 'Duplicate e-mail (case-insensitive) is rejected', () => as(null, null, async c => {
  const e = await fails(c, `INSERT INTO users(email,password_hash,full_name,role) VALUES ('ADMIN@pes.edu','x','Dup','STUDENT')`);
  return expectErr(e, '23505', 'users_email_lower_uq'); }));
await test('TC-02', 'students row cannot point at a non-student account (role-pinned FK)', () => as(null, null, async c => {
  const e = await fails(c, `INSERT INTO students(user_id,srn,department,year_of_study) VALUES ($1,'X1','CSE',1)`, [coding]);
  return expectErr(e, '23503'); }));
await test('TC-03', 'Event end time must be after start time (CHECK)', () => as(null, coding, async c => {
  const e = await fails(c, `INSERT INTO events(club_id,category_id,venue_id,title,start_time,end_time,registration_deadline,capacity,created_by)
    VALUES (1,1,1,'Bad','2030-01-01 10:00+00','2030-01-01 09:00+00','2029-12-31 10:00+00',10,$1)`, [coding]);
  return expectErr(e, '23514', 'events_time_order'); }));
await test('TC-04', 'Event capacity above venue capacity is rejected (trigger)', () => as(null, coding, async c => {
  const e = await fails(c, `INSERT INTO events(club_id,category_id,venue_id,title,start_time,end_time,registration_deadline,capacity,created_by)
    VALUES (1,1,(SELECT venue_id FROM venues WHERE name='Lab 101'),'Too big','2030-01-01 10:00+00','2030-01-01 12:00+00','2029-12-31 10:00+00',500,$1)`, [coding]);
  return expectErr(e, 'CC422', 'exceeds venue capacity'); }));
await test('TC-05', 'Inactive venue cannot be booked', () => as(null, coding, async c => {
  const e = await fails(c, `INSERT INTO events(club_id,category_id,venue_id,title,start_time,end_time,registration_deadline,capacity,created_by)
    VALUES (1,1,(SELECT venue_id FROM venues WHERE name='Old Hall'),'Old','2030-01-01 10:00+00','2030-01-01 12:00+00','2029-12-31 10:00+00',10,$1)`, [coding]);
  return expectErr(e, 'CC422', 'not active'); }));
await test('TC-06', 'Negative fee is rejected (CHECK)', () => as(null, coding, async c => {
  const e = await fails(c, `UPDATE events SET fee = -5 WHERE event_id=$1`, [E.draft]); return expectErr(e, '23514'); }));
await test('TC-07', 'Rejecting an event without a reason is blocked (CHECK)', () => as(null, admin, async c => {
  const e = await fails(c, `UPDATE events SET status='REJECTED' WHERE event_id=$1`, [E.rust]); return expectErr(e, '23514', 'events_reject_reason'); }));
await test('TC-08', 'Illegal event status jump DRAFT -> APPROVED is blocked (trigger)', () => as(null, admin, async c => {
  const e = await fails(c, `UPDATE events SET status='APPROVED' WHERE event_id=$1`, [E.draft]); return expectErr(e, 'CC409', 'illegal event status'); }));
await test('TC-09', 'Approving an event that overlaps an approved one in the same venue fails (exclusion constraint)', () => as('CAMPUS_ADMIN', admin, async c => {
  const e = await fails(c, `SELECT review_event($1, true, NULL)`, [E.rust]); return expectErr(e, '23P01', 'events_no_venue_overlap'); }));
await test('TC-10', 'Back-to-back events in one venue are allowed (half-open ranges)', () => as(null, admin, async c => {
  const m = await one(`SELECT venue_id, end_time FROM events WHERE event_id=$1`, [E.master]);
  await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(photo)]);
  const r = await c.query(`INSERT INTO events(club_id,category_id,venue_id,title,start_time,end_time,registration_deadline,capacity,created_by)
    VALUES ((SELECT club_id FROM events WHERE event_id=$1),1,$2,'Back to back',$3,$3::timestamptz + interval '1 hour',$3::timestamptz - interval '1 day',10,$4) RETURNING event_id`,
    [E.master, m.venue_id, m.end_time, photo]);
  const id = r.rows[0].event_id;
  await c.query(`UPDATE events SET status='PENDING_APPROVAL' WHERE event_id=$1`, [id]);
  await c.query(`UPDATE events SET status='APPROVED', reviewed_by=$2, reviewed_at=now() WHERE event_id=$1`, [id, admin]);
  return 'event starting exactly when the previous one ends was approved'; }));
await test('TC-11', 'Duplicate registration is blocked by the UNIQUE constraint', () => as(null, null, async c => {
  const r = await one(`SELECT event_id, student_id FROM registrations WHERE status='CONFIRMED' LIMIT 1`);
  const e = await fails(c, `INSERT INTO registrations(event_id,student_id,status) VALUES ($1,$2,'CONFIRMED')`, [r.event_id, r.student_id]);
  return expectErr(e, '23505', 'registrations_one_per_student'); }));
await test('TC-12', 'Attendance cannot be recorded for a CANCELLED registration', () => as(null, coding, async c => {
  const r = await one(`SELECT registration_id FROM registrations WHERE status='CANCELLED' LIMIT 1`);
  const e = await fails(c, `INSERT INTO attendance(registration_id,present,marked_by) VALUES ($1,true,$2)`, [r.registration_id, coding]);
  return expectErr(e, 'CC409', 'CONFIRMED'); }));
await test('TC-13', 'Invalid registration status is rejected by the guard trigger', () => as(null, null, async c => {
  const e = await fails(c, `UPDATE registrations SET status='MAYBE' WHERE registration_id=(SELECT min(registration_id) FROM registrations)`);
  check(e, 'invalid status was accepted'); return `${e.code}: ${e.message}`; }));
await test('TC-13b', 'CHECK constraint alone also rejects an invalid status (triggers disabled for this test)', () => as(null, null, async c => {
  await c.query(`SET LOCAL session_replication_role = replica`);          // superuser-only: switches user triggers off
  const e = await fails(c, `UPDATE registrations SET status='MAYBE' WHERE registration_id=(SELECT min(registration_id) FROM registrations)`);
  return expectErr(e, '23514', 'registrations_status_check'); }));
await test('TC-14', 'An event that has registrations cannot be deleted (ON DELETE RESTRICT)', () => as(null, null, async c => {
  const e = await fails(c, `DELETE FROM events WHERE event_id=$1`, [E.ctf]); return expectErr(e, '23503'); }));
await test('TC-15', 'Illegal registration status change CANCELLED -> REJECTED is blocked (trigger)', () => as(null, null, async c => {
  const r = await one(`SELECT min(registration_id) AS id FROM registrations WHERE status='CONFIRMED'`);
  await c.query(`UPDATE registrations SET status='CANCELLED' WHERE registration_id=$1`, [r.id]);
  const e = await fails(c, `UPDATE registrations SET status='REJECTED' WHERE registration_id=$1`, [r.id]);
  return expectErr(e, 'CC409', 'illegal registration status'); }));

// ================================================================ ROLE-BASED ACCESS CONTROL IN THE DATABASE
await test('TC-20', 'Login role without SET ROLE has no access to tables', async () => {
  const c = new pg.Client({ connectionString: env.DATABASE_URL }); await c.connect();
  try { await c.query('SELECT count(*) FROM events'); throw new Error('query unexpectedly succeeded'); }
  catch (e) { check(e.code === '42501', `expected 42501, got ${e.code} ${e.message}`); return `${e.code}: ${e.message}`; } finally { await c.end(); } });
await test('TC-21', 'No app role can read users.password_hash (column privilege)', async () => {
  const msgs = [];
  for (const role of ['STUDENT', 'CLUB_ADMIN', 'CAMPUS_ADMIN']) msgs.push(await as(role, admin, async c => {
    const e = await fails(c, 'SELECT password_hash FROM users'); return expectErr(e, '42501'); }));
  return msgs[0]; });
await test('TC-22', 'Student cannot approve events (no EXECUTE on review_event)', () => as('STUDENT', studs[0], async c => {
  const e = await fails(c, `SELECT review_event($1,true,NULL)`, [E.rust]); return expectErr(e, '42501'); }));
await test('TC-23', 'Club admin cannot approve their own event (no EXECUTE on review_event)', () => as('CLUB_ADMIN', coding, async c => {
  const e = await fails(c, `SELECT review_event($1,true,NULL)`, [E.rust]); return expectErr(e, '42501'); }));
await test('TC-24', 'Club admin cannot set events.status directly (column privilege)', () => as('CLUB_ADMIN', coding, async c => {
  const e = await fails(c, `UPDATE events SET status='APPROVED' WHERE event_id=$1`, [E.draft]); return expectErr(e, '42501'); }));
await test('TC-25', 'Club admin cannot submit another club\'s event (ownership check)', () => as('CLUB_ADMIN', music, async c => {
  const e = await fails(c, `SELECT submit_event($1)`, [E.draft]);       // draft belongs to Photography Club
  return expectErr(e, 'CC403', 'do not manage'); }));
await test('TC-26', 'Club admin cannot create an event for a club they do not manage (RLS WITH CHECK)', () => as('CLUB_ADMIN', music, async c => {
  const e = await fails(c, `INSERT INTO events(club_id,category_id,venue_id,title,start_time,end_time,registration_deadline,capacity,created_by)
    VALUES ((SELECT club_id FROM clubs WHERE name='ACMW'),1,1,'Sneaky','2030-01-01 10:00+00','2030-01-01 12:00+00','2029-12-31 10:00+00',10,$1)`, [music]);
  return expectErr(e, '42501', 'row-level security'); }));
await test('TC-27', 'Club admin cannot read or change another club\'s registrations (RLS)', () => as('CLUB_ADMIN', music, async c => {
  const n = (await c.query(`SELECT count(*)::int AS n FROM registrations WHERE event_id=$1`, [E.ctf])).rows[0].n;   // CTF = Coding Club
  check(n === 0, `music admin can see ${n} Coding Club registrations`);
  const r = (await one(`SELECT registration_id FROM registrations WHERE event_id=$1 LIMIT 1`, [E.ctf])).registration_id;
  const e = await fails(c, `SELECT decide_registration($1,true)`, [r]); return 'sees 0 rows; ' + expectErr(e, 'CC403', 'do not manage'); }));
await test('TC-28', 'Student sees only their own registrations (RLS)', () => as('STUDENT', studs[0], async c => {
  const mine = (await c.query('SELECT count(*)::int n FROM registrations')).rows[0].n;
  const total = (await c.query(`SELECT count(*)::int n FROM registrations WHERE student_id <> $1`, [studs[0]])).rows[0].n;
  check(total === 0, `student sees ${total} other students' registrations`);
  const real = (await one('SELECT count(*)::int n FROM registrations WHERE student_id=$1', [studs[0]])).n;
  check(mine === real, `mine=${mine} real=${real}`); return `sees ${mine} rows (all own) of ${(await one('SELECT count(*)::int n FROM registrations')).n} in the table`; }));
await test('TC-29', 'Student sees only published (APPROVED/CANCELLED) events, never drafts or pending ones (RLS)', () => as('STUDENT', studs[0], async c => {
  const n = (await c.query(`SELECT count(*)::int n FROM events WHERE status IN ('DRAFT','PENDING_APPROVAL','REJECTED')`)).rows[0].n;
  check(n === 0, `student can see ${n} unpublished events`);
  const p = (await c.query('SELECT count(*)::int n FROM published_events')).rows[0].n; return `0 unpublished visible, ${p} published`; }));
await test('TC-29b', 'Student sees a CANCELLED event only if they hold a registration for it (migration 006)', async () => {
  const id = await evId('Rooftop Jam');
  const withReg = (await one(`SELECT student_id FROM registrations WHERE event_id=$1 LIMIT 1`, [id])).student_id;
  const withoutReg = (await one(`SELECT user_id FROM students WHERE user_id NOT IN (SELECT student_id FROM registrations WHERE event_id=$1) LIMIT 1`, [id])).user_id;
  const seen = uid => as('STUDENT', uid, async c => (await c.query('SELECT count(*)::int n FROM events WHERE event_id=$1', [id])).rows[0].n);
  const a = await seen(withReg), b = await seen(withoutReg);
  check(a === 1, 'registered student cannot see the cancellation'); check(b === 0, 'unrelated student can see the cancelled event');
  return 'registered student sees it, unrelated student does not'; });
await test('TC-30', 'Student cannot read another user\'s notifications (RLS)', () => as('STUDENT', studs[0], async c => {
  const n = (await c.query('SELECT count(*)::int n FROM notifications WHERE user_id <> $1', [studs[0]])).rows[0].n;
  check(n === 0, `leaked ${n} notifications`); return '0 foreign notifications visible'; }));
await test('TC-31', 'Student cannot insert events or call club functions', () => as('STUDENT', studs[0], async c => {
  const a = await fails(c, `INSERT INTO events(club_id,category_id,venue_id,title,start_time,end_time,registration_deadline,capacity,created_by)
    VALUES (1,1,1,'x','2030-01-01 10:00+00','2030-01-01 12:00+00','2029-12-31 10:00+00',10,$1)`, [studs[0]]);
  const b = await fails(c, `SELECT mark_attendance(1,true)`);
  return expectErr(a, '42501') + ' | ' + expectErr(b, '42501'); }));
await test('TC-32', 'Student cannot create staff accounts (only campus admin can)', () => as('STUDENT', studs[0], async c => {
  const e = await fails(c, `SELECT create_staff_user('evil@x.com','h','Evil','CAMPUS_ADMIN',NULL)`); return expectErr(e, '42501'); }));
await test('TC-33', 'Campus admin cannot see DRAFT events (RLS)', () => as('CAMPUS_ADMIN', admin, async c => {
  const n = (await c.query(`SELECT count(*)::int n FROM events WHERE status='DRAFT'`)).rows[0].n; check(n === 0, `sees ${n} drafts`); return '0 drafts visible'; }));

// ================================================================ WORKFLOW (stored functions + triggers)
await test('TC-40', 'Full lifecycle: draft -> submit -> approve -> published -> register -> notifications -> audit trail', () => as(null, null, async c => {
  const set = id => c.query(`SELECT set_config('app.user_id',$1,true)`, [String(id)]);
  await c.query('SET LOCAL ROLE app_club_admin'); await set(coding);
  const ins = await c.query(`INSERT INTO events(club_id,category_id,venue_id,title,description,start_time,end_time,registration_deadline,capacity,created_by)
    VALUES ((SELECT club_id FROM clubs WHERE name='ACMW'),1,(SELECT venue_id FROM venues WHERE name='Auditorium'),'Lifecycle Test','x',
            now() + interval '40 days', now() + interval '40 days 2 hours', now() + interval '39 days', 20, $1) RETURNING event_id, status`, [coding]);
  const id = ins.rows[0].event_id; check(ins.rows[0].status === 'DRAFT', 'new event is not DRAFT');
  await c.query('SELECT submit_event($1)', [id]);
  await c.query('RESET ROLE');
  const pendingVisible = (await c.query(`SELECT count(*)::int n FROM published_events WHERE event_id=$1`, [id])).rows[0].n;
  check(pendingVisible === 0, 'pending event is visible in the catalogue');
  await c.query('SET LOCAL ROLE app_campus_admin'); await set(admin);
  await c.query('SELECT review_event($1,true,NULL)', [id]);
  await c.query('RESET ROLE'); await c.query('SET LOCAL ROLE app_student'); await set(studs[0]);
  check((await c.query(`SELECT count(*)::int n FROM published_events WHERE event_id=$1`, [id])).rows[0].n === 1, 'approved event not published');
  const reg = (await c.query('SELECT * FROM register_for_event($1)', [id])).rows[0];
  check(reg.status === 'CONFIRMED' && reg.student_id == studs[0], 'registration not confirmed for the caller');
  const mine = (await c.query(`SELECT type FROM notifications WHERE event_id=$1 ORDER BY notification_id`, [id])).rows.map(r => r.type);
  check(mine.join() === 'REGISTRATION_CONFIRMED', `student notifications: ${mine}`);
  await c.query('RESET ROLE');
  const hist = (await c.query(`SELECT coalesce(old_status,'-')||'>'||new_status AS s, new_status, changed_by FROM event_status_history WHERE event_id=$1 ORDER BY history_id`, [id])).rows;
  check(hist.length === 3 && hist.map(h => h.new_status).join() === 'DRAFT,PENDING_APPROVAL,APPROVED', `history ${JSON.stringify(hist)}`);
  check(hist[2].changed_by == admin, 'audit trail does not record the approving admin');
  const admins = (await c.query(`SELECT count(*)::int n FROM notifications WHERE event_id=$1 AND type='EVENT_SUBMITTED'`, [id])).rows[0].n;
  check(admins === 1, 'campus admin was not notified of submission');
  return `3 audit rows (${hist.map(h => h.s).join(' | ')}); student + campus-admin notifications created by triggers`; }));
await test('TC-41', 'Rejected event needs a reason, appears nowhere in the catalogue, club admin is notified', () => as(null, null, async c => {
  const e = await (async () => { await c.query('SET LOCAL ROLE app_campus_admin'); await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(admin)]);
    return fails(c, `SELECT review_event($1,false,'  ')`, [E.musicProd]); })();
  expectErr(e, 'CC422', 'reason is required');
  await c.query(`SELECT review_event($1,false,'Budget not approved')`, [E.musicProd]);
  await c.query('RESET ROLE');
  const vis = (await c.query(`SELECT count(*)::int n FROM published_events WHERE event_id=$1`, [E.musicProd])).rows[0].n; check(vis === 0, 'rejected event is published');
  const n = (await c.query(`SELECT count(*)::int n FROM notifications WHERE event_id=$1 AND type='EVENT_REJECTED' AND user_id=$2`, [E.musicProd, music])).rows[0].n;
  check(n === 1, 'club admin not notified'); return 'reason enforced; hidden from catalogue; EVENT_REJECTED notification created'; }));
await test('TC-42', 'Registration status update: manual-approval event goes PENDING then club confirms; student notified', () => as('STUDENT', studs[0], async c => {
  const member = (await q(`SELECT student_id FROM club_members WHERE club_id=(SELECT club_id FROM events WHERE event_id=$1) AND student_id NOT IN (SELECT student_id FROM registrations WHERE event_id=$1) LIMIT 1`, [E.cv]))[0].student_id;
  await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(member)]);
  const reg = (await c.query('SELECT * FROM register_for_event($1)', [E.cv])).rows[0]; check(reg.status === 'PENDING', `status ${reg.status}`);
  await c.query('RESET ROLE'); await c.query('SET LOCAL ROLE app_club_admin'); await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(coding)]);
  const d = (await c.query('SELECT * FROM decide_registration($1,true)', [reg.registration_id])).rows[0]; check(d.status === 'CONFIRMED' && d.decided_by == coding, 'not confirmed');
  await c.query('RESET ROLE');
  const t = (await c.query(`SELECT type FROM notifications WHERE user_id=$1 AND event_id=$2 ORDER BY notification_id`, [member, E.cv])).rows.map(r => r.type);
  check(t.join() === 'REGISTRATION_PENDING,REGISTRATION_CONFIRMED', `notifications ${t}`); return 'PENDING -> CONFIRMED; notifications: ' + t.join(' , '); }));
await test('TC-43', 'Cancelling frees a seat; re-registering re-uses the same row', () => as(null, null, async c => {
  const s = (await notRegistered(E.hack, 1))[0];
  await c.query('SET LOCAL ROLE app_student'); await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(s)]);
  const before = (await c.query('SELECT available_seats($1) a', [E.hack])).rows[0].a;
  const reg = (await c.query('SELECT * FROM register_for_event($1)', [E.hack])).rows[0];
  const mid = (await c.query('SELECT available_seats($1) a', [E.hack])).rows[0].a;
  await c.query('SELECT cancel_registration($1)', [reg.registration_id]);
  const after = (await c.query('SELECT available_seats($1) a', [E.hack])).rows[0].a;
  const again = (await c.query('SELECT * FROM register_for_event($1)', [E.hack])).rows[0];
  check(mid === before - 1 && after === before, `seats before=${before} mid=${mid} after=${after}`);
  check(again.registration_id === reg.registration_id, 'a new row was created instead of re-using the old one');
  return `seats ${before} -> ${mid} -> ${after}; same registration_id ${reg.registration_id} reused`; }));
await test('TC-44', 'Cancelling an event cancels all live registrations and notifies students', () => as(null, null, async c => {
  await c.query('SET LOCAL ROLE app_club_admin'); await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(photo)]);
  const live = (await one(`SELECT count(*)::int n FROM registrations WHERE event_id=$1 AND status IN ('PENDING','CONFIRMED')`, [E.master])).n;
  await c.query(`SELECT cancel_event($1,'Speaker unavailable')`, [E.master]); await c.query('RESET ROLE');
  const left = (await c.query(`SELECT count(*)::int n FROM registrations WHERE event_id=$1 AND status IN ('PENDING','CONFIRMED')`, [E.master])).rows[0].n;
  const notes = (await c.query(`SELECT count(*)::int n FROM notifications WHERE event_id=$1 AND type='EVENT_CANCELLED'`, [E.master])).rows[0].n;
  check(left === 0, `${left} live registrations remain`); check(notes >= live, `only ${notes} notifications for ${live} registrations`);
  return `${live} registrations cancelled, ${notes} EVENT_CANCELLED notifications`; }));
await test('TC-45', 'Full event refuses further registrations', () => as('STUDENT', studs[0], async c => {
  const s = (await notRegistered(E.ctf, 1))[0]; await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(s)]);
  const e = await fails(c, 'SELECT register_for_event($1)', [E.ctf]); return expectErr(e, 'CC409', 'full'); }));
await test('TC-46', 'Club-members-only event refuses a non-member', () => as('STUDENT', studs[0], async c => {
  const nm = (await q(`SELECT user_id FROM users u WHERE role='STUDENT' AND NOT EXISTS (SELECT 1 FROM club_members m WHERE m.student_id=u.user_id AND m.club_id=(SELECT club_id FROM events WHERE event_id=$1)) LIMIT 1`, [E.cv]))[0].user_id;
  await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(nm)]);
  const e = await fails(c, 'SELECT register_for_event($1)', [E.cv]); return expectErr(e, 'CC403', 'members only'); }));
await test('TC-47', 'Registration after the deadline is refused', () => as('STUDENT', studs[0], async c => {
  const s = (await notRegistered(E.web, 1))[0]; await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(s)]);
  const e = await fails(c, 'SELECT register_for_event($1)', [E.web]); return expectErr(e, 'CC409', 'deadline'); }));
await test('TC-48', 'Attendance: refused before the event starts, accepted afterwards', () => as('CLUB_ADMIN', coding, async c => {
  const fut = await one(`SELECT registration_id FROM registrations WHERE event_id=$1 AND status='CONFIRMED' LIMIT 1`, [E.ctf]);
  const e = await fails(c, 'SELECT mark_attendance($1,true)', [fut.registration_id]); expectErr(e, 'CC409', 'started');
  const past = await one(`SELECT registration_id FROM registrations WHERE event_id=$1 AND status='CONFIRMED' LIMIT 1`, [E.web]);
  const a = (await c.query('SELECT * FROM mark_attendance($1,false)', [past.registration_id])).rows[0];
  check(a.present === false && a.marked_by == coding, 'attendance row wrong'); return 'blocked for future event; recorded for past event'; }));
await test('TC-49', 'Student cannot cancel someone else\'s registration', () => as('STUDENT', studs[0], async c => {
  const other = await one(`SELECT registration_id FROM registrations WHERE student_id <> $1 AND status='CONFIRMED' AND event_id=$2 LIMIT 1`, [studs[0], E.hack]);
  const e = await fails(c, 'SELECT cancel_registration($1)', [other.registration_id]); return expectErr(e, 'CC404'); }));

// ================================================================ ADVANCED FEATURES
await test('TC-50', 'event_summary() matches a hand-written count', () => as('CLUB_ADMIN', coding, async c => {
  const f = (await c.query('SELECT * FROM event_summary($1)', [E.cv])).rows[0];
  const m = await one(`SELECT count(*) FILTER (WHERE status='CONFIRMED')::int cf, count(*) FILTER (WHERE status='PENDING')::int pd FROM registrations WHERE event_id=$1`, [E.cv]);
  check(f.confirmed === m.cf && f.pending === m.pd, `function ${f.confirmed}/${f.pending} vs manual ${m.cf}/${m.pd}`);
  check(f.seats_left === f.capacity - m.cf - m.pd, 'seats_left wrong'); return JSON.stringify(f); }));
await test('TC-51', 'check_event_conflicts() finds the planted Seminar Hall A clash', () => as('CAMPUS_ADMIN', admin, async c => {
  const r = (await c.query('SELECT * FROM check_event_conflicts($1)', [E.rust])).rows;
  check(r.length === 1 && r[0].other_event_id == E.master, `got ${JSON.stringify(r)}`); return `clash with "${r[0].other_title}" (${r[0].other_status})`; }));
await test('TC-52', 'venue_conflicts view lists the overlapping pair', () => as('CAMPUS_ADMIN', admin, async c => {
  const r = (await c.query('SELECT * FROM venue_conflicts')).rows; check(r.length === 1, `rows=${r.length}`); return `${r[0].title_a} <-> ${r[0].title_b}`; }));
await test('TC-53', 'Recursive category tree returns depth and path', () => as('STUDENT', studs[0], async c => {
  const r = (await c.query(`SELECT depth, path FROM category_tree WHERE name='Computer Vision'`)).rows[0];
  check(r.depth === 2 && r.path === 'Technical > AI/ML > Computer Vision', JSON.stringify(r)); return r.path; }));
await test('TC-54', 'Full-text search: exact stem and prefix match both find photography events', () => as('STUDENT', studs[0], async c => {
  const exact = (await c.query(`SELECT title FROM published_events WHERE search_vector @@ websearch_to_tsquery('english','photography')`)).rows.map(r => r.title);
  const prefix = (await c.query(`SELECT title FROM published_events WHERE search_vector @@ to_tsquery('english','photograph:*')`)).rows.map(r => r.title);
  const stemOnly = (await c.query(`SELECT count(*)::int n FROM published_events WHERE search_vector @@ websearch_to_tsquery('english','photograph')`)).rows[0].n;
  check(exact.includes('Portrait Photography Masterclass') && exact.includes('Sunrise Photo Walk'), JSON.stringify(exact));
  check(prefix.length >= exact.length, 'prefix search found fewer rows than exact search');
  return `'photography' -> ${exact.length} events; 'photograph:*' (prefix) -> ${prefix.length}; plain 'photograph' -> ${stemOnly} (different stem, hence prefix matching in the UI)`; }));
await test('TC-55', 'GIN index is chosen for full-text search (EXPLAIN)', () => as(null, null, async c => {
  await c.query('SET LOCAL enable_seqscan = off');   // tables are tiny, so the planner would otherwise pick a seq scan
  const plan = (await c.query(`EXPLAIN SELECT 1 FROM events WHERE search_vector @@ to_tsquery('english','photograph')`)).rows.map(r => r['QUERY PLAN']).join(' / ');
  check(/idx_events_search/.test(plan), plan); return plan; }));

// ================================================================ CONCURRENCY (real parallel connections, committed)
async function race(fnName, eventId, students) {
  const outcomes = await Promise.allSettled(students.map(async (s, i) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE app_student'); await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(s)]);
      await new Promise(r => setTimeout(r, i * 30));                    // staggered a little so they truly overlap
      await c.query(`SELECT ${fnName}($1)`, [eventId]);
      await new Promise(r => setTimeout(r, 400));                       // hold the transaction open: widens the race window
      await c.query('COMMIT'); return 'ok';
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }));
  return { ok: outcomes.filter(o => o.status === 'fulfilled').length, errs: outcomes.filter(o => o.status === 'rejected').map(o => o.reason.message) };
}
async function cleanup(eventId, students) {
  await q('DELETE FROM notifications WHERE user_id = ANY($1) AND event_id=$2', [students, eventId]);
  await q('DELETE FROM registrations WHERE student_id = ANY($1) AND event_id=$2', [students, eventId]);
}
await test('TC-60', 'Two or more students racing for the LAST seat: exactly one wins (row lock + transaction)', async () => {
  const before = (await one('SELECT available_seats($1) a', [E.last])).a; check(before === 1, `expected 1 seat left, found ${before}`);
  const racers = await notRegistered(E.last, 5);
  const r = await race('register_for_event', E.last, racers);
  const taken = (await one(`SELECT seats_taken($1) t, (SELECT capacity FROM events WHERE event_id=$1) cap`, [E.last]));
  await cleanup(E.last, racers);
  check(r.ok === 1, `${r.ok} racers succeeded`); check(taken.t === taken.cap, `seats taken ${taken.t} of ${taken.cap}`);
  check(r.errs.every(m => /full/i.test(m)), r.errs.join(';'));
  return `5 concurrent attempts for 1 seat -> ${r.ok} success, ${r.errs.length} "event is full"; seats taken ${taken.t}/${taken.cap}`; });
await test('TC-61', 'CONTROL: the same race WITHOUT the row lock over-books (proves the lock is what protects capacity)', async () => {
  await q(`CREATE OR REPLACE FUNCTION test_register_unsafe(p_event_id BIGINT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE e events%ROWTYPE; BEGIN
      SELECT * INTO e FROM events WHERE event_id = p_event_id;                          -- NO "FOR UPDATE"
      IF seats_taken(p_event_id) >= e.capacity THEN PERFORM cc_fail('CC409','event is full'); END IF;
      INSERT INTO registrations(event_id, student_id, status) VALUES (p_event_id, app_user_id(), 'CONFIRMED');
    END $$`);
  await q('GRANT EXECUTE ON FUNCTION test_register_unsafe(BIGINT) TO app_student');
  const racers = await notRegistered(E.last, 5);
  const r = await race('test_register_unsafe', E.last, racers);
  const taken = (await one(`SELECT seats_taken($1) t, (SELECT capacity FROM events WHERE event_id=$1) cap`, [E.last]));
  await cleanup(E.last, racers); await q('DROP FUNCTION test_register_unsafe(BIGINT)');
  check(taken.t > taken.cap, `no over-booking occurred (${taken.t}/${taken.cap}); control inconclusive`);
  return `unsafe version: ${r.ok} succeeded, seats taken ${taken.t} of capacity ${taken.cap} (OVER-BOOKED, as expected for the control)`; });
await test('TC-62', 'Data restored after concurrency tests', async () => {
  const a = (await one('SELECT available_seats($1) a', [E.last])).a; check(a === 1, `seats left ${a}`); return 'Last Seat Demo Workshop has 1 seat again'; });

// ================================================================ report
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
mkdirSync('docs', { recursive: true });
const md = [`# Database test results`, ``, `Generated by \`npm run test:db\` on ${new Date().toISOString()}.`,
  `Database: ${(await one('select version() v')).v.split(' on ')[0]}`, ``, `**${passed} of ${results.length} tests passed.**`, ``,
  `| ID | Test | Result | Evidence (actual output) |`, `|---|---|---|---|`,
  ...results.map(r => `| ${r.id} | ${r.name} | ${r.ok ? 'PASS' : '**FAIL**'} | ${r.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)].join('\n');
writeFileSync('docs/test-results-db.md', md + '\n');
await pool.end();
process.exit(passed === results.length ? 0 : 1);
