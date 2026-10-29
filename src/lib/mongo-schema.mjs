// MongoDB collection definitions: JSON-Schema validators + indexes.
// Shared by scripts/mongo-init.mjs (creates them) and the tests, so there is a single source of truth.
//
// Why MongoDB for these three collections (and PostgreSQL for everything else)?
//  - activity_logs: append-only, high-volume, loosely structured "metadata" per action, expires with a TTL index.
//  - event_announcements: free-form posts with variable tags/attachments, edited and deleted by club admins.
//  - event_feedback: one flexible document per attended student, aggregated for ratings/tag clouds.
// None of these needs joins or multi-row transactions. Registrations, payments, approvals and capacity DO need them,
// so they stay in PostgreSQL. Mongo documents reference PostgreSQL rows by numeric id (events are never hard-deleted).

export const ROLES = ['STUDENT', 'CLUB_ADMIN', 'CAMPUS_ADMIN', 'ANONYMOUS'];
export const LOG_RETENTION_SECONDS = 180 * 24 * 3600;

export const COLLECTIONS = {
  activity_logs: {
    validator: { $jsonSchema: {
      bsonType: 'object',
      required: ['actorUserId', 'actorRole', 'action', 'createdAt'],
      properties: {
        actorUserId: { bsonType: ['int', 'long', 'double', 'null'], description: 'PostgreSQL users.user_id (null for failed logins)' },
        actorRole:   { enum: ROLES },
        action:      { bsonType: 'string', pattern: '^[A-Z_]{3,40}$' },
        entityType:  { bsonType: ['string', 'null'] },
        entityId:    { bsonType: ['int', 'long', 'double', 'null'] },
        metadata:    { bsonType: 'object' },
        createdAt:   { bsonType: 'date' },
      } } },
    indexes: [
      { key: { actorUserId: 1, createdAt: -1 }, name: 'actor_time' },
      { key: { action: 1, createdAt: -1 }, name: 'action_time' },
      { key: { entityType: 1, entityId: 1 }, name: 'entity' },
      { key: { createdAt: 1 }, name: 'ttl_createdAt', expireAfterSeconds: LOG_RETENTION_SECONDS },
    ],
  },
  event_announcements: {
    validator: { $jsonSchema: {
      bsonType: 'object',
      required: ['eventId', 'clubId', 'authorUserId', 'title', 'body', 'createdAt'],
      properties: {
        eventId:      { bsonType: ['int', 'long', 'double'] },
        clubId:       { bsonType: ['int', 'long', 'double'] },
        authorUserId: { bsonType: ['int', 'long', 'double'] },
        title:        { bsonType: 'string', minLength: 1, maxLength: 120 },
        body:         { bsonType: 'string', minLength: 1, maxLength: 2000 },
        pinned:       { bsonType: 'bool' },
        tags:         { bsonType: 'array', maxItems: 8, items: { bsonType: 'string', maxLength: 30 } },
        createdAt:    { bsonType: 'date' },
        updatedAt:    { bsonType: 'date' },
      } } },
    indexes: [
      { key: { eventId: 1, pinned: -1, createdAt: -1 }, name: 'event_pinned_time' },
      { key: { clubId: 1, createdAt: -1 }, name: 'club_time' },
    ],
  },
  event_feedback: {
    validator: { $jsonSchema: {
      bsonType: 'object',
      required: ['eventId', 'studentUserId', 'rating', 'createdAt'],
      properties: {
        eventId:       { bsonType: ['int', 'long', 'double'] },
        studentUserId: { bsonType: ['int', 'long', 'double'] },
        rating:        { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: 5 },
        comment:       { bsonType: 'string', maxLength: 1000 },
        tags:          { bsonType: 'array', maxItems: 6, items: { bsonType: 'string', maxLength: 30 } },
        createdAt:     { bsonType: 'date' },
        updatedAt:     { bsonType: 'date' },
      } } },
    indexes: [
      { key: { eventId: 1, studentUserId: 1 }, name: 'one_feedback_per_student', unique: true },
      { key: { eventId: 1, rating: 1 }, name: 'event_rating' },
    ],
  },
};
