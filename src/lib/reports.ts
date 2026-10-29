import type { PoolClient } from 'pg';

// SQL reports for the campus dashboard. They demonstrate GROUP BY / HAVING, joins, a recursive CTE,
// a correlated subquery and a window function. Run with the caller's role (campus admin).
export const campusReports = async (c: PoolClient) => {
  const q = async (sql: string) => (await c.query(sql)).rows;
  return {
    clubParticipation: await q(`
      SELECT cl.name AS club, count(DISTINCT e.event_id) AS events,
             count(r.registration_id) FILTER (WHERE r.status = 'CONFIRMED') AS confirmed,
             count(a.registration_id) FILTER (WHERE a.present) AS attended,
             round(100.0 * count(a.registration_id) FILTER (WHERE a.present)
                   / NULLIF(count(r.registration_id) FILTER (WHERE r.status = 'CONFIRMED' AND e.start_time < now()), 0), 1) AS attendance_rate
        FROM clubs cl
        LEFT JOIN events e ON e.club_id = cl.club_id AND e.status = 'APPROVED'
        LEFT JOIN registrations r ON r.event_id = e.event_id
        LEFT JOIN attendance a ON a.registration_id = r.registration_id
       GROUP BY cl.club_id HAVING count(DISTINCT e.event_id) > 0
       ORDER BY confirmed DESC`),
    categoryRollup: await q(`
      WITH RECURSIVE tree AS (
        SELECT category_id, category_id AS root_id FROM event_categories WHERE parent_category_id IS NULL
        UNION ALL
        SELECT c.category_id, t.root_id FROM event_categories c JOIN tree t ON c.parent_category_id = t.category_id)
      SELECT root.name AS category, count(DISTINCT e.event_id) AS events,
             count(r.registration_id) FILTER (WHERE r.status = 'CONFIRMED') AS confirmed
        FROM tree t JOIN event_categories root ON root.category_id = t.root_id
        LEFT JOIN events e ON e.category_id = t.category_id AND e.status = 'APPROVED'
        LEFT JOIN registrations r ON r.event_id = e.event_id
       GROUP BY root.category_id, root.name ORDER BY confirmed DESC`),
    aboveClubAverage: await q(`
      SELECT s.title, cl.name AS club, s.fill_percent,
             round((SELECT avg(s2.fill_percent) FROM event_registration_summary s2 WHERE s2.club_id = s.club_id AND s2.event_status = 'APPROVED'), 1) AS club_average
        FROM event_registration_summary s JOIN clubs cl ON cl.club_id = s.club_id
       WHERE s.event_status = 'APPROVED'
         AND s.fill_percent > (SELECT avg(s2.fill_percent) FROM event_registration_summary s2 WHERE s2.club_id = s.club_id AND s2.event_status = 'APPROVED')
       ORDER BY s.fill_percent DESC LIMIT 8`),
    venueUtilisation: await q(`
      SELECT v.name AS venue, v.capacity, count(e.event_id) AS events, round(COALESCE(sum(extract(epoch FROM e.end_time - e.start_time)) / 3600, 0)::numeric, 1) AS hours_booked
        FROM venues v LEFT JOIN events e ON e.venue_id = v.venue_id AND e.status = 'APPROVED'
       GROUP BY v.venue_id ORDER BY hours_booked DESC`),
    eventFunnel: await q(`SELECT status, count(*) AS events FROM events WHERE status <> 'DRAFT' GROUP BY status ORDER BY count(*) DESC`),
    topStudents: await q(`
      SELECT * FROM (
        SELECT u.full_name AS student, s.department, count(*) FILTER (WHERE a.present) AS events_attended,
               dense_rank() OVER (ORDER BY count(*) FILTER (WHERE a.present) DESC) AS rank
          FROM students s JOIN users u ON u.user_id = s.user_id
          JOIN registrations r ON r.student_id = s.user_id LEFT JOIN attendance a ON a.registration_id = r.registration_id
         GROUP BY u.user_id, u.full_name, s.department) ranked
       WHERE events_attended > 0 AND rank <= 5 ORDER BY rank, student`),
    conflicts: await q(`SELECT venue_name, title_a, status_a, title_b, status_b, overlap_start, overlap_end FROM venue_conflicts ORDER BY overlap_start`),
  };
};
