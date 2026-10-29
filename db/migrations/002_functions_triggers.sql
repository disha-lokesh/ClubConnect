-- ClubConnect | Migration 002 | Helper functions, triggers, stored business functions
-- Custom SQLSTATEs used for application-level errors (mapped to HTTP codes by the API):
--   CC403 not authorised | CC404 not found | CC409 conflict / illegal state | CC422 invalid input

CREATE FUNCTION cc_fail(p_code TEXT, p_msg TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%', p_msg USING ERRCODE = p_code;
END $$;

-- ---------------------------------------------------------------- request-context helpers
-- The API sets  app.user_id  once per transaction (SET LOCAL semantics). Everything else is derived from tables.
CREATE FUNCTION app_user_id() RETURNS BIGINT
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::BIGINT $$;

CREATE FUNCTION app_role() RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT role FROM users WHERE user_id = app_user_id() AND is_active
$$;

CREATE FUNCTION is_club_admin_of(p_club_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM club_admins ca
                  JOIN users u ON u.user_id = ca.user_id AND u.is_active
                 WHERE ca.club_id = p_club_id AND ca.user_id = app_user_id())
$$;

-- Seats currently held (PENDING + CONFIRMED). SECURITY DEFINER so every viewer sees the true figure
-- even though row-level security hides other students' registrations from them.
CREATE FUNCTION seats_taken(p_event_id BIGINT) RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::INT FROM registrations WHERE event_id = p_event_id AND status IN ('PENDING','CONFIRMED')
$$;

CREATE FUNCTION available_seats(p_event_id BIGINT) RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.capacity - seats_taken(e.event_id) FROM events e WHERE e.event_id = p_event_id
$$;

-- ================================================================ TRIGGERS
-- T1  events: validation, legal status transitions, edit lock, updated_at
CREATE FUNCTION trg_events_validate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v venues%ROWTYPE;
BEGIN
  SELECT * INTO v FROM venues WHERE venue_id = NEW.venue_id;
  IF TG_OP = 'INSERT' OR NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    IF NOT v.is_active THEN PERFORM cc_fail('CC422', 'venue is not active'); END IF;
  END IF;
  IF NEW.capacity > v.capacity THEN
    PERFORM cc_fail('CC422', format('event capacity %s exceeds venue capacity %s', NEW.capacity, v.capacity));
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN PERFORM cc_fail('CC422', 'new events must start as DRAFT'); END IF;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF (OLD.status, NEW.status) NOT IN (
           ('DRAFT','PENDING_APPROVAL'), ('PENDING_APPROVAL','DRAFT'),
           ('PENDING_APPROVAL','APPROVED'), ('PENDING_APPROVAL','REJECTED'),
           ('REJECTED','DRAFT'), ('DRAFT','CANCELLED'), ('APPROVED','CANCELLED')) THEN
        PERFORM cc_fail('CC409', format('illegal event status change %s -> %s', OLD.status, NEW.status));
      END IF;
    ELSIF OLD.status <> 'DRAFT' AND
          (OLD.title, OLD.description, OLD.start_time, OLD.end_time, OLD.registration_deadline, OLD.capacity,
           OLD.fee, OLD.eligibility, OLD.manual_approval, OLD.venue_id, OLD.category_id)
          IS DISTINCT FROM
          (NEW.title, NEW.description, NEW.start_time, NEW.end_time, NEW.registration_deadline, NEW.capacity,
           NEW.fee, NEW.eligibility, NEW.manual_approval, NEW.venue_id, NEW.category_id) THEN
      PERFORM cc_fail('CC409', 'only DRAFT events can be edited; reopen the event first');
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER events_validate BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION trg_events_validate();

-- T2  events: audit trail of every status change (who comes from app.user_id)
CREATE FUNCTION trg_events_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO event_status_history (event_id, old_status, new_status, changed_by)
    VALUES (NEW.event_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, app_user_id());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_history AFTER INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION trg_events_history();

-- T3  events: notifications for the approval workflow (the ONLY place these are created)
CREATE FUNCTION trg_events_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'PENDING_APPROVAL' THEN
    INSERT INTO notifications (user_id, event_id, type, message)
    SELECT u.user_id, NEW.event_id, 'EVENT_SUBMITTED',
           format('"%s" was submitted for approval', NEW.title)
      FROM users u WHERE u.role = 'CAMPUS_ADMIN' AND u.is_active;
  ELSIF NEW.status IN ('APPROVED','REJECTED') THEN
    INSERT INTO notifications (user_id, event_id, type, message)
    SELECT ca.user_id, NEW.event_id, 'EVENT_' || NEW.status,
           CASE NEW.status
             WHEN 'APPROVED' THEN format('"%s" was approved and is now published', NEW.title)
             ELSE format('"%s" was rejected: %s', NEW.title, NEW.review_comment) END
      FROM club_admins ca WHERE ca.club_id = NEW.club_id;
  ELSIF NEW.status = 'CANCELLED' THEN
    INSERT INTO notifications (user_id, event_id, type, message)
    SELECT ca.user_id, NEW.event_id, 'EVENT_CANCELLED', format('"%s" was cancelled', NEW.title)
      FROM club_admins ca WHERE ca.club_id = NEW.club_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_notify AFTER UPDATE OF status ON events
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_events_notify();

-- T4  registrations: legal status transitions
CREATE FUNCTION trg_registrations_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('PENDING','CONFIRMED') THEN
      PERFORM cc_fail('CC422', 'a registration must start as PENDING or CONFIRMED');
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN (
         ('PENDING','CONFIRMED'), ('PENDING','REJECTED'), ('PENDING','CANCELLED'),
         ('CONFIRMED','CANCELLED'), ('CANCELLED','PENDING'), ('CANCELLED','CONFIRMED')) THEN
      PERFORM cc_fail('CC409', format('illegal registration status change %s -> %s', OLD.status, NEW.status));
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registrations_guard BEFORE INSERT OR UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION trg_registrations_guard();

-- T5  registrations: notifications for student (and club admins when approval is needed)
CREATE FUNCTION trg_registrations_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ev events%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT * INTO ev FROM events WHERE event_id = NEW.event_id;

  INSERT INTO notifications (user_id, event_id, type, message)
  VALUES (NEW.student_id, NEW.event_id,
          CASE NEW.status
            WHEN 'PENDING'   THEN 'REGISTRATION_PENDING'
            WHEN 'CONFIRMED' THEN 'REGISTRATION_CONFIRMED'
            WHEN 'REJECTED'  THEN 'REGISTRATION_REJECTED'
            WHEN 'CANCELLED' THEN CASE WHEN ev.status = 'CANCELLED' THEN 'EVENT_CANCELLED' ELSE 'REGISTRATION_CANCELLED' END
          END,
          CASE NEW.status
            WHEN 'PENDING'   THEN format('Your registration for "%s" is awaiting club approval', ev.title)
            WHEN 'CONFIRMED' THEN format('You are confirmed for "%s"', ev.title)
            WHEN 'REJECTED'  THEN format('Your registration for "%s" was not approved', ev.title)
            WHEN 'CANCELLED' THEN CASE WHEN ev.status = 'CANCELLED'
                                       THEN format('"%s" was cancelled by the organisers', ev.title)
                                       ELSE format('Your registration for "%s" was cancelled', ev.title) END
          END);

  IF NEW.status = 'PENDING' THEN
    INSERT INTO notifications (user_id, event_id, type, message)
    SELECT ca.user_id, NEW.event_id, 'REGISTRATION_RECEIVED',
           format('A new registration for "%s" needs your decision', ev.title)
      FROM club_admins ca WHERE ca.club_id = ev.club_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registrations_notify AFTER INSERT OR UPDATE OF status ON registrations
  FOR EACH ROW EXECUTE FUNCTION trg_registrations_notify();

-- T6  attendance: only CONFIRMED registrations can be marked
CREATE FUNCTION trg_attendance_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s VARCHAR;
BEGIN
  SELECT status INTO s FROM registrations WHERE registration_id = NEW.registration_id;
  IF s IS DISTINCT FROM 'CONFIRMED' THEN
    PERFORM cc_fail('CC409', 'attendance can only be recorded for CONFIRMED registrations');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_guard BEFORE INSERT OR UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION trg_attendance_guard();

-- ================================================================ BUSINESS FUNCTIONS (SECURITY DEFINER)
-- Each function authorises the caller itself (role + club ownership) before touching data.

-- Student registers for an event. The student is ALWAYS the logged-in user (no student_id argument).
-- Concurrency: the event row is locked with FOR UPDATE, so simultaneous attempts are serialised and the
-- capacity check + insert can never over-book. Re-registering after a cancellation re-uses the old row.
CREATE FUNCTION register_for_event(p_event_id BIGINT) RETURNS registrations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid BIGINT := app_user_id(); e events%ROWTYPE; reg registrations;
BEGIN
  IF app_role() IS DISTINCT FROM 'STUDENT' THEN PERFORM cc_fail('CC403', 'only students can register for events'); END IF;
  SELECT * INTO e FROM events WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR e.status <> 'APPROVED' THEN PERFORM cc_fail('CC404', 'event not found or not open for registration'); END IF;
  IF now() > e.registration_deadline THEN PERFORM cc_fail('CC409', 'registration deadline has passed'); END IF;
  IF e.eligibility = 'CLUB_MEMBERS' AND NOT EXISTS
     (SELECT 1 FROM club_members WHERE club_id = e.club_id AND student_id = uid) THEN
    PERFORM cc_fail('CC403', 'this event is open to club members only');
  END IF;
  IF seats_taken(p_event_id) >= e.capacity THEN PERFORM cc_fail('CC409', 'event is full'); END IF;

  INSERT INTO registrations (event_id, student_id, status)
  VALUES (p_event_id, uid, CASE WHEN e.manual_approval THEN 'PENDING' ELSE 'CONFIRMED' END)
  ON CONFLICT (event_id, student_id) DO UPDATE
     SET status = EXCLUDED.status, registered_at = now(), cancelled_at = NULL, decided_by = NULL, decided_at = NULL
     WHERE registrations.status = 'CANCELLED'
  RETURNING * INTO reg;
  IF NOT FOUND THEN PERFORM cc_fail('CC409', 'you already have a registration for this event'); END IF;
  RETURN reg;
END $$;

CREATE FUNCTION cancel_registration(p_registration_id BIGINT) RETURNS registrations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r registrations; e events%ROWTYPE;
BEGIN
  SELECT * INTO r FROM registrations WHERE registration_id = p_registration_id FOR UPDATE;
  IF NOT FOUND OR r.student_id IS DISTINCT FROM app_user_id() THEN PERFORM cc_fail('CC404', 'registration not found'); END IF;
  SELECT * INTO e FROM events WHERE event_id = r.event_id;
  IF r.status NOT IN ('PENDING','CONFIRMED') THEN PERFORM cc_fail('CC409', 'this registration cannot be cancelled'); END IF;
  IF now() >= e.start_time THEN PERFORM cc_fail('CC409', 'cancellation is closed once the event has started'); END IF;
  UPDATE registrations SET status = 'CANCELLED', cancelled_at = now() WHERE registration_id = r.registration_id RETURNING * INTO r;
  RETURN r;
END $$;

CREATE FUNCTION decide_registration(p_registration_id BIGINT, p_approve BOOLEAN) RETURNS registrations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r registrations; e events%ROWTYPE;
BEGIN
  SELECT * INTO r FROM registrations WHERE registration_id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM cc_fail('CC404', 'registration not found'); END IF;
  SELECT * INTO e FROM events WHERE event_id = r.event_id;
  IF NOT is_club_admin_of(e.club_id) THEN PERFORM cc_fail('CC403', 'you do not manage this club'); END IF;
  IF r.status <> 'PENDING' THEN PERFORM cc_fail('CC409', 'only PENDING registrations can be decided'); END IF;
  UPDATE registrations
     SET status = CASE WHEN p_approve THEN 'CONFIRMED' ELSE 'REJECTED' END,
         decided_by = app_user_id(), decided_at = now()
   WHERE registration_id = r.registration_id RETURNING * INTO r;
  RETURN r;
END $$;

CREATE FUNCTION submit_event(p_event_id BIGINT) RETURNS events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e events%ROWTYPE;
BEGIN
  SELECT * INTO e FROM events WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM cc_fail('CC404', 'event not found'); END IF;
  IF NOT is_club_admin_of(e.club_id) THEN PERFORM cc_fail('CC403', 'you do not manage this club'); END IF;
  IF e.status <> 'DRAFT' THEN PERFORM cc_fail('CC409', 'only DRAFT events can be submitted'); END IF;
  IF e.start_time <= now() THEN PERFORM cc_fail('CC422', 'the event start time is in the past'); END IF;
  UPDATE events SET status = 'PENDING_APPROVAL', submitted_at = now() WHERE event_id = p_event_id RETURNING * INTO e;
  RETURN e;
END $$;

-- withdraw a pending event or re-open a rejected one for editing
CREATE FUNCTION reopen_event(p_event_id BIGINT) RETURNS events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e events%ROWTYPE;
BEGIN
  SELECT * INTO e FROM events WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM cc_fail('CC404', 'event not found'); END IF;
  IF NOT is_club_admin_of(e.club_id) THEN PERFORM cc_fail('CC403', 'you do not manage this club'); END IF;
  IF e.status NOT IN ('PENDING_APPROVAL','REJECTED') THEN PERFORM cc_fail('CC409', 'only PENDING_APPROVAL or REJECTED events can be re-opened'); END IF;
  UPDATE events SET status = 'DRAFT' WHERE event_id = p_event_id RETURNING * INTO e;
  RETURN e;
END $$;

-- Campus administrator decision. Approval can fail with SQLSTATE 23P01 if the venue slot is already
-- taken by another APPROVED event (exclusion constraint events_no_venue_overlap).
CREATE FUNCTION review_event(p_event_id BIGINT, p_approve BOOLEAN, p_comment TEXT DEFAULT NULL) RETURNS events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e events%ROWTYPE;
BEGIN
  IF app_role() IS DISTINCT FROM 'CAMPUS_ADMIN' THEN PERFORM cc_fail('CC403', 'only campus administrators can review events'); END IF;
  SELECT * INTO e FROM events WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM cc_fail('CC404', 'event not found'); END IF;
  IF e.status <> 'PENDING_APPROVAL' THEN PERFORM cc_fail('CC409', 'only PENDING_APPROVAL events can be reviewed'); END IF;
  IF NOT p_approve AND length(trim(coalesce(p_comment, ''))) = 0 THEN
    PERFORM cc_fail('CC422', 'a reason is required when rejecting an event');
  END IF;
  UPDATE events
     SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
         reviewed_by = app_user_id(), reviewed_at = now(), review_comment = nullif(trim(coalesce(p_comment, '')), '')
   WHERE event_id = p_event_id RETURNING * INTO e;
  RETURN e;
END $$;

-- Cancel an event: the club (own events) or any campus admin. All live registrations are cancelled with it.
CREATE FUNCTION cancel_event(p_event_id BIGINT, p_reason TEXT) RETURNS events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e events%ROWTYPE;
BEGIN
  SELECT * INTO e FROM events WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM cc_fail('CC404', 'event not found'); END IF;
  IF NOT (is_club_admin_of(e.club_id) OR app_role() = 'CAMPUS_ADMIN') THEN
    PERFORM cc_fail('CC403', 'you cannot cancel this event');
  END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN PERFORM cc_fail('CC422', 'a cancellation reason is required'); END IF;
  UPDATE events SET status = 'CANCELLED', cancel_reason = trim(p_reason) WHERE event_id = p_event_id RETURNING * INTO e;
  UPDATE registrations SET status = 'CANCELLED', cancelled_at = now()
   WHERE event_id = p_event_id AND status IN ('PENDING','CONFIRMED');
  RETURN e;
END $$;

CREATE FUNCTION mark_attendance(p_registration_id BIGINT, p_present BOOLEAN) RETURNS attendance
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r registrations; e events%ROWTYPE; a attendance;
BEGIN
  SELECT * INTO r FROM registrations WHERE registration_id = p_registration_id;
  IF NOT FOUND THEN PERFORM cc_fail('CC404', 'registration not found'); END IF;
  SELECT * INTO e FROM events WHERE event_id = r.event_id;
  IF NOT is_club_admin_of(e.club_id) THEN PERFORM cc_fail('CC403', 'you do not manage this club'); END IF;
  IF now() < e.start_time THEN PERFORM cc_fail('CC409', 'attendance can only be recorded once the event has started'); END IF;
  INSERT INTO attendance (registration_id, present, marked_by) VALUES (p_registration_id, p_present, app_user_id())
  ON CONFLICT (registration_id) DO UPDATE SET present = EXCLUDED.present, marked_by = EXCLUDED.marked_by, marked_at = now()
  RETURNING * INTO a;
  RETURN a;
END $$;

-- Per-event statistics for club admins / campus admins
CREATE FUNCTION event_summary(p_event_id BIGINT)
RETURNS TABLE (event_id BIGINT, title VARCHAR, capacity INT, confirmed INT, pending INT, cancelled INT,
               rejected INT, seats_left INT, attended INT, attendance_rate NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e events%ROWTYPE;
BEGIN
  SELECT * INTO e FROM events ev WHERE ev.event_id = p_event_id;
  IF NOT FOUND THEN PERFORM cc_fail('CC404', 'event not found'); END IF;
  IF NOT (is_club_admin_of(e.club_id) OR app_role() = 'CAMPUS_ADMIN') THEN PERFORM cc_fail('CC403', 'not allowed'); END IF;
  RETURN QUERY
  SELECT e.event_id, e.title, e.capacity,
         count(*) FILTER (WHERE r.status = 'CONFIRMED')::INT,
         count(*) FILTER (WHERE r.status = 'PENDING')::INT,
         count(*) FILTER (WHERE r.status = 'CANCELLED')::INT,
         count(*) FILTER (WHERE r.status = 'REJECTED')::INT,
         e.capacity - count(*) FILTER (WHERE r.status IN ('PENDING','CONFIRMED'))::INT,
         count(*) FILTER (WHERE a.present)::INT,
         round(100.0 * count(*) FILTER (WHERE a.present) / nullif(count(*) FILTER (WHERE r.status = 'CONFIRMED'), 0), 1)
    FROM registrations r LEFT JOIN attendance a USING (registration_id)
   WHERE r.event_id = p_event_id;
END $$;

-- Other live events (PENDING_APPROVAL / APPROVED) that overlap this event in the same venue.
-- Interval overlap test:  [s1,e1) && [s2,e2)   <=>   s1 < e2 AND s2 < e1
CREATE FUNCTION check_event_conflicts(p_event_id BIGINT)
RETURNS TABLE (other_event_id BIGINT, other_title VARCHAR, other_club VARCHAR, other_status VARCHAR,
               other_start TIMESTAMPTZ, other_end TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e events%ROWTYPE;
BEGIN
  SELECT * INTO e FROM events ev WHERE ev.event_id = p_event_id;
  IF NOT FOUND THEN PERFORM cc_fail('CC404', 'event not found'); END IF;
  IF NOT (is_club_admin_of(e.club_id) OR app_role() = 'CAMPUS_ADMIN') THEN PERFORM cc_fail('CC403', 'not allowed'); END IF;
  RETURN QUERY
  SELECT o.event_id, o.title, c.name, o.status, o.start_time, o.end_time
    FROM events o JOIN clubs c ON c.club_id = o.club_id
   WHERE o.venue_id = e.venue_id AND o.event_id <> e.event_id
     AND o.status IN ('PENDING_APPROVAL','APPROVED')
     AND o.start_time < e.end_time AND e.start_time < o.end_time
   ORDER BY o.start_time;
END $$;

-- ================================================================ PRE-LOGIN FUNCTIONS (granted to the login role only)
CREATE FUNCTION authenticate_lookup(p_email TEXT)
RETURNS TABLE (user_id BIGINT, password_hash TEXT, full_name VARCHAR, role VARCHAR, is_active BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.user_id, u.password_hash, u.full_name, u.role, u.is_active FROM users u WHERE lower(u.email) = lower(p_email)
$$;

-- Public sign-up can only ever create STUDENT accounts.
CREATE FUNCTION register_student(p_email TEXT, p_hash TEXT, p_name TEXT, p_srn TEXT, p_dept TEXT, p_year INT, p_phone TEXT)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid BIGINT;
BEGIN
  INSERT INTO users (email, password_hash, full_name, role) VALUES (p_email, p_hash, p_name, 'STUDENT') RETURNING user_id INTO uid;
  INSERT INTO students (user_id, srn, department, year_of_study, phone) VALUES (uid, p_srn, p_dept, p_year, nullif(p_phone, ''));
  RETURN uid;
END $$;

-- Only a campus administrator can create privileged accounts.
CREATE FUNCTION create_staff_user(p_email TEXT, p_hash TEXT, p_name TEXT, p_role TEXT, p_club_id BIGINT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid BIGINT;
BEGIN
  IF app_role() IS DISTINCT FROM 'CAMPUS_ADMIN' THEN PERFORM cc_fail('CC403', 'only campus administrators can create staff accounts'); END IF;
  IF p_role NOT IN ('CLUB_ADMIN','CAMPUS_ADMIN') THEN PERFORM cc_fail('CC422', 'role must be CLUB_ADMIN or CAMPUS_ADMIN'); END IF;
  INSERT INTO users (email, password_hash, full_name, role) VALUES (p_email, p_hash, p_name, p_role) RETURNING user_id INTO uid;
  IF p_role = 'CLUB_ADMIN' AND p_club_id IS NOT NULL THEN
    INSERT INTO club_admins (club_id, user_id) VALUES (p_club_id, uid);
  END IF;
  RETURN uid;
END $$;
