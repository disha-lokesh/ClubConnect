// Seeds realistic demo data through the owner connection. Dates are relative to "today" (Asia/Kolkata),
// so the calendar always has past, ongoing-soon and upcoming events.
//   node scripts/seed.mjs            seed an empty database
//   node scripts/seed.mjs --reset    wipe all application data first
// Club admin demo passwords match their club name (acmw123, mcop123, pixels123).
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { loadEnv } from './env.mjs';

const env = loadEnv();
const client = new pg.Client({ connectionString: env.DATABASE_URL_ADMIN });
await client.connect();
const q = (sql, p) => client.query(sql, p);

if (process.argv.includes('--reset')) {
  await q(`TRUNCATE notifications, attendance, registrations, event_status_history, events, club_members, club_admins,
           students, users, clubs, venues, event_categories RESTART IDENTITY CASCADE`);
  console.log('existing data wiped');
}
if ((await q('SELECT count(*)::int AS n FROM users')).rows[0].n > 0) {
  console.error('database already has users; run with --reset to wipe and re-seed'); process.exit(1);
}

const hash = async password => bcrypt.hash(password || 'Password@123', 10);

// ---------------------------------------------------------------- staff accounts
const staff = [
  ['admin@pes.edu',        'Dr. Meera Rao',   'CAMPUS_ADMIN'],
  ['acmw@pes.edu',         'Arjun Nair',      'CLUB_ADMIN', 'acmw123'],
  ['mcop@pes.edu',         'Kavya Menon',     'CLUB_ADMIN', 'mcop123'],
  ['pixels@pes.edu',       'Rohan Das',       'CLUB_ADMIN', 'pixels123'],
];
const uid = {};
for (const [email, name, role, password] of staff) {
  uid[email] = (await q('INSERT INTO users(email,password_hash,full_name,role) VALUES ($1,$2,$3,$4) RETURNING user_id',
    [email, await hash(password), name, role])).rows[0].user_id;
}

// ---------------------------------------------------------------- clubs, venues, categories
const clubs = {};
for (const [name, desc, mail] of [
 ['ACMW',               'Technology workshops, hackathons and web development.', 'acmw@pes.edu'],
 ['MCOP',               'Bands, open mics and music production.', 'mcop@pes.edu'],
 ['Pixels',             'Photo walks, exhibitions and masterclasses.', 'pixels@pes.edu'],
]) clubs[name] = (await q('INSERT INTO clubs(name,description,contact_email) VALUES ($1,$2,$3) RETURNING club_id', [name, desc, mail])).rows[0].club_id;

for (const [email, club] of [['acmw@pes.edu','ACMW'], ['mcop@pes.edu','MCOP'], ['pixels@pes.edu','Pixels']])
  await q('INSERT INTO club_admins(club_id,user_id) VALUES ($1,$2)', [clubs[club], uid[email]]);

const venues = {};
for (const [name, building, cap, active] of [
  ['Auditorium','Main Block',300,true], ['Seminar Hall A','Block A',80,true], ['Seminar Hall B','Block B',60,true],
  ['Lab 101','CS Block',40,true], ['Open Air Theatre','Campus Green',500,true], ['Old Hall','Block C',50,false],
]) venues[name] = (await q('INSERT INTO venues(name,building,capacity,is_active) VALUES ($1,$2,$3,$4) RETURNING venue_id', [name, building, cap, active])).rows[0].venue_id;

const cat = {};
const addCat = async (name, parent) => { cat[name] = (await q('INSERT INTO event_categories(name,parent_category_id) VALUES ($1,$2) RETURNING category_id', [name, parent ? cat[parent] : null])).rows[0].category_id; };
await addCat('Technical'); await addCat('Cultural'); await addCat('Workshops');
await addCat('Web Development','Technical'); await addCat('AI/ML','Technical'); await addCat('Cybersecurity','Technical');
await addCat('Computer Vision','AI/ML'); await addCat('Music','Cultural'); await addCat('Photography','Cultural');

// ---------------------------------------------------------------- 40 students
const first = ['Aarav','Diya','Vihaan','Ananya','Aditya','Ishita','Kabir','Meera','Reyansh','Saanvi','Arnav','Tara','Dev','Navya','Karan','Riya','Neel','Sneha','Yash','Pooja',
               'Harsh','Anika','Om','Kritika','Ritvik','Sara','Manav','Leela','Samar','Nisha','Tanay','Isha','Rudra','Myra','Vivaan','Trisha','Zain','Pari','Hriday','Anvi'];
const last  = ['Sharma','Iyer','Reddy','Patel','Gupta','Nair','Joshi','Kulkarni','Bhat','Rao'];
const depts = ['CSE','CSE','CSE','ECE','EEE','ME'];
const students = [];
for (let i = 0; i < 40; i++) {
  const email = `${first[i].toLowerCase()}.${last[i % 10].toLowerCase()}${i + 1}@stu.pes.edu`;
  const id = (await q('INSERT INTO users(email,password_hash,full_name,role) VALUES ($1,$2,$3,$4) RETURNING user_id',
    [email, await hash(), `${first[i]} ${last[i % 10]}`, 'STUDENT'])).rows[0].user_id;
  await q('INSERT INTO students(user_id,srn,department,year_of_study,phone) VALUES ($1,$2,$3,$4,$5)',
    [id, `PES2UG24${depts[i % 6]}${String(i + 1).padStart(3, '0')}`, depts[i % 6], (i % 4) + 1, `98${String(10000000 + i * 7919).slice(0, 8)}`]);
  students.push(id);
}
// memberships (needed for CLUB_MEMBERS-only events)
for (const [club, pred] of [['ACMW', i => i % 2 === 0], ['MCOP', i => i % 4 === 1], ['Pixels', i => i % 5 === 2]])
  for (let i = 0; i < students.length; i++) if (pred(i))
    await q('INSERT INTO club_members(club_id,student_id,member_role) VALUES ($1,$2,$3)', [clubs[club], students[i], i % 10 === 0 ? 'OFFICE_BEARER' : 'MEMBER']);

// ---------------------------------------------------------------- events
// [title, club, category, venue, dayOffset, startHour, durationHours, capacity, fee, eligibility, manual, finalStatus, creatorEmail, nRegs, note]
const E = [
  ['Intro to Web Dev Bootcamp',        'ACMW',   'Web Development', 'Seminar Hall A',  -20, 10, 3, 60, 0,   'OPEN',         false, 'APPROVED', 'acmw@pes.edu', 30, 'Hands-on HTML, CSS and JavaScript for beginners.'],
  ['AI/ML Paper Reading Night',        'ACMW',   'AI/ML',           'Lab 101',         -12, 17, 2, 40, 0,   'OPEN',         true,  'APPROVED', 'acmw@pes.edu', 22, 'We read and discuss a recent machine learning paper together.'],
  ['Open Mic Evening',                 'MCOP',   'Music',           'Open Air Theatre', -8, 18, 3, 200, 50, 'OPEN',         false, 'APPROVED', 'mcop@pes.edu',  38, 'Sing, play or just listen: an open stage for everyone.'],
  ['Sunrise Photo Walk',               'Pixels', 'Photography',     'Open Air Theatre', -5, 6,  2, 40, 0,   'OPEN',         false, 'APPROVED', 'pixels@pes.edu', 18, 'Golden-hour photography around the campus.'],
  ['Cybersecurity CTF',                'ACMW',   'Cybersecurity',   'Seminar Hall B',   4, 10, 6, 6,  0,   'OPEN',         false, 'APPROVED', 'acmw@pes.edu', 6,  'Capture-the-flag challenges. Capacity is tiny on purpose: this event is FULL.'],
  ['Computer Vision Workshop',         'ACMW',   'Computer Vision', 'Lab 101',          6, 14, 3, 30, 0,   'CLUB_MEMBERS', true,  'APPROVED', 'acmw@pes.edu', 9,  'Object detection with Python. Members only; each registration is approved by the club.'],
  ['Portrait Photography Masterclass', 'Pixels', 'Photography',     'Seminar Hall A',   7, 11, 2, 50, 150, 'OPEN',         false, 'APPROVED', 'pixels@pes.edu', 10, 'Lighting and composition for portraits.'],
  ['Last Seat Demo Workshop',          'Pixels', 'Workshops',       'Seminar Hall B',   8, 15, 2, 3,  0,   'OPEN',         false, 'APPROVED', 'pixels@pes.edu', 2,  'Only ONE seat left: used to demonstrate concurrent registration.'],
  ['24-Hour Hackathon',                'ACMW',   'Technical',       'Auditorium',       9, 9, 24, 150, 100, 'OPEN',         false, 'APPROVED', 'acmw@pes.edu', 26, 'Build something useful in 24 hours.'],
  ['Battle of Bands',                  'MCOP',   'Music',           'Auditorium',      14, 17, 4, 250, 75,  'OPEN',         false, 'APPROVED', 'mcop@pes.edu',  40, 'Campus bands compete for the title.'],
  ['Rust for Beginners',               'ACMW',   'Web Development', 'Seminar Hall A',   7, 12, 2, 40, 0,   'OPEN',         false, 'PENDING_APPROVAL', 'acmw@pes.edu', 0, 'Overlaps the Portrait Masterclass in Seminar Hall A: a schedule-conflict demo.'],
  ['Music Production Workshop',        'MCOP',   'Workshops',       'Lab 101',         20, 14, 3, 30, 200, 'OPEN',         true,  'PENDING_APPROVAL', 'mcop@pes.edu',  0, 'Make a track from scratch with free software.'],
  ['Photography Exhibition',           'Pixels', 'Photography',     'Seminar Hall B',  25, 10, 8, 60, 0,   'OPEN',         false, 'DRAFT',    'pixels@pes.edu',  0, 'Still being planned.'],
  ['Late Night Concert',               'MCOP',   'Music',           'Open Air Theatre', 11, 22, 3, 300, 0,  'OPEN',         false, 'REJECTED', 'mcop@pes.edu',  0, 'Evening concert.'],
  ['Rooftop Jam',                      'MCOP',   'Music',           'Seminar Hall B',   5, 18, 2, 30, 0,   'OPEN',         false, 'CANCELLED', 'mcop@pes.edu', 8,  'Cancelled because of rain forecast.'],
];
const adminId = uid['admin@pes.edu'];
const eventIds = {};
for (let k = 0; k < E.length; k++) {
  const [title, club, category, venue, day, hour, dur, cap, fee, elig, manual, final, creator, nRegs, note] = E[k];
  await q(`SELECT set_config('app.user_id', $1, false)`, [String(uid[creator])]);
  const ev = await q(`
    INSERT INTO events(club_id,category_id,venue_id,title,description,start_time,end_time,registration_deadline,capacity,fee,eligibility,manual_approval,created_by)
    SELECT $1,$2,$3,$4,$5, s, s + make_interval(hours => $7), s - interval '1 day', $8,$9,$10,$11,$12
      FROM (SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + make_interval(days => $13, hours => $6)) AT TIME ZONE 'Asia/Kolkata' AS s) t
    RETURNING event_id`,
    [clubs[club], cat[category], venues[venue], title, note, hour, dur, cap, fee, elig, manual, uid[creator], day]);
  const id = ev.rows[0].event_id; eventIds[title] = id;

  if (final !== 'DRAFT') {
    await q(`UPDATE events SET status='PENDING_APPROVAL', submitted_at = created_at WHERE event_id=$1`, [id]);
    await q(`SELECT set_config('app.user_id', $1, false)`, [String(adminId)]);
    if (final === 'REJECTED') {
      await q(`UPDATE events SET status='REJECTED', reviewed_by=$2, reviewed_at=now(), review_comment='Venue is not available after 10 PM.' WHERE event_id=$1`, [id, adminId]);
    } else if (final !== 'PENDING_APPROVAL') {
      await q(`UPDATE events SET status='APPROVED', reviewed_by=$2, reviewed_at=now() WHERE event_id=$1`, [id, adminId]);
    }
  }

  // registrations (inserted directly by the owner: they simulate history that already happened)
  const candidates = elig === 'CLUB_MEMBERS'
    ? (await q('SELECT student_id FROM club_members WHERE club_id=$1 ORDER BY student_id', [clubs[club]])).rows.map(r => r.student_id)
    : students.slice();
  const chosen = candidates.filter((_, i) => (i * 7 + k * 3) % 5 < 4).slice(0, nRegs);
  for (let n = 0; n < chosen.length; n++) {
    // manual-approval upcoming events keep the last 4 requests PENDING so the club has something to decide
    const status = manual && final === 'APPROVED' && day > 0 && n >= chosen.length - 4 ? 'PENDING' : 'CONFIRMED';
    await q(`INSERT INTO registrations(event_id,student_id,status,registered_at) VALUES ($1,$2,$3, now() - interval '2 days')`, [id, chosen[n], status]);
  }
  if (day < 0) {                                    // past event: attendance for ~80% of confirmed
    await q(`INSERT INTO attendance(registration_id,present,marked_by)
             SELECT registration_id, (registration_id % 5) <> 0, $2 FROM registrations WHERE event_id=$1 AND status='CONFIRMED'`, [id, uid[creator]]);
  }
  if (final === 'CANCELLED') {
    await q(`SELECT set_config('app.user_id', $1, false)`, [String(uid[creator])]);
    await q(`UPDATE events SET status='CANCELLED', cancel_reason='Cancelled because of rain forecast.' WHERE event_id=$1`, [id]);
    await q(`UPDATE registrations SET status='CANCELLED', cancelled_at=now() WHERE event_id=$1 AND status IN ('PENDING','CONFIRMED')`, [id]);
  }
}
// older notifications are marked read so the demo inbox is not flooded
await q(`UPDATE notifications SET is_read = TRUE, created_at = now() - interval '3 days' WHERE event_id IN
         (SELECT event_id FROM events WHERE start_time < now())`);

const counts = (await q(`SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM clubs) clubs, (SELECT count(*) FROM events) events,
  (SELECT count(*) FROM registrations) registrations, (SELECT count(*) FROM attendance) attendance, (SELECT count(*) FROM notifications) notifications`)).rows[0];
console.log('seeded:', counts);
await client.end();
