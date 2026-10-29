-- ClubConnect | Migration 001 | Core relational schema (PostgreSQL 15+)
-- Source of truth for all structured data. See docs/03-relational-schema.md for the design notes.

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- needed by the venue-overlap exclusion constraint

-- ---------------------------------------------------------------- users & roles
CREATE TABLE users (
  user_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         VARCHAR(254) NOT NULL,
  password_hash TEXT         NOT NULL,                       -- bcrypt hash, never plain text
  full_name     VARCHAR(120) NOT NULL CHECK (length(trim(full_name)) > 0),
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('STUDENT','CLUB_ADMIN','CAMPUS_ADMIN')),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT users_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT users_id_role_uq   UNIQUE (user_id, role)       -- target of the role-pinned foreign keys below
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

-- 1:1 specialisation. The generated "role" column + composite FK makes it impossible
-- for a students row to point at a non-student account, without needing a trigger.
CREATE TABLE students (
  user_id       BIGINT PRIMARY KEY,
  role          VARCHAR(20) GENERATED ALWAYS AS ('STUDENT') STORED,
  srn           VARCHAR(20) NOT NULL UNIQUE,                 -- university registration number
  department    VARCHAR(60) NOT NULL,
  year_of_study SMALLINT    NOT NULL CHECK (year_of_study BETWEEN 1 AND 6),
  phone         VARCHAR(15) CHECK (phone ~ '^[0-9+ -]{7,15}$'),
  FOREIGN KEY (user_id, role) REFERENCES users (user_id, role) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- clubs
CREATE TABLE clubs (
  club_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(100) NOT NULL UNIQUE,
  description   TEXT         NOT NULL DEFAULT '',
  contact_email VARCHAR(254) CHECK (contact_email IS NULL OR contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- M:N  CLUB_ADMIN users <-> clubs  (who may manage which club)
CREATE TABLE club_admins (
  club_id     BIGINT NOT NULL REFERENCES clubs ON DELETE CASCADE,
  user_id     BIGINT NOT NULL,
  role        VARCHAR(20) GENERATED ALWAYS AS ('CLUB_ADMIN') STORED,
  assigned_on DATE   NOT NULL DEFAULT current_date,
  PRIMARY KEY (club_id, user_id),
  FOREIGN KEY (user_id, role) REFERENCES users (user_id, role) ON DELETE CASCADE
);

-- M:N  students <-> clubs  (membership; used for CLUB_MEMBERS-only events)
CREATE TABLE club_members (
  club_id     BIGINT   NOT NULL REFERENCES clubs ON DELETE CASCADE,
  student_id  BIGINT   NOT NULL REFERENCES students (user_id) ON DELETE CASCADE,
  member_role VARCHAR(20) NOT NULL DEFAULT 'MEMBER' CHECK (member_role IN ('MEMBER','OFFICE_BEARER')),
  joined_on   DATE     NOT NULL DEFAULT current_date,
  PRIMARY KEY (club_id, student_id)
);

-- ---------------------------------------------------------------- reference data
-- Self-referencing hierarchy (e.g. Technical -> AI/ML) -> used by the recursive CTE report.
CREATE TABLE event_categories (
  category_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               VARCHAR(60) NOT NULL UNIQUE,
  parent_category_id BIGINT REFERENCES event_categories ON DELETE RESTRICT,
  CHECK (parent_category_id IS NULL OR parent_category_id <> category_id)
);

CREATE TABLE venues (
  venue_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name      VARCHAR(80) NOT NULL UNIQUE,
  building  VARCHAR(80) NOT NULL,
  capacity  INT         NOT NULL CHECK (capacity > 0),
  is_active BOOLEAN     NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------- events
-- Approval status lives here. Registration status lives in "registrations" (kept separate on purpose).
CREATE TABLE events (
  event_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id               BIGINT       NOT NULL REFERENCES clubs,
  category_id           BIGINT       NOT NULL REFERENCES event_categories,
  venue_id              BIGINT       NOT NULL REFERENCES venues,
  title                 VARCHAR(150) NOT NULL CHECK (length(trim(title)) > 0),
  description           TEXT         NOT NULL DEFAULT '',
  start_time            TIMESTAMPTZ  NOT NULL,
  end_time              TIMESTAMPTZ  NOT NULL,
  registration_deadline TIMESTAMPTZ  NOT NULL,
  capacity              INT          NOT NULL CHECK (capacity > 0),
  fee                   NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  eligibility           VARCHAR(20)  NOT NULL DEFAULT 'OPEN' CHECK (eligibility IN ('OPEN','CLUB_MEMBERS')),
  manual_approval       BOOLEAN      NOT NULL DEFAULT FALSE,     -- club must approve each registration
  status                VARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED')),
  created_by            BIGINT       NOT NULL REFERENCES users,
  submitted_at          TIMESTAMPTZ,
  reviewed_by           BIGINT       REFERENCES users,
  reviewed_at           TIMESTAMPTZ,
  review_comment        TEXT,
  cancel_reason         TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  search_vector         TSVECTOR GENERATED ALWAYS AS
                        (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))) STORED,
  CONSTRAINT events_time_order    CHECK (end_time > start_time),
  CONSTRAINT events_deadline      CHECK (registration_deadline <= start_time),
  CONSTRAINT events_reject_reason CHECK (status <> 'REJECTED' OR length(trim(coalesce(review_comment,''))) > 0),
  -- Two APPROVED events may not use the same venue at overlapping times.
  -- Ranges are half-open [start,end) so back-to-back events are allowed.
  CONSTRAINT events_no_venue_overlap
    EXCLUDE USING gist (venue_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&)
    WHERE (status = 'APPROVED')
);

-- Written by a trigger (see 002). Gives the approval workflow a full audit trail.
CREATE TABLE event_status_history (
  history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id   BIGINT      NOT NULL REFERENCES events ON DELETE CASCADE,
  old_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,
  changed_by BIGINT      REFERENCES users,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- registrations & attendance
-- Seat-holding statuses: PENDING and CONFIRMED. REJECTED / CANCELLED release the seat.
CREATE TABLE registrations (
  registration_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        BIGINT      NOT NULL REFERENCES events   ON DELETE RESTRICT,
  student_id      BIGINT      NOT NULL REFERENCES students ON DELETE RESTRICT,
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED')),
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by      BIGINT      REFERENCES users,
  decided_at      TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  CONSTRAINT registrations_one_per_student UNIQUE (event_id, student_id)   -- duplicate-registration guard
);

CREATE TABLE attendance (
  registration_id BIGINT PRIMARY KEY REFERENCES registrations ON DELETE CASCADE,  -- 1:0..1
  present         BOOLEAN     NOT NULL,
  marked_by       BIGINT      NOT NULL REFERENCES users,
  marked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- notifications
-- Kept relational (as in the project synopsis). Rows are created only by triggers (see 002),
-- so application code never inserts them and duplicates cannot occur.
CREATE TABLE notifications (
  notification_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         BIGINT      NOT NULL REFERENCES users ON DELETE CASCADE,
  event_id        BIGINT      REFERENCES events ON DELETE CASCADE,
  type            VARCHAR(30) NOT NULL CHECK (type IN
                  ('EVENT_SUBMITTED','EVENT_APPROVED','EVENT_REJECTED','EVENT_CANCELLED',
                   'REGISTRATION_PENDING','REGISTRATION_RECEIVED','REGISTRATION_CONFIRMED',
                   'REGISTRATION_REJECTED','REGISTRATION_CANCELLED')),
  message         TEXT        NOT NULL,
  is_read         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
