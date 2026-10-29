import type { PoolClient } from 'pg';

// Every function runs on a client obtained from withUser(), so row-level security of the caller's role applies.

export type EventRow = {
  event_id: number; title: string; description: string; status: string; club_id: number; club_name: string;
  category_id: number; category_name: string; venue_id: number; venue_name: string; building: string; venue_capacity: number;
  start_time: Date; end_time: Date; registration_deadline: Date; capacity: number; fee: number; eligibility: string;
  manual_approval: boolean; created_by: number; review_comment: string | null; cancel_reason: string | null;
  submitted_at: Date | null; reviewed_at: Date | null; seats_left: number; phase: string; registration_open: boolean;
};

const EVENT_SELECT = `
  SELECT e.event_id, e.title, e.description, e.status, e.club_id, c.name AS club_name, e.category_id, cat.name AS category_name,
         e.venue_id, v.name AS venue_name, v.building, v.capacity AS venue_capacity, e.start_time, e.end_time, e.registration_deadline,
         e.capacity, e.fee::float8 AS fee, e.eligibility, e.manual_approval, e.created_by, e.review_comment, e.cancel_reason,
         e.submitted_at, e.reviewed_at, available_seats(e.event_id) AS seats_left,
         CASE WHEN now() < e.start_time THEN 'UPCOMING' WHEN now() < e.end_time THEN 'ONGOING' ELSE 'COMPLETED' END AS phase,
         (e.status = 'APPROVED' AND now() <= e.registration_deadline AND available_seats(e.event_id) > 0) AS registration_open
    FROM events e
    JOIN clubs c ON c.club_id = e.club_id
    JOIN event_categories cat ON cat.category_id = e.category_id
    JOIN venues v ON v.venue_id = e.venue_id`;

export async function getEvent(c: PoolClient, id: number): Promise<EventRow | null> {
  return (await c.query(`${EVENT_SELECT} WHERE e.event_id = $1`, [id])).rows[0] ?? null;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m);

export type Filters = { q?: string; clubId?: number; categoryId?: number; from?: string; to?: string; maxFee?: number; when?: 'upcoming' | 'past' | 'all'; openOnly?: boolean };

/** Catalogue of PUBLISHED events (status APPROVED). Search = full-text prefix match OR title substring. Category filter includes sub-categories (recursive CTE). */
export async function listPublished(c: PoolClient, f: Filters): Promise<EventRow[]> {
  const where: string[] = [`e.status = 'APPROVED'`]; const p: unknown[] = [];
  const add = (v: unknown) => { p.push(v); return `$${p.length}`; };
  let cte = '';
  if (f.q?.trim()) {
    const words = f.q.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const tsq = words.length ? add(words.map(w => `${w}:*`).join(' & ')) : null;
    const like = add(`%${likeEscape(f.q.trim())}%`);
    where.push(`(${tsq ? `e.search_vector @@ to_tsquery('english', ${tsq}) OR ` : ''}e.title ILIKE ${like} ESCAPE '\\')`);
  }
  if (f.clubId) where.push(`e.club_id = ${add(f.clubId)}`);
  if (f.categoryId) {
    cte = `WITH RECURSIVE sub AS (SELECT category_id FROM event_categories WHERE category_id = ${add(f.categoryId)}
           UNION ALL SELECT ec.category_id FROM event_categories ec JOIN sub ON ec.parent_category_id = sub.category_id) `;
    where.push(`e.category_id IN (SELECT category_id FROM sub)`);
  }
  if (f.from) where.push(`e.start_time >= ${add(f.from)}::date::timestamp AT TIME ZONE 'Asia/Kolkata'`);
  if (f.to) where.push(`e.start_time < (${add(f.to)}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`);
  if (f.maxFee != null) where.push(`e.fee <= ${add(f.maxFee)}`);
  const when = f.when ?? 'upcoming';
  if (when === 'upcoming') where.push('e.end_time > now()'); else if (when === 'past') where.push('e.end_time <= now()');
  if (f.openOnly) where.push(`now() <= e.registration_deadline AND available_seats(e.event_id) > 0`);
  const sql = `${cte}${EVENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.start_time ${when === 'past' ? 'DESC' : 'ASC'} LIMIT 200`;
  return (await c.query(sql, p)).rows;
}

/** Events for the month grid. RLS decides what each role may see (students: approved only; club admins: + own pending/drafts). */
export async function calendarEvents(c: PoolClient, year: number, month: number): Promise<EventRow[]> {
  return (await c.query(`${EVENT_SELECT}
    WHERE e.status IN ('APPROVED','PENDING_APPROVAL')
      AND e.start_time >= make_timestamp($1,$2,1,0,0,0) AT TIME ZONE 'Asia/Kolkata'
      AND e.start_time <  (make_timestamp($1,$2,1,0,0,0) + interval '1 month') AT TIME ZONE 'Asia/Kolkata'
    ORDER BY e.start_time`, [year, month])).rows;
}

export async function myRegistrationFor(c: PoolClient, eventId: number) {
  return (await c.query(`SELECT r.registration_id, r.status, r.registered_at, a.present
                           FROM registrations r LEFT JOIN attendance a USING (registration_id) WHERE r.event_id = $1`, [eventId])).rows[0] ?? null;
}
export async function myRegistrations(c: PoolClient) {
  return (await c.query(`SELECT *, now() < start_time AS can_cancel_time FROM student_participation_history ORDER BY start_time DESC`)).rows;
}
export async function myNotifications(c: PoolClient, limit = 100) {
  return (await c.query(`SELECT notification_id, event_id, type, message, is_read, created_at FROM notifications ORDER BY created_at DESC, notification_id DESC LIMIT $1`, [limit])).rows;
}
export async function unreadCount(c: PoolClient): Promise<number> {
  return (await c.query(`SELECT count(*)::int AS n FROM notifications WHERE NOT is_read`)).rows[0].n;
}
export async function myClubs(c: PoolClient) {            // clubs the CLUB_ADMIN manages (RLS limits club_admins to own rows / own clubs)
  return (await c.query(`SELECT cl.club_id, cl.name, cl.description, cl.contact_email, cl.is_active
                           FROM clubs cl WHERE cl.club_id IN (SELECT club_id FROM club_admins WHERE user_id = app_user_id()) ORDER BY cl.name`)).rows;
}
export async function clubEvents(c: PoolClient) {
  return (await c.query(`${EVENT_SELECT} WHERE e.club_id IN (SELECT club_id FROM club_admins WHERE user_id = app_user_id())
                         ORDER BY CASE e.status WHEN 'PENDING_APPROVAL' THEN 0 WHEN 'DRAFT' THEN 1 WHEN 'REJECTED' THEN 2 WHEN 'APPROVED' THEN 3 ELSE 4 END, e.start_time DESC`)).rows as EventRow[];
}
export async function participants(c: PoolClient, eventId: number) {
  return (await c.query(`SELECT registration_id, student_id, full_name, email, srn, department, year_of_study, status, registered_at, present
                           FROM club_participants WHERE event_id = $1 ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'CONFIRMED' THEN 1 ELSE 2 END, registered_at`, [eventId])).rows;
}
export async function conflictsFor(c: PoolClient, eventId: number) {
  return (await c.query(`SELECT * FROM check_event_conflicts($1)`, [eventId])).rows;
}
export async function eventHistory(c: PoolClient, eventId: number) {
  return (await c.query(`SELECT h.old_status, h.new_status, h.changed_at, u.full_name AS changed_by
                           FROM event_status_history h LEFT JOIN users u ON u.user_id = h.changed_by WHERE h.event_id = $1 ORDER BY h.history_id`, [eventId])).rows;
}
export async function referenceData(c: PoolClient) {
  const [clubs, venues, categories] = await Promise.all([
    c.query(`SELECT club_id, name, description, contact_email, is_active FROM clubs ORDER BY name`),
    c.query(`SELECT venue_id, name, building, capacity, is_active FROM venues ORDER BY name`),
    c.query(`SELECT category_id, name, parent_category_id, depth, path FROM (SELECT t.*, ROW_NUMBER() OVER () rn FROM category_tree t) x ORDER BY path`),
  ]);
  return { clubs: clubs.rows, venues: venues.rows, categories: categories.rows };
}

/** Campus administrators: every event, optionally filtered by status (RLS lets this role see all rows). */
export async function allEvents(c: PoolClient, status?: string): Promise<EventRow[]> {
  return (await c.query(`${EVENT_SELECT} ${status ? 'WHERE e.status = $1' : ''} ORDER BY e.start_time DESC LIMIT 300`, status ? [status] : [])).rows;
}
