-- ClubConnect | Demo 01 | DDL: CREATE / ALTER / DROP, constraints, and how the database defends itself.
-- Runs as the owner. Uses a disposable table (demo_scratch) so no real table is ever dropped.
\set ON_ERROR_STOP off
\echo '== 1. Describe the real tables (constraints visible)'
\d events
\d registrations

\echo '== 2. CREATE a disposable table with PK, UNIQUE, CHECK, FK, DEFAULT'
DROP TABLE IF EXISTS demo_scratch;
CREATE TABLE demo_scratch (
  id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id   BIGINT NOT NULL REFERENCES clubs(club_id) ON DELETE RESTRICT,
  label     VARCHAR(30) NOT NULL UNIQUE,
  seats     INT NOT NULL DEFAULT 10 CHECK (seats BETWEEN 1 AND 500),
  created   TIMESTAMPTZ NOT NULL DEFAULT now()
);
\d demo_scratch

\echo '== 3. ALTER: add a column, add a named constraint, change a default, rename'
ALTER TABLE demo_scratch ADD COLUMN notes TEXT;
ALTER TABLE demo_scratch ADD CONSTRAINT demo_label_not_blank CHECK (length(trim(label)) > 0);
ALTER TABLE demo_scratch ALTER COLUMN seats SET DEFAULT 25;
ALTER TABLE demo_scratch RENAME COLUMN notes TO remark;
\d demo_scratch

\echo '== 4. Constraints in action: each statement below MUST fail'
INSERT INTO demo_scratch (club_id, label, seats) VALUES (1, 'ok-row', 20);            -- succeeds (control)
INSERT INTO demo_scratch (club_id, label, seats) VALUES (1, 'ok-row', 20);            -- UNIQUE violation
INSERT INTO demo_scratch (club_id, label, seats) VALUES (1, 'big', 9999);             -- CHECK violation
INSERT INTO demo_scratch (club_id, label, seats) VALUES (99999, 'orphan', 5);         -- FK violation
INSERT INTO demo_scratch (club_id, label, seats) VALUES (1, '   ', 5);                -- named CHECK violation
INSERT INTO demo_scratch (club_id, label) VALUES (1, NULL);                           -- NOT NULL violation
DELETE FROM clubs WHERE club_id = 1;                                                  -- RESTRICT (club has events / dependants)

\echo '== 5. Real-table constraints: each must fail'
INSERT INTO users (email, password_hash, full_name, role) VALUES ('not-an-email', 'x', 'Bad Email', 'STUDENT');
INSERT INTO users (email, password_hash, full_name, role) VALUES ('x@y.com', 'x', 'Bad Role', 'SUPERUSER');
-- (events can only be inserted as DRAFT, so the CHECK constraints are demonstrated with draft inserts)
INSERT INTO events (club_id, category_id, venue_id, title, start_time, end_time, registration_deadline, capacity, created_by)
SELECT club_id, category_id, venue_id, 'bad times', start_time, start_time - interval '1 hour', start_time, 10, created_by FROM events LIMIT 1;      -- events_time_order
INSERT INTO events (club_id, category_id, venue_id, title, start_time, end_time, registration_deadline, capacity, created_by)
SELECT club_id, category_id, venue_id, 'bad deadline', start_time, end_time, start_time + interval '1 day', 10, created_by FROM events LIMIT 1;      -- events_deadline
INSERT INTO events (club_id, category_id, venue_id, title, start_time, end_time, registration_deadline, capacity, created_by)
SELECT club_id, category_id, venue_id, 'zero capacity', start_time, end_time, start_time, 0, created_by FROM events LIMIT 1;                      -- capacity > 0
UPDATE events SET capacity = 9999 WHERE event_id = 1;                                                                                              -- trigger: only DRAFT events are editable
INSERT INTO students (user_id, srn, department, year_of_study) SELECT user_id, 'PESXX', 'CSE', 2 FROM users WHERE role='CAMPUS_ADMIN' LIMIT 1;  -- role-pinned FK: only STUDENT accounts

\echo '== 6. DROP the disposable objects (controlled)'
DROP TABLE demo_scratch;
SELECT to_regclass('demo_scratch') AS demo_scratch_exists_after_drop;
