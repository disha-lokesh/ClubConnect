-- ClubConnect | Migration 003 | Indexes and views

-- ---------------------------------------------------------------- indexes
-- (the PRIMARY KEY / UNIQUE constraints and the exclusion constraint already create their own indexes)
CREATE INDEX idx_events_status_start   ON events (status, start_time);          -- catalogue: approved + upcoming
CREATE INDEX idx_events_club           ON events (club_id, status);             -- club dashboards
CREATE INDEX idx_events_venue_start    ON events (venue_id, start_time);        -- conflict look-ups for PENDING events
CREATE INDEX idx_events_category       ON events (category_id);                 -- category roll-up joins
CREATE INDEX idx_events_search         ON events USING gin (search_vector);     -- full-text search
CREATE INDEX idx_reg_student           ON registrations (student_id, status);   -- "my registrations"
CREATE INDEX idx_reg_event_status      ON registrations (event_id, status);     -- seat counting
CREATE INDEX idx_notif_user_unread     ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX idx_club_members_student  ON club_members (student_id);
CREATE INDEX idx_history_event         ON event_status_history (event_id, changed_at);
CREATE INDEX idx_categories_parent     ON event_categories (parent_category_id);

-- ---------------------------------------------------------------- views
-- security_invoker = the caller's row-level-security policies apply to the underlying tables.

-- V1 public catalogue of published events
CREATE VIEW published_events WITH (security_invoker = true) AS
SELECT e.event_id, e.title, e.description, e.club_id, c.name AS club_name,
       e.category_id, cat.name AS category_name, e.venue_id, v.name AS venue_name, v.building,
       e.start_time, e.end_time, e.registration_deadline, e.capacity, e.fee, e.eligibility, e.manual_approval,
       available_seats(e.event_id) AS seats_left,
       CASE WHEN now() < e.start_time THEN 'UPCOMING'
            WHEN now() < e.end_time   THEN 'ONGOING'
            ELSE 'COMPLETED' END AS lifecycle_phase,
       (now() <= e.registration_deadline AND available_seats(e.event_id) > 0) AS registration_open,
       e.search_vector
  FROM events e
  JOIN clubs c            ON c.club_id = e.club_id
  JOIN event_categories cat ON cat.category_id = e.category_id
  JOIN venues v           ON v.venue_id = e.venue_id
 WHERE e.status = 'APPROVED';

-- V2 registration / attendance figures per event
CREATE VIEW event_registration_summary WITH (security_invoker = true) AS
SELECT e.event_id, e.club_id, e.title, e.status AS event_status, e.start_time, e.capacity,
       count(*) FILTER (WHERE r.status = 'CONFIRMED') AS confirmed,
       count(*) FILTER (WHERE r.status = 'PENDING')   AS pending,
       count(*) FILTER (WHERE r.status = 'CANCELLED') AS cancelled,
       count(*) FILTER (WHERE r.status = 'REJECTED')  AS rejected,
       count(*) FILTER (WHERE a.present)              AS attended,
       round(100.0 * count(*) FILTER (WHERE r.status IN ('PENDING','CONFIRMED')) / e.capacity, 1) AS fill_percent
  FROM events e
  LEFT JOIN registrations r ON r.event_id = e.event_id
  LEFT JOIN attendance a    ON a.registration_id = r.registration_id
 GROUP BY e.event_id;

-- V3 pairs of live events that overlap in the same venue (campus-wide schedule-conflict monitor)
CREATE VIEW venue_conflicts WITH (security_invoker = true) AS
SELECT a.venue_id, v.name AS venue_name,
       a.event_id AS event_a, a.title AS title_a, a.status AS status_a,
       b.event_id AS event_b, b.title AS title_b, b.status AS status_b,
       greatest(a.start_time, b.start_time) AS overlap_start,
       least(a.end_time, b.end_time)        AS overlap_end
  FROM events a
  JOIN events b ON b.venue_id = a.venue_id AND a.event_id < b.event_id
              AND tstzrange(a.start_time, a.end_time, '[)') && tstzrange(b.start_time, b.end_time, '[)')
  JOIN venues v ON v.venue_id = a.venue_id
 WHERE a.status IN ('PENDING_APPROVAL','APPROVED') AND b.status IN ('PENDING_APPROVAL','APPROVED');

-- V4 a student's participation history (RLS limits registrations to the caller's own rows)
CREATE VIEW student_participation_history WITH (security_invoker = true) AS
SELECT r.registration_id, r.student_id, r.status AS registration_status, r.registered_at,
       e.event_id, e.title, e.start_time, e.end_time, e.status AS event_status, e.fee,
       c.name AS club_name, v.name AS venue_name, a.present AS attended
  FROM registrations r
  JOIN events e ON e.event_id = r.event_id
  JOIN clubs c  ON c.club_id = e.club_id
  JOIN venues v ON v.venue_id = e.venue_id
  LEFT JOIN attendance a ON a.registration_id = r.registration_id;

-- V5 participant list for club admins / campus admins
CREATE VIEW club_participants WITH (security_invoker = true) AS
SELECT r.registration_id, r.event_id, e.club_id, e.title AS event_title,
       u.user_id AS student_id, u.full_name, u.email, s.srn, s.department, s.year_of_study,
       r.status, r.registered_at, a.present
  FROM registrations r
  JOIN events e   ON e.event_id = r.event_id
  JOIN students s ON s.user_id = r.student_id
  JOIN users u    ON u.user_id = s.user_id
  LEFT JOIN attendance a ON a.registration_id = r.registration_id;

-- V6 recursive category tree (depth + readable path + root)
CREATE VIEW category_tree AS
WITH RECURSIVE tree AS (
  SELECT category_id, name, parent_category_id, 0 AS depth, name::TEXT AS path, category_id AS root_id
    FROM event_categories WHERE parent_category_id IS NULL
  UNION ALL
  SELECT c.category_id, c.name, c.parent_category_id, t.depth + 1, t.path || ' > ' || c.name, t.root_id
    FROM event_categories c JOIN tree t ON c.parent_category_id = t.category_id
   WHERE t.depth < 10                       -- guard against accidental cycles
)
SELECT * FROM tree;
