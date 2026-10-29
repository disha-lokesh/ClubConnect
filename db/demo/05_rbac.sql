-- ClubConnect | Demo 05 | Authorisation inside PostgreSQL: roles, GRANT/REVOKE, column privileges, row-level security.
\set ON_ERROR_STOP off
-- a failing statement must not abort the surrounding demo transaction:
\set ON_ERROR_ROLLBACK on
\pset border 2
\echo '== R1 Roles that exist and what they can do'
SELECT rolname, rolcanlogin AS can_login, rolinherit AS inherits FROM pg_roles WHERE rolname LIKE 'app\_%' OR rolname = 'clubconnect_app' ORDER BY 1;
SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants WHERE grantee LIKE 'app\_%' AND table_schema='public' AND table_name IN ('events','registrations','users','clubs') GROUP BY grantee, table_name ORDER BY table_name, grantee;
\echo '== R2 Column-level privileges'
\echo '-- columns of users that each role may SELECT (password_hash is in nobody''s list):'
SELECT grantee, string_agg(column_name, ', ' ORDER BY ordinal_position) AS readable_columns FROM (
  SELECT cp.grantee, cp.column_name, c.ordinal_position FROM information_schema.column_privileges cp
    JOIN information_schema.columns c ON c.table_name = cp.table_name AND c.column_name = cp.column_name AND c.table_schema = cp.table_schema
   WHERE cp.table_schema='public' AND cp.table_name='users' AND cp.privilege_type='SELECT' AND cp.grantee LIKE 'app\_%') x GROUP BY grantee ORDER BY grantee;
\echo '-- columns of events that a CLUB ADMIN may write (note: no status, no reviewed_* columns):'
SELECT string_agg(DISTINCT column_name, ', ') AS club_admin_writable_event_columns FROM information_schema.column_privileges
 WHERE table_schema='public' AND table_name='events' AND grantee='app_club_admin' AND privilege_type='UPDATE';
SELECT count(*) AS roles_that_can_update_events_status FROM information_schema.column_privileges
 WHERE table_schema='public' AND table_name='events' AND column_name='status' AND privilege_type='UPDATE' AND grantee LIKE 'app\_%';
\echo '== R3 Row-level security policies'
SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;

\echo '== R4 STUDENT: sees published events (plus cancelled ones they registered for), only own registrations, cannot read other users'
BEGIN; SELECT set_config('app.user_id', (SELECT user_id::text FROM users WHERE email='aarav.sharma1@stu.pes.edu'), true); SET LOCAL ROLE app_student;
SELECT status, count(*) FROM events GROUP BY status;
SELECT count(*) AS my_registrations, count(DISTINCT student_id) AS distinct_students_visible FROM registrations;
SELECT count(*) AS users_visible FROM users;
SELECT password_hash FROM users LIMIT 1;
UPDATE events SET title = 'hacked' WHERE true;
INSERT INTO venues (name, building, capacity) VALUES ('x','y',1);
SELECT * FROM club_participants LIMIT 1;
ROLLBACK;

\echo '== R5 CLUB_ADMIN (Music Club only): sees own drafts/pending, not other clubs'' drafts; cannot approve; cannot touch status directly'
BEGIN; SELECT set_config('app.user_id', (SELECT user_id::text FROM users WHERE email='ca.music@pes.edu'), true); SET LOCAL ROLE app_club_admin;
SELECT c.name AS club, e.status, count(*) FROM events e JOIN clubs c USING (club_id) GROUP BY c.name, e.status ORDER BY 1,2;
UPDATE events SET status = 'APPROVED' WHERE status = 'PENDING_APPROVAL';
SELECT * FROM review_event((SELECT event_id FROM events WHERE status='PENDING_APPROVAL' LIMIT 1), true, 'x');
SELECT * FROM create_staff_user('x@pes.edu','x','X Y','CAMPUS_ADMIN', NULL);
ROLLBACK;

\echo '== R6 CAMPUS_ADMIN: sees everything, may approve; still cannot read password hashes'
BEGIN; SELECT set_config('app.user_id', (SELECT user_id::text FROM users WHERE email='admin@pes.edu'), true); SET LOCAL ROLE app_campus_admin;
SELECT status, count(*) FROM events GROUP BY status ORDER BY 1;
SELECT password_hash FROM users LIMIT 1;
ROLLBACK;

\echo '== R7 No identity (app.user_id unset): personal data is hidden; only public published events remain visible'
BEGIN; SET LOCAL ROLE app_student; SELECT count(*) AS events_visible FROM events; SELECT count(*) AS registrations_visible FROM registrations; ROLLBACK;

\echo '== R8 The single login role used by the web app cannot do anything until it switches role; PUBLIC cannot execute our functions'
SELECT has_function_privilege('public', 'register_for_event(bigint)', 'EXECUTE') AS public_can_execute_register;
SELECT has_function_privilege('app_student', 'register_for_event(bigint)', 'EXECUTE') AS student_can, has_function_privilege('app_student', 'review_event(bigint,boolean,text)', 'EXECUTE') AS student_can_review,
       has_function_privilege('app_campus_admin', 'review_event(bigint,boolean,text)', 'EXECUTE') AS campus_can_review;
SELECT has_table_privilege('clubconnect_app','events','SELECT') AS login_role_can_select_events_directly;
