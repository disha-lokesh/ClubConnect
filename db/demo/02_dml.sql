-- ClubConnect | Demo 02 | DML: INSERT / UPDATE / DELETE / UPSERT / RETURNING, always inside a rolled-back transaction.
\set ON_ERROR_STOP off
BEGIN;
\echo '== INSERT ... RETURNING (new venue and club)'
INSERT INTO venues (name, building, capacity) VALUES ('Demo Lab', 'Block D', 30) RETURNING venue_id, name, capacity;
INSERT INTO clubs (name, description, contact_email) VALUES ('Demo Club', 'temporary', 'demo@pes.edu') RETURNING club_id, name;

\echo '== multi-row INSERT with a sub-select'
INSERT INTO event_categories (name, parent_category_id)
SELECT v.n, (SELECT category_id FROM event_categories WHERE name = 'Technical')
  FROM (VALUES ('Demo Sub A'), ('Demo Sub B')) AS v(n) RETURNING category_id, name, parent_category_id;

\echo '== UPDATE ... RETURNING'
UPDATE venues SET capacity = capacity + 10 WHERE name = 'Demo Lab' RETURNING name, capacity;

\echo '== UPDATE using a join (FROM): deactivate the venue called Old Hall'
UPDATE venues v SET is_active = false FROM (SELECT venue_id FROM venues WHERE name = 'Old Hall') o WHERE v.venue_id = o.venue_id RETURNING v.name, v.is_active;

\echo '== UPSERT: INSERT ... ON CONFLICT DO UPDATE'
INSERT INTO club_members (club_id, student_id, member_role)
SELECT (SELECT club_id FROM clubs WHERE name='Coding Club'), (SELECT user_id FROM users WHERE role='STUDENT' ORDER BY user_id LIMIT 1), 'OFFICE_BEARER'
ON CONFLICT (club_id, student_id) DO UPDATE SET member_role = EXCLUDED.member_role RETURNING *;

\echo '== DELETE ... RETURNING'
DELETE FROM event_categories WHERE name LIKE 'Demo Sub%' RETURNING category_id, name;
DELETE FROM clubs WHERE name = 'Demo Club' RETURNING club_id, name;

\echo '== DELETE blocked by a foreign key (RESTRICT): a parent category that still has children cannot be deleted'
DELETE FROM event_categories WHERE name = 'Technical';
ROLLBACK;
\echo '== after ROLLBACK nothing from this script persists:'
SELECT (SELECT count(*) FROM venues WHERE name='Demo Lab') AS demo_venues, (SELECT count(*) FROM clubs WHERE name='Demo Club') AS demo_clubs;
