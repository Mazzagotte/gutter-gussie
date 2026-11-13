-- Membership applications, their proof files, an activity log per application, and club settings.

CREATE TABLE applications (
  id            TEXT PRIMARY KEY,            -- random UUID
  ref           TEXT NOT NULL UNIQUE,        -- short reference shown to the applicant, e.g. GG-7K3QDM
  status        TEXT NOT NULL DEFAULT 'uploading', -- uploading → new → approved | declined
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT NOT NULL,
  street        TEXT NOT NULL,
  address_line2 TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL,
  state         TEXT NOT NULL,
  zip           TEXT NOT NULL,
  association   TEXT NOT NULL,
  event_name    TEXT NOT NULL,
  director      TEXT NOT NULL,
  score_date    TEXT NOT NULL,               -- YYYY-MM-DD
  score_type    TEXT NOT NULL,               -- game | series
  score         INTEGER NOT NULL,
  proof_method  TEXT NOT NULL,               -- upload | mail
  file_count    INTEGER NOT NULL DEFAULT 0,  -- files the applicant said they would upload
  proof_ok      INTEGER NOT NULL DEFAULT 0,  -- club checked the recap / standing sheet
  fee_paid      INTEGER NOT NULL DEFAULT 0,
  member_number TEXT NOT NULL DEFAULT '',
  admin_notes   TEXT NOT NULL DEFAULT '',
  upload_token  TEXT,                        -- SHA-256 of the one-time upload token; cleared when finished
  ip_hash       TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  submitted_at  INTEGER,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX applications_status ON applications (status, submitted_at DESC);
CREATE INDEX applications_ip ON applications (ip_hash, created_at);

CREATE TABLE application_files (
  id             INTEGER PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  key            TEXT NOT NULL UNIQUE,       -- R2 object key in gutter-gussie-proofs
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  size           INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX application_files_app ON application_files (application_id);

CREATE TABLE application_log (
  id             INTEGER PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor          TEXT NOT NULL,              -- 'applicant' or the admin's email
  text           TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX application_log_app ON application_log (application_id, created_at);

-- Editable from the admin: next tournament details and payment instructions.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
