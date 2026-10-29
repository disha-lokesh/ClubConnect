// Seeds MongoDB demo documents that reference PostgreSQL ids (run AFTER db:seed).
import { MongoClient } from 'mongodb';
import pg from 'pg';
import { loadEnv } from './env.mjs';

const env = loadEnv();
const pgc = new pg.Client({ connectionString: env.DATABASE_URL_ADMIN }); await pgc.connect();
const mc = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 4000 }); await mc.connect();
const db = mc.db(env.MONGODB_DB || 'clubconnect');
for (const c of ['activity_logs', 'event_announcements', 'event_feedback']) await db.collection(c).deleteMany({});

const ev = (await pgc.query(`SELECT event_id, club_id, title, status, start_time FROM events ORDER BY event_id`)).rows;
const admins = (await pgc.query(`SELECT user_id, club_id FROM club_admins`)).rows;
const users = (await pgc.query(`SELECT user_id, role FROM users ORDER BY user_id`)).rows;
const day = 864e5, now = Date.now();
const rnd = (() => { let s = 42; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();   // deterministic

// activity logs: ~250 entries over the last 30 days
const actions = [['LOGIN', null], ['LOGIN', null], ['LOGIN', null], ['REGISTRATION_CREATED', 'registration'], ['REGISTRATION_CANCELLED', 'registration'],
                 ['EVENT_CREATED', 'event'], ['EVENT_SUBMITTED', 'event'], ['EVENT_REVIEWED', 'event'], ['ATTENDANCE_MARKED', 'registration']];
const logs = [];
for (let i = 0; i < 250; i++) {
  const u = users[Math.floor(rnd() * users.length)]; const [action, type] = actions[Math.floor(rnd() * actions.length)];
  logs.push({ actorUserId: u.user_id, actorRole: u.role, action, entityType: type, entityId: type ? ev[Math.floor(rnd() * ev.length)].event_id : null,
              metadata: { ip: `10.0.${Math.floor(rnd() * 8)}.${Math.floor(rnd() * 250)}`, userAgent: rnd() > 0.5 ? 'Chrome' : 'Firefox' },
              createdAt: new Date(now - rnd() * 30 * day) });
}
await db.collection('activity_logs').insertMany(logs);

// announcements on a few upcoming approved events
const upcoming = ev.filter(e => e.status === 'APPROVED' && new Date(e.start_time) > now);
const ann = [];
for (const e of upcoming.slice(0, 6)) {
  const author = admins.find(a => a.club_id === e.club_id);
  ann.push({ eventId: e.event_id, clubId: e.club_id, authorUserId: author.user_id, title: `Details for ${e.title}`,
             body: 'Please bring your college ID card. Doors open 15 minutes before the start time.', pinned: true, tags: ['info'],
             createdAt: new Date(now - 2 * day), updatedAt: new Date(now - 2 * day) });
  ann.push({ eventId: e.event_id, clubId: e.club_id, authorUserId: author.user_id, title: 'Reminder',
             body: 'Registrations close one day before the event. Cancel early if you cannot attend so others can take your seat.', pinned: false, tags: ['reminder'],
             createdAt: new Date(now - 1 * day), updatedAt: new Date(now - 1 * day) });
}
await db.collection('event_announcements').insertMany(ann);

// feedback from students who actually attended past events
const attended = (await pgc.query(`SELECT r.event_id, r.student_id FROM registrations r JOIN attendance a USING (registration_id) WHERE a.present`)).rows;
const tagPool = ['well-organised', 'engaging', 'too-long', 'great-speaker', 'needs-better-venue', 'hands-on'];
const fb = [];
for (const a of attended) if (rnd() < 0.6) {
  const rating = Math.min(5, Math.max(1, Math.round(3.6 + (rnd() - 0.45) * 3)));
  fb.push({ eventId: a.event_id, studentUserId: a.student_id, rating, comment: rating >= 4 ? 'Really enjoyed it.' : 'Could be better organised.',
            tags: [tagPool[Math.floor(rnd() * tagPool.length)], tagPool[Math.floor(rnd() * tagPool.length)]].filter((t, i, arr) => arr.indexOf(t) === i),
            createdAt: new Date(now - rnd() * 5 * day), updatedAt: new Date() });
}
await db.collection('event_feedback').insertMany(fb);
console.log(`mongo seeded: ${logs.length} activity logs, ${ann.length} announcements, ${fb.length} feedback documents`);
await mc.close(); await pgc.end();
