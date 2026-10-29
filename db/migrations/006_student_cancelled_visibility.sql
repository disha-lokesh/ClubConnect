-- ClubConnect | Migration 006 | Tighten what students may see of CANCELLED events.
-- Before: students could read every CANCELLED event, including one cancelled while still awaiting approval
--         (an event that was never published) if they guessed its id.
-- Now:    students see APPROVED events, plus CANCELLED events only if they hold a registration for them
--         (so they can still read the cancellation notice for something they signed up for).
DROP POLICY events_student_sel ON events;
CREATE POLICY events_student_sel ON events FOR SELECT TO app_student
  USING (status = 'APPROVED'
         OR (status = 'CANCELLED' AND EXISTS (SELECT 1 FROM registrations r WHERE r.event_id = events.event_id AND r.student_id = app_user_id())));
