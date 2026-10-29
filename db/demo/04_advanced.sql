-- ClubConnect | Demo 04 | Functions, triggers, concurrency control, exclusion constraint, EXPLAIN.
-- Business functions use app.user_id and the app roles exactly as the Next.js backend does (SET LOCAL ROLE).
\set ON_ERROR_STOP off
\set ON_ERROR_ROLLBACK on
\pset border 2

\echo '== F1 The stored functions and triggers that exist'
SELECT proname AS function, pg_get_function_arguments(oid) AS args, CASE WHEN prosecdef THEN 'SECURITY DEFINER' ELSE 'INVOKER' END AS security
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prokind = 'f' ORDER BY 1;
SELECT event_object_table AS table_name, trigger_name, event_manipulation AS event, action_timing AS timing FROM information_schema.triggers WHERE trigger_schema='public' ORDER BY 1,2;

\echo '== F2 Function demo: register_for_event checks role, deadline, eligibility, capacity and duplicates, and locks the event row'
\echo '-- two students compete for the LAST seat of "Last Seat Demo Workshop" (1 seat left in the seed data)'
BEGIN;
SELECT set_config('app.user_id', (SELECT user_id::text FROM students s WHERE NOT EXISTS (SELECT 1 FROM registrations r WHERE r.student_id=s.user_id AND r.event_id=(SELECT event_id FROM events WHERE title='Last Seat Demo Workshop')) ORDER BY user_id LIMIT 1), true);
SET LOCAL ROLE app_student;
SELECT 'student A' AS who, status FROM register_for_event((SELECT event_id FROM events WHERE title='Last Seat Demo Workshop'));
SELECT available_seats(event_id) AS seats_left_after_A FROM events WHERE title='Last Seat Demo Workshop';
RESET ROLE;
SELECT set_config('app.user_id', (SELECT user_id::text FROM students s WHERE NOT EXISTS (SELECT 1 FROM registrations r WHERE r.student_id=s.user_id AND r.event_id=(SELECT event_id FROM events WHERE title='Last Seat Demo Workshop')) ORDER BY user_id LIMIT 1), true);
SET LOCAL ROLE app_student;
SELECT 'student B' AS who, status FROM register_for_event((SELECT event_id FROM events WHERE title='Last Seat Demo Workshop'));   -- must fail: event is full
ROLLBACK;
\echo '-- the same student registering twice for an open event'
BEGIN;
SELECT set_config('app.user_id', (SELECT user_id::text FROM students s WHERE NOT EXISTS (SELECT 1 FROM registrations r WHERE r.student_id=s.user_id AND r.event_id=(SELECT event_id FROM events WHERE title='Battle of Bands')) ORDER BY user_id LIMIT 1), true);
SET LOCAL ROLE app_student;
SELECT status FROM register_for_event((SELECT event_id FROM events WHERE title='Battle of Bands'));
SELECT status FROM register_for_event((SELECT event_id FROM events WHERE title='Battle of Bands'));   -- must fail: duplicate
ROLLBACK;
\echo '-- a registration whose deadline has passed, and a campus admin trying to register'
BEGIN; SELECT set_config('app.user_id', (SELECT user_id::text FROM students ORDER BY user_id LIMIT 1), true); SET LOCAL ROLE app_student;
SELECT * FROM register_for_event((SELECT event_id FROM events WHERE title='Intro to Web Dev Bootcamp')); ROLLBACK;
BEGIN; SELECT set_config('app.user_id', (SELECT user_id::text FROM users WHERE role='CAMPUS_ADMIN' LIMIT 1), true); SET LOCAL ROLE app_campus_admin;
SELECT * FROM register_for_event((SELECT event_id FROM events WHERE title='Battle of Bands')); ROLLBACK;

\echo '== F3 Trigger demo: registering automatically creates a notification for the student (trigger trg_registrations_notify)'
BEGIN;
SELECT count(*) AS notifications_before FROM notifications;
SELECT set_config('app.user_id', (SELECT user_id::text FROM students s WHERE NOT EXISTS (SELECT 1 FROM registrations r WHERE r.student_id=s.user_id AND r.event_id=(SELECT event_id FROM events WHERE title='Portrait Photography Masterclass')) ORDER BY user_id LIMIT 1), true);
SET LOCAL ROLE app_student;
SELECT status FROM register_for_event((SELECT event_id FROM events WHERE title='Portrait Photography Masterclass'));
RESET ROLE;
SELECT count(*) AS notifications_after FROM notifications;
SELECT u.role, n.type, n.message FROM notifications n JOIN users u USING (user_id) ORDER BY n.notification_id DESC LIMIT 1;
ROLLBACK;

\echo '== F4 Trigger demo: illegal status change is blocked (APPROVED -> DRAFT) and the status history table records legal ones'
BEGIN;
UPDATE events SET status = 'DRAFT' WHERE title = 'Battle of Bands';
ROLLBACK;
SELECT e.title, h.old_status, h.new_status, h.changed_at FROM event_status_history h JOIN events e USING (event_id) WHERE e.title = 'Battle of Bands' ORDER BY history_id;

\echo '== F5 Exclusion constraint: two APPROVED events cannot overlap in one venue (the database refuses the approval; the API reports it as HTTP 409)'
BEGIN;
INSERT INTO events (club_id, category_id, venue_id, title, start_time, end_time, registration_deadline, capacity, created_by, status)
SELECT club_id, category_id, venue_id, 'Overlap attempt', start_time + interval '30 minutes', end_time + interval '30 minutes', start_time, 10, created_by, 'DRAFT' FROM events WHERE title = 'Portrait Photography Masterclass';
UPDATE events SET status = 'PENDING_APPROVAL' WHERE title = 'Overlap attempt';
\echo 'Approve the overlapping event through the real function as campus admin:'
SELECT set_config('app.user_id', (SELECT user_id::text FROM users WHERE role='CAMPUS_ADMIN' LIMIT 1), true);
SET LOCAL ROLE app_campus_admin;
SELECT * FROM review_event((SELECT event_id FROM events WHERE title='Overlap attempt'), true, 'try');
ROLLBACK;

\echo '== F6 Row-level lock: how the last-seat race is made safe (FOR UPDATE on the event row)'
SELECT pg_get_functiondef('register_for_event(bigint)'::regprocedure);

\echo '== F7 Index usage (EXPLAIN) -- seq scan is expected on tiny tables; the planner picks the index once data grows.'
SET enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT * FROM events WHERE search_vector @@ to_tsquery('english','photograph:*');
EXPLAIN (COSTS OFF) SELECT * FROM registrations WHERE event_id = 1 AND status = 'CONFIRMED';
EXPLAIN (COSTS OFF) SELECT * FROM events WHERE status = 'APPROVED' AND start_time > now();
EXPLAIN (COSTS OFF) SELECT * FROM events WHERE venue_id = 1 AND tstzrange(start_time,end_time,'[)') && tstzrange(now(), now() + interval '1 day', '[)') AND status='APPROVED';
RESET enable_seqscan;
\echo '== F8 EXPLAIN ANALYZE of the heaviest report (category roll-up with recursive CTE)'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
WITH RECURSIVE tree AS (SELECT category_id, category_id AS root_id FROM event_categories WHERE parent_category_id IS NULL
  UNION ALL SELECT c.category_id, t.root_id FROM event_categories c JOIN tree t ON c.parent_category_id = t.category_id)
SELECT root.name, count(DISTINCT e.event_id) FROM tree t JOIN event_categories root ON root.category_id = t.root_id LEFT JOIN events e ON e.category_id = t.category_id GROUP BY root.name;
