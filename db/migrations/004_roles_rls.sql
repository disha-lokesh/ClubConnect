-- ClubConnect | Migration 004 | Database-level role-based access control
--
--   app_student, app_club_admin, app_campus_admin   NOLOGIN "capability" roles that carry all privileges
--   clubconnect_app                                  the only LOGIN role; NOINHERIT, so by itself it can do almost nothing.
--                                                    The API runs  SET LOCAL ROLE <capability role>  for each request.
--
-- Three layers: (1) table / column GRANTs, (2) row-level security policies, (3) SECURITY DEFINER functions for
-- state changes (they check role + ownership themselves).  Table owners (migration user) bypass RLS.

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_student','app_club_admin','app_campus_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clubconnect_app') THEN
    CREATE ROLE clubconnect_app LOGIN NOINHERIT;           -- password is set by scripts/migrate.mjs from DB_APP_PASSWORD
  END IF;
END $$;

GRANT app_student, app_club_admin, app_campus_admin TO clubconnect_app;
GRANT USAGE ON SCHEMA public TO app_student, app_club_admin, app_campus_admin, clubconnect_app;

-- trigger function that was written without SECURITY DEFINER in 002
ALTER FUNCTION trg_registrations_guard() SECURITY DEFINER SET search_path = public, pg_temp;

-- ---------------------------------------------------------------- users  (password_hash is never readable by any app role)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
GRANT SELECT (user_id, email, full_name, role, is_active, created_at) ON users TO app_student, app_club_admin, app_campus_admin;
GRANT UPDATE (full_name) ON users TO app_student, app_club_admin, app_campus_admin;
GRANT UPDATE (is_active) ON users TO app_campus_admin;
CREATE POLICY users_self_select   ON users FOR SELECT TO app_student, app_club_admin, app_campus_admin USING (user_id = app_user_id());
CREATE POLICY users_self_update   ON users FOR UPDATE TO app_student, app_club_admin, app_campus_admin
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY users_campus_select ON users FOR SELECT TO app_campus_admin USING (true);
CREATE POLICY users_campus_update ON users FOR UPDATE TO app_campus_admin USING (true) WITH CHECK (true);
CREATE POLICY users_club_sees_participants ON users FOR SELECT TO app_club_admin
  USING (role = 'STUDENT' AND EXISTS (SELECT 1 FROM registrations r WHERE r.student_id = users.user_id));

-- ---------------------------------------------------------------- students
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON students TO app_student, app_club_admin, app_campus_admin;
GRANT UPDATE (department, year_of_study, phone) ON students TO app_student;
CREATE POLICY students_self     ON students FOR SELECT TO app_student USING (user_id = app_user_id());
CREATE POLICY students_self_upd ON students FOR UPDATE TO app_student USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY students_campus   ON students FOR SELECT TO app_campus_admin USING (true);
CREATE POLICY students_club     ON students FOR SELECT TO app_club_admin
  USING (EXISTS (SELECT 1 FROM registrations r WHERE r.student_id = students.user_id)
      OR EXISTS (SELECT 1 FROM club_members m WHERE m.student_id = students.user_id));

-- ---------------------------------------------------------------- clubs
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON clubs TO app_student, app_club_admin, app_campus_admin;
GRANT INSERT, UPDATE, DELETE ON clubs TO app_campus_admin;
GRANT UPDATE (description, contact_email) ON clubs TO app_club_admin;
CREATE POLICY clubs_read        ON clubs FOR SELECT TO app_student, app_club_admin, app_campus_admin USING (true);
CREATE POLICY clubs_campus_ins  ON clubs FOR INSERT TO app_campus_admin WITH CHECK (true);
CREATE POLICY clubs_campus_upd  ON clubs FOR UPDATE TO app_campus_admin USING (true) WITH CHECK (true);
CREATE POLICY clubs_campus_del  ON clubs FOR DELETE TO app_campus_admin USING (true);
CREATE POLICY clubs_own_upd     ON clubs FOR UPDATE TO app_club_admin USING (is_club_admin_of(club_id)) WITH CHECK (is_club_admin_of(club_id));

-- ---------------------------------------------------------------- reference data (venues, categories)
GRANT SELECT ON venues, event_categories TO app_student, app_club_admin, app_campus_admin;
GRANT INSERT, UPDATE, DELETE ON venues, event_categories TO app_campus_admin;

-- ---------------------------------------------------------------- club_admins / club_members
ALTER TABLE club_admins ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON club_admins TO app_club_admin, app_campus_admin;
GRANT INSERT, DELETE ON club_admins TO app_campus_admin;
CREATE POLICY club_admins_club   ON club_admins FOR SELECT TO app_club_admin USING (is_club_admin_of(club_id));
CREATE POLICY club_admins_campus ON club_admins FOR ALL    TO app_campus_admin USING (true) WITH CHECK (true);

ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON club_members TO app_student;
GRANT INSERT (club_id, student_id) ON club_members TO app_student;
GRANT SELECT ON club_members TO app_club_admin, app_campus_admin;
GRANT UPDATE (member_role) ON club_members TO app_club_admin;
CREATE POLICY members_student_sel ON club_members FOR SELECT TO app_student USING (student_id = app_user_id());
CREATE POLICY members_student_ins ON club_members FOR INSERT TO app_student WITH CHECK (student_id = app_user_id());
CREATE POLICY members_student_del ON club_members FOR DELETE TO app_student USING (student_id = app_user_id());
CREATE POLICY members_club_sel    ON club_members FOR SELECT TO app_club_admin USING (is_club_admin_of(club_id));
CREATE POLICY members_club_upd    ON club_members FOR UPDATE TO app_club_admin USING (is_club_admin_of(club_id)) WITH CHECK (is_club_admin_of(club_id));
CREATE POLICY members_campus_sel  ON club_members FOR SELECT TO app_campus_admin USING (true);

-- ---------------------------------------------------------------- events
-- Club admins may INSERT / UPDATE only descriptive columns. status, reviewed_*, created_at ... can ONLY change through
-- the SECURITY DEFINER functions (submit_event, review_event, ...), so nobody can approve their own event.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON events TO app_student, app_club_admin, app_campus_admin;
GRANT INSERT (club_id, category_id, venue_id, title, description, start_time, end_time, registration_deadline,
              capacity, fee, eligibility, manual_approval, created_by) ON events TO app_club_admin;
GRANT UPDATE (category_id, venue_id, title, description, start_time, end_time, registration_deadline,
              capacity, fee, eligibility, manual_approval) ON events TO app_club_admin;
CREATE POLICY events_student_sel ON events FOR SELECT TO app_student     USING (status IN ('APPROVED','CANCELLED'));
CREATE POLICY events_club_sel    ON events FOR SELECT TO app_club_admin  USING (status = 'APPROVED' OR is_club_admin_of(club_id));
CREATE POLICY events_campus_sel  ON events FOR SELECT TO app_campus_admin USING (status <> 'DRAFT');
CREATE POLICY events_club_ins    ON events FOR INSERT TO app_club_admin  WITH CHECK (is_club_admin_of(club_id) AND created_by = app_user_id());
CREATE POLICY events_club_upd    ON events FOR UPDATE TO app_club_admin  USING (is_club_admin_of(club_id)) WITH CHECK (is_club_admin_of(club_id));

ALTER TABLE event_status_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON event_status_history TO app_club_admin, app_campus_admin;
CREATE POLICY hist_club   ON event_status_history FOR SELECT TO app_club_admin
  USING (EXISTS (SELECT 1 FROM events e WHERE e.event_id = event_status_history.event_id AND is_club_admin_of(e.club_id)));
CREATE POLICY hist_campus ON event_status_history FOR SELECT TO app_campus_admin USING (true);

-- ---------------------------------------------------------------- registrations / attendance (read-only for everybody; writes via functions)
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON registrations TO app_student, app_club_admin, app_campus_admin;
CREATE POLICY reg_student ON registrations FOR SELECT TO app_student USING (student_id = app_user_id());
CREATE POLICY reg_club    ON registrations FOR SELECT TO app_club_admin
  USING (EXISTS (SELECT 1 FROM events e WHERE e.event_id = registrations.event_id AND is_club_admin_of(e.club_id)));
CREATE POLICY reg_campus  ON registrations FOR SELECT TO app_campus_admin USING (true);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON attendance TO app_student, app_club_admin, app_campus_admin;
-- visible exactly when the parent registration is visible (re-uses the registrations policies above)
CREATE POLICY att_visible ON attendance FOR SELECT TO app_student, app_club_admin, app_campus_admin
  USING (EXISTS (SELECT 1 FROM registrations r WHERE r.registration_id = attendance.registration_id));

-- ---------------------------------------------------------------- notifications (own rows only; rows are created by triggers)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON notifications TO app_student, app_club_admin, app_campus_admin;
GRANT UPDATE (is_read) ON notifications TO app_student, app_club_admin, app_campus_admin;
CREATE POLICY notif_own_sel ON notifications FOR SELECT TO app_student, app_club_admin, app_campus_admin USING (user_id = app_user_id());
CREATE POLICY notif_own_upd ON notifications FOR UPDATE TO app_student, app_club_admin, app_campus_admin
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY notif_own_del ON notifications FOR DELETE TO app_student, app_club_admin, app_campus_admin USING (user_id = app_user_id());

-- ---------------------------------------------------------------- views
GRANT SELECT ON published_events, category_tree TO app_student, app_club_admin, app_campus_admin;
GRANT SELECT ON student_participation_history TO app_student;
GRANT SELECT ON event_registration_summary, venue_conflicts, club_participants TO app_club_admin, app_campus_admin;

-- ---------------------------------------------------------------- function privileges (default PUBLIC execute removed first)
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')   -- skip extension functions
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION app_user_id(), app_role(), is_club_admin_of(BIGINT), seats_taken(BIGINT), available_seats(BIGINT)
  TO app_student, app_club_admin, app_campus_admin;
GRANT EXECUTE ON FUNCTION register_for_event(BIGINT), cancel_registration(BIGINT) TO app_student;
GRANT EXECUTE ON FUNCTION decide_registration(BIGINT, BOOLEAN), submit_event(BIGINT), reopen_event(BIGINT),
                          mark_attendance(BIGINT, BOOLEAN) TO app_club_admin;
GRANT EXECUTE ON FUNCTION cancel_event(BIGINT, TEXT), event_summary(BIGINT), check_event_conflicts(BIGINT)
  TO app_club_admin, app_campus_admin;
GRANT EXECUTE ON FUNCTION review_event(BIGINT, BOOLEAN, TEXT), create_staff_user(TEXT, TEXT, TEXT, TEXT, BIGINT) TO app_campus_admin;
GRANT EXECUTE ON FUNCTION authenticate_lookup(TEXT), register_student(TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT) TO clubconnect_app;
