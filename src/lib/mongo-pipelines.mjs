// MongoDB aggregation pipelines (shared by the API and the tests).

/** Average rating, review count and rating histogram per event. */
export const feedbackByEvent = (eventIds) => [
  ...(eventIds ? [{ $match: { eventId: { $in: eventIds } } }] : []),
  { $group: { _id: '$eventId', avgRating: { $avg: '$rating' }, reviews: { $sum: 1 },
              five: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
              low:  { $sum: { $cond: [{ $lte: ['$rating', 2] }, 1, 0] } } } },
  { $project: { _id: 0, eventId: '$_id', reviews: 1, five: 1, low: 1, avgRating: { $round: ['$avgRating', 2] } } },
  { $sort: { avgRating: -1, reviews: -1 } },
];

/** Most frequent feedback tags (unwinds the tags array). */
export const feedbackTagCounts = (limit = 10) => [
  { $unwind: '$tags' },
  { $group: { _id: '$tags', count: { $sum: 1 } } },
  { $sort: { count: -1, _id: 1 } },
  { $limit: limit },
  { $project: { _id: 0, tag: '$_id', count: 1 } },
];

/** Activity per day and action for the last N days. */
export const activityPerDay = (sinceDate) => [
  { $match: { createdAt: { $gte: sinceDate } } },
  { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, action: '$action' }, count: { $sum: 1 } } },
  { $sort: { '_id.day': 1, count: -1 } },
  { $project: { _id: 0, day: '$_id.day', action: '$_id.action', count: 1 } },
];

/** Most active users. */
export const topActors = (limit = 5) => [
  { $match: { actorUserId: { $ne: null } } },
  { $group: { _id: { user: '$actorUserId', role: '$actorRole' }, actions: { $sum: 1 }, lastSeen: { $max: '$createdAt' } } },
  { $sort: { actions: -1 } },
  { $limit: limit },
  { $project: { _id: 0, actorUserId: '$_id.user', actorRole: '$_id.role', actions: 1, lastSeen: 1 } },
];

/** Announcements per club, with how many are pinned. */
export const announcementsPerClub = () => [
  { $group: { _id: '$clubId', posts: { $sum: 1 }, pinned: { $sum: { $cond: ['$pinned', 1, 0] } }, latest: { $max: '$createdAt' } } },
  { $sort: { posts: -1 } },
  { $project: { _id: 0, clubId: '$_id', posts: 1, pinned: 1, latest: 1 } },
];
