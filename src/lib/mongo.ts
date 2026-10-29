import { MongoClient, ObjectId, type Db, type Document } from 'mongodb';
import { z } from 'zod';
import * as pipelines from './mongo-pipelines.mjs';

/**
 * MongoDB access layer.  PostgreSQL stays the source of truth: callers must authorise the user against PostgreSQL
 * (e.g. "does this admin manage this club?") BEFORE calling the write functions here.
 *
 * Cross-database consistency (no distributed transaction exists):
 *  - PostgreSQL commits first.  Activity logging then happens afterwards and is BEST-EFFORT: a MongoDB outage is
 *    logged to the server console but never fails the user's request (logActivity never throws).
 *  - Announcements / feedback live only in MongoDB; the API verifies the referenced event in PostgreSQL first.
 *    Events are never hard-deleted in PostgreSQL, so MongoDB documents can never point at a missing event.
 */
const globalForMongo = globalThis as unknown as { _mongo?: Promise<MongoClient> };

export class MongoUnavailableError extends Error {}

function client(): Promise<MongoClient> {
  if (!globalForMongo._mongo) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new MongoUnavailableError('MONGODB_URI is not set');
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 3000, maxPoolSize: 10 });
    globalForMongo._mongo = c.connect().catch(e => { globalForMongo._mongo = undefined; throw new MongoUnavailableError(e.message); });
  }
  return globalForMongo._mongo;
}
export async function mongoDb(): Promise<Db> { return (await client()).db(process.env.MONGODB_DB || 'clubconnect'); }

const clean = (d: Document | null): (Document & { _id: string }) | null => (d ? { ...d, _id: String(d._id) } : null);
export function toObjectId(id: string): ObjectId | null { return ObjectId.isValid(id) && String(new ObjectId(id)) === id ? new ObjectId(id) : null; }

// ------------------------------------------------------------------ input schemas (second validation layer)
export const announcementInput = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  pinned: z.boolean().optional().default(false),
  tags: z.array(z.string().trim().min(1).max(30)).max(8).optional().default([]),
});
export const announcementPatch = announcementInput.partial().refine(v => Object.keys(v).length > 0, 'nothing to update');
export const feedbackInput = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().default(''),
  tags: z.array(z.string().trim().min(1).max(30)).max(6).optional().default([]),
});

// ------------------------------------------------------------------ activity log (CREATE, READ, DELETE)
export type Actor = { userId: number | null; role: 'STUDENT' | 'CLUB_ADMIN' | 'CAMPUS_ADMIN' | 'ANONYMOUS' };

export async function logActivity(actor: Actor, action: string, entityType?: string, entityId?: number, metadata: Document = {}) {
  try {
    const db = await mongoDb();
    await db.collection('activity_logs').insertOne({
      actorUserId: actor.userId, actorRole: actor.role, action, entityType: entityType ?? null,
      entityId: entityId ?? null, metadata, createdAt: new Date(),
    });
  } catch (e) { console.error('[activity-log] failed (ignored):', (e as Error).message); }
}
export async function listActivity(filter: { actorUserId?: number; action?: string; limit?: number }) {
  const db = await mongoDb(); const q: Document = {};
  if (filter.actorUserId != null) q.actorUserId = filter.actorUserId;
  if (filter.action) q.action = filter.action;
  return (await db.collection('activity_logs').find(q).sort({ createdAt: -1 }).limit(Math.min(filter.limit ?? 50, 200)).toArray()).map(clean);
}
/** Campus-admin housekeeping: delete log entries older than N days (the TTL index does this automatically on real MongoDB). */
export async function purgeActivityOlderThan(days: number) {
  const db = await mongoDb();
  return (await db.collection('activity_logs').deleteMany({ createdAt: { $lt: new Date(Date.now() - days * 864e5) } })).deletedCount;
}

// ------------------------------------------------------------------ announcements (full CRUD)
export async function createAnnouncement(eventId: number, clubId: number, authorUserId: number, input: z.infer<typeof announcementInput>) {
  const db = await mongoDb(); const now = new Date();
  const doc = { eventId, clubId, authorUserId, ...input, createdAt: now, updatedAt: now };
  const r = await db.collection('event_announcements').insertOne(doc);
  return { ...doc, _id: String(r.insertedId) };
}
export async function listAnnouncements(eventId: number) {
  const db = await mongoDb();
  return (await db.collection('event_announcements').find({ eventId }).sort({ pinned: -1, createdAt: -1 }).toArray()).map(clean);
}
export async function getAnnouncement(id: string) {
  const oid = toObjectId(id); if (!oid) return null;
  return clean(await (await mongoDb()).collection('event_announcements').findOne({ _id: oid }));
}
export async function updateAnnouncement(id: string, patch: z.infer<typeof announcementPatch>) {
  const oid = toObjectId(id); if (!oid) return null;
  const r = await (await mongoDb()).collection('event_announcements')
    .findOneAndUpdate({ _id: oid }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: 'after' });
  return clean(r);
}
export async function deleteAnnouncement(id: string) {
  const oid = toObjectId(id); if (!oid) return false;
  return (await (await mongoDb()).collection('event_announcements').deleteOne({ _id: oid })).deletedCount === 1;
}

// ------------------------------------------------------------------ feedback (create/update via upsert, read, delete)
export async function saveFeedback(eventId: number, studentUserId: number, input: z.infer<typeof feedbackInput>) {
  const db = await mongoDb(); const now = new Date();
  await db.collection('event_feedback').updateOne(
    { eventId, studentUserId },
    { $set: { ...input, updatedAt: now }, $setOnInsert: { eventId, studentUserId, createdAt: now } },
    { upsert: true });
  return clean(await db.collection('event_feedback').findOne({ eventId, studentUserId }));
}
export async function getMyFeedback(eventId: number, studentUserId: number) {
  return clean(await (await mongoDb()).collection('event_feedback').findOne({ eventId, studentUserId }));
}
/** Club/campus view: anonymised (no student ids) */
export async function listFeedback(eventId: number) {
  const db = await mongoDb();
  return (await db.collection('event_feedback').find({ eventId }, { projection: { studentUserId: 0 } }).sort({ createdAt: -1 }).toArray()).map(clean);
}
export async function deleteFeedback(eventId: number, studentUserId: number) {
  return (await (await mongoDb()).collection('event_feedback').deleteOne({ eventId, studentUserId })).deletedCount === 1;
}

// ------------------------------------------------------------------ aggregation reports
let lastEngine: 'server' | 'mingo-in-memory' = 'server';
/** Which engine produced the most recent report: always 'server' on real MongoDB. */
export const aggregationEngine = () => lastEngine;

/**
 * Runs a pipeline on the MongoDB server.  Only when MONGO_COMPAT_MODE=1 (a MongoDB-compatible TEST server whose
 * aggregation support is incomplete, e.g. FerretDB) the pipeline is evaluated in memory with `mingo` instead.
 * That switch is explicit and reported by aggregationEngine(); with real MongoDB it is never used.
 */
async function aggregate(collection: string, pipeline: Document[]): Promise<Document[]> {
  const col = (await mongoDb()).collection(collection);
  if (process.env.MONGO_COMPAT_MODE === '1') {
    const { Aggregator } = await import('mingo');
    lastEngine = 'mingo-in-memory';
    return new Aggregator(pipeline as never).run(await col.find({}).toArray() as never) as Document[];
  }
  lastEngine = 'server';
  return col.aggregate(pipeline).toArray();
}
export const reportFeedbackByEvent = (eventIds?: number[]) => aggregate('event_feedback', pipelines.feedbackByEvent(eventIds));
export const reportFeedbackTags = (limit = 10) => aggregate('event_feedback', pipelines.feedbackTagCounts(limit));
export const reportActivityPerDay = (days = 14) => aggregate('activity_logs', pipelines.activityPerDay(new Date(Date.now() - days * 864e5)));
export const reportTopActors = (limit = 5) => aggregate('activity_logs', pipelines.topActors(limit));
export const reportAnnouncementsPerClub = () => aggregate('event_announcements', pipelines.announcementsPerClub());
