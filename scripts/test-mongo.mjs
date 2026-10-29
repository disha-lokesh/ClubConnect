// MongoDB test suite (CRUD, unique index, validation, aggregation, failure handling).
// Imports the REAL data-access module src/lib/mongo.ts (Node strips the TypeScript types).
// Checks the server cannot perform (validators / TTL on MongoDB-compatible test servers) are reported as SKIP, never PASS.
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadEnv } from './env.mjs';
loadEnv();
const m = await import('../src/lib/mongo.ts');
const pipelines = await import('../src/lib/mongo-pipelines.mjs');
const db = await m.mongoDb();
const results = [];
const T_EVENT = 999999, T_STUDENT = 888888;     // ids that cannot exist in PostgreSQL: test data is isolated and removed afterwards

const tag = text => m.aggregationEngine() === 'server' ? text : { partial: text + ' [pipeline evaluated IN MEMORY with mingo; the test server cannot run it. Verify on real MongoDB]' };
const check = (c, msg) => { if (!c) throw new Error(msg); };
async function test(id, name, fn) {
  try { const r = await fn(); if (r && r.partial) { results.push({ id, name, status: 'PARTIAL', detail: r.partial }); console.log(`PARTIAL ${id} ${name}`); }
        else if (r && r.skip) { results.push({ id, name, status: 'SKIP', detail: r.skip }); console.log(`SKIP ${id} ${name}\n     ${r.skip}`); }
        else { results.push({ id, name, status: 'PASS', detail: String(r ?? '') }); console.log(`PASS ${id} ${name}`); } }
  catch (e) { results.push({ id, name, status: 'FAIL', detail: e.message }); console.log(`FAIL ${id} ${name}\n     ${e.message}`); }
}
const cleanup = async () => { await db.collection('event_announcements').deleteMany({ eventId: T_EVENT });
  await db.collection('event_feedback').deleteMany({ eventId: T_EVENT }); await db.collection('activity_logs').deleteMany({ 'metadata.test': true }); };
await cleanup();

// ---------------------------------------------------------------- announcements: Create / Read / Update / Delete
let annId;
await test('MC-01', 'CREATE announcement and READ it back', async () => {
  const a = await m.createAnnouncement(T_EVENT, 1, 1, m.announcementInput.parse({ title: 'Test post', body: 'Hello', tags: ['t'] }));
  annId = a._id; const list = await m.listAnnouncements(T_EVENT);
  check(list.length === 1 && list[0].title === 'Test post' && list[0].pinned === false, JSON.stringify(list)); return `inserted _id ${annId}`; });
await test('MC-02', 'UPDATE announcement (pin + edit body); updatedAt moves forward', async () => {
  const before = await m.getAnnouncement(annId); await new Promise(r => setTimeout(r, 15));
  const after = await m.updateAnnouncement(annId, m.announcementPatch.parse({ pinned: true, body: 'Edited body' }));
  check(after.pinned === true && after.body === 'Edited body' && after.title === 'Test post', JSON.stringify(after));
  check(new Date(after.updatedAt) > new Date(before.updatedAt), 'updatedAt did not change'); check(+new Date(after.createdAt) === +new Date(before.createdAt), 'createdAt changed'); return 'fields changed, createdAt untouched'; });
await test('MC-03', 'Pinned announcements sort first', async () => {
  await m.createAnnouncement(T_EVENT, 1, 1, m.announcementInput.parse({ title: 'Newer, unpinned', body: 'x' }));
  const list = await m.listAnnouncements(T_EVENT); check(list[0].pinned === true && list.length === 2, JSON.stringify(list.map(l => [l.title, l.pinned]))); return list.map(l => l.title).join(' > '); });
await test('MC-04', 'DELETE announcement', async () => {
  check(await m.deleteAnnouncement(annId) === true, 'delete returned false'); check(await m.getAnnouncement(annId) === null, 'document still there');
  check(await m.deleteAnnouncement(annId) === false, 'second delete should report false'); return 'deleted; second delete is a no-op (false)'; });
await test('MC-05', 'Malformed ObjectId is handled without crashing', async () => {
  check(await m.getAnnouncement('not-an-id') === null && await m.updateAnnouncement('zzz', { pinned: true }) === null && await m.deleteAnnouncement('123') === false, 'unexpected result'); return 'returns null/false'; });
await test('MC-06', 'Input validation (zod) rejects bad documents', async () => {
  const bad = [() => m.feedbackInput.parse({ rating: 9 }), () => m.feedbackInput.parse({ rating: 2.5 }), () => m.announcementInput.parse({ title: '  ', body: 'x' }),
               () => m.announcementInput.parse({ title: 'x', body: 'y', tags: Array(9).fill('a') })];
  for (const f of bad) { let threw = false; try { f(); } catch { threw = true; } check(threw, 'invalid input accepted'); } return '4 invalid payloads rejected'; });

// ---------------------------------------------------------------- feedback: upsert (create+update), unique index, delete
await test('MC-10', 'Feedback upsert: second save UPDATES the same document (no duplicate)', async () => {
  const a = await m.saveFeedback(T_EVENT, T_STUDENT, m.feedbackInput.parse({ rating: 3, comment: 'ok' }));
  await new Promise(r => setTimeout(r, 15));
  const b = await m.saveFeedback(T_EVENT, T_STUDENT, m.feedbackInput.parse({ rating: 5, comment: 'better', tags: ['engaging'] }));
  const n = await db.collection('event_feedback').countDocuments({ eventId: T_EVENT, studentUserId: T_STUDENT });
  check(n === 1 && b.rating === 5 && a._id === b._id, `count=${n} rating=${b.rating}`); check(+new Date(a.createdAt) === +new Date(b.createdAt), 'createdAt changed'); return 'rating 3 -> 5, still 1 document'; });
await test('MC-11', 'Unique index (eventId, studentUserId) rejects a duplicate insert', async () => {
  try { await db.collection('event_feedback').insertOne({ eventId: T_EVENT, studentUserId: T_STUDENT, rating: 1, createdAt: new Date() }); }
  catch (e) { check(e.code === 11000, `unexpected error ${e.code} ${e.message}`); return 'E11000 duplicate key'; } throw new Error('duplicate was accepted'); });
await test('MC-12', 'Club view of feedback does not expose student ids (projection)', async () => {
  const l = await m.listFeedback(T_EVENT); check(l.length === 1 && !('studentUserId' in l[0]), JSON.stringify(l)); return 'studentUserId omitted'; });
await test('MC-13', 'DELETE feedback', async () => { check(await m.deleteFeedback(T_EVENT, T_STUDENT) === true, 'not deleted'); check(await m.getMyFeedback(T_EVENT, T_STUDENT) === null, 'still there'); return 'removed'; });

// ---------------------------------------------------------------- aggregation (results compared with an independent JS calculation)
await test('MC-20', 'Aggregation: average rating per event equals a manual calculation', async () => {
  const agg = await m.reportFeedbackByEvent(); const all = await db.collection('event_feedback').find({}).toArray();
  check(agg.length > 0, 'no data; run npm run mongo:seed');
  for (const row of agg) { const mine = all.filter(d => d.eventId === row.eventId); const avg = mine.reduce((s, d) => s + d.rating, 0) / mine.length;
    check(mine.length === row.reviews && Math.abs(avg - row.avgRating) < 0.006, `event ${row.eventId}: agg ${row.avgRating}/${row.reviews} vs manual ${avg.toFixed(3)}/${mine.length}`); }
  for (let i = 1; i < agg.length; i++) check(agg[i - 1].avgRating >= agg[i].avgRating, 'not sorted'); return tag(`${agg.length} events; top: event ${agg[0].eventId} avg ${agg[0].avgRating} (${agg[0].reviews} reviews)`); });
await test('MC-21', 'Aggregation ($unwind): tag counts equal a manual count', async () => {
  const agg = await m.reportFeedbackTags(50); const all = await db.collection('event_feedback').find({}).toArray(); const manual = {};
  all.forEach(d => (d.tags || []).forEach(t => manual[t] = (manual[t] || 0) + 1));
  check(agg.length === Object.keys(manual).length && agg.every(r => manual[r.tag] === r.count), JSON.stringify(agg)); return tag(agg.slice(0, 3).map(r => `${r.tag}=${r.count}`).join(', ')); });
await test('MC-22', 'Aggregation ($dateToString): per-day activity sums to the number of logs in the window', async () => {
  const rows = await m.reportActivityPerDay(14); const total = rows.reduce((s, r) => s + r.count, 0);
  const manual = await db.collection('activity_logs').countDocuments({ createdAt: { $gte: new Date(Date.now() - 14 * 864e5) } });
  check(total === manual && /^\d{4}-\d{2}-\d{2}$/.test(rows[0].day), `agg=${total} manual=${manual}`); return tag(`${rows.length} (day, action) groups, ${total} events in the last 14 days`); });
await test('MC-23', 'Aggregation: most active users matches a manual count', async () => {
  const top = await m.reportTopActors(3); const manual = await db.collection('activity_logs').countDocuments({ actorUserId: top[0].actorUserId });
  check(top[0].actions === manual && top[0].actions >= top[1].actions, JSON.stringify(top)); return tag(`user ${top[0].actorUserId} (${top[0].actorRole}) = ${top[0].actions} actions`); });
await test('MC-24', 'Aggregation: announcements per club', async () => {
  const rows = await m.reportAnnouncementsPerClub(); const total = rows.reduce((s, r) => s + r.posts, 0);
  check(total === await db.collection('event_announcements').countDocuments({}), 'totals differ'); return tag(rows.map(r => `club ${r.clubId}: ${r.posts} posts (${r.pinned} pinned)`).join('; ')); });

// ---------------------------------------------------------------- activity log: create, read, delete, failure handling
await test('MC-30', 'logActivity inserts a document; listActivity reads it (filter + newest first)', async () => {
  await m.logActivity({ userId: 4242, role: 'STUDENT' }, 'TEST_ACTION', 'event', 7, { test: true });
  const r = await m.listActivity({ actorUserId: 4242, action: 'TEST_ACTION' }); check(r.length === 1 && r[0].metadata.test === true && r[0].entityId === 7, JSON.stringify(r)); return 'logged and read back'; });
await test('MC-31', 'purgeActivityOlderThan deletes only old entries', async () => {
  await db.collection('activity_logs').insertOne({ actorUserId: 4243, actorRole: 'STUDENT', action: 'OLD_ACTION', entityType: null, entityId: null, metadata: { test: true }, createdAt: new Date(Date.now() - 400 * 864e5) });
  const n = await m.purgeActivityOlderThan(365); const old = await db.collection('activity_logs').countDocuments({ action: 'OLD_ACTION' });
  const fresh = await db.collection('activity_logs').countDocuments({ action: 'TEST_ACTION' }); check(n >= 1 && old === 0 && fresh === 1, `deleted=${n} old=${old} fresh=${fresh}`); return `deleted ${n}, recent entry kept`; });
await test('MC-32', 'Connection failure: logActivity never throws; reads raise MongoUnavailableError', async () => {
  const code = `const m = await import('./src/lib/mongo.ts');
    await m.logActivity({userId:1,role:'STUDENT'},'X_ACTION');
    try { await m.listActivity({}); console.log('NO_ERROR'); } catch (e) { console.log(e.constructor.name); }`;
  const out = execFileSync('node', ['--input-type=module', '-e', code], { env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  check(out.trim().split('\n').pop() === 'MongoUnavailableError', `output: ${out}`); return 'write swallowed (logged to console), read -> MongoUnavailableError'; });

// ---------------------------------------------------------------- server features that depend on real MongoDB
const info = async n => (await db.listCollections({ name: n }).toArray())[0];
await test('MC-40', '$jsonSchema validator rejects an out-of-range rating at the database', async () => {
  const opts = (await info('event_feedback'))?.options || {};
  if (!opts.validator) return { skip: 'this MongoDB-compatible test server does not implement $jsonSchema validators; run against real MongoDB (npm run mongo:init without MONGO_COMPAT_MODE) to verify' };
  try { await db.collection('event_feedback').insertOne({ eventId: T_EVENT, studentUserId: 1, rating: 9, createdAt: new Date() }); }
  catch (e) { check(e.code === 121, `error ${e.code}`); return 'DocumentValidationFailure (121)'; } throw new Error('invalid document accepted'); });
await test('MC-41', 'TTL index exists on activity_logs.createdAt', async () => {
  const idx = (await db.collection('activity_logs').indexes()).find(i => i.name === 'ttl_createdAt');
  if (!idx || idx.expireAfterSeconds == null) return { skip: 'this MongoDB-compatible test server does not implement TTL indexes; verify on real MongoDB with db.activity_logs.getIndexes()' };
  check(idx.expireAfterSeconds === 180 * 86400, `ttl=${idx.expireAfterSeconds}`); return `expireAfterSeconds=${idx.expireAfterSeconds}`; });

await cleanup();
const c = s => results.filter(r => r.status === s).length;
console.log(`\n${c('PASS')} passed, ${c('PARTIAL')} partial (verified in memory only), ${c('FAIL')} failed, ${c('SKIP')} skipped (of ${results.length})`);
mkdirSync('docs', { recursive: true });
writeFileSync('docs/test-results-mongo.md', [`# MongoDB test results`, ``, `Generated by \`npm run test:mongo\` on ${new Date().toISOString()}.`,
  `Server: ${(await db.admin().serverInfo().catch(() => ({}))).version ?? 'unknown'} (${process.env.MONGODB_URI})`, ``,
  `**${c('PASS')} passed, ${c('PARTIAL')} partial, ${c('FAIL')} failed, ${c('SKIP')} skipped.** PARTIAL = the aggregation pipeline was checked against a manual calculation but evaluated in memory (mingo) because the test server cannot run it. SKIP = the test server cannot perform the check. Neither counts as a full pass; re-run against real MongoDB to close them.`, ``,
  `| ID | Test | Result | Evidence |`, `|---|---|---|---|`,
  ...results.map(r => `| ${r.id} | ${r.name} | ${r.status === 'FAIL' ? '**FAIL**' : r.status} | ${r.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)].join('\n') + '\n');
await (await import('mongodb')).MongoClient.prototype.close.call(await (await m.mongoDb()).client);
process.exit(c('FAIL') ? 1 : 0);
