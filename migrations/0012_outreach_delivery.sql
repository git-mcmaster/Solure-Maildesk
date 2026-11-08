-- Additive connected-send queue. Existing manual timing and message pairs stay intact.
CREATE TABLE outreach_automation_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
  resume_after TEXT
);
INSERT INTO outreach_automation_settings(id,paused) VALUES(1,0);

CREATE TABLE outreach_deliveries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES outreach_jobs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  approved_version INTEGER NOT NULL CHECK(approved_version>0),
  recipient TEXT NOT NULL,
  label TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  pixel_id TEXT,
  opt_out_url TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','submitting','accepted','sent','cancelled','blocked','needs_attention')),
  send_at TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  tracking_starts_at TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  accepted_at TEXT,
  sent_at TEXT,
  provider_message_id TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  cancelled_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
  claim_token TEXT,
  lease_until TEXT,
  reconcile_attempts INTEGER NOT NULL DEFAULT 0,
  next_reconcile_at TEXT,
  last_error TEXT
);
CREATE INDEX outreach_delivery_due ON outreach_deliveries(state,send_at);
CREATE INDEX outreach_delivery_day ON outreach_deliveries(submitted_at);
CREATE TABLE outreach_delivery_activity (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES outreach_deliveries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX outreach_delivery_activity_time ON outreach_delivery_activity(created_at DESC);

-- Keep this as one trigger: old test/rehearsal loaders execute the trigger tail intact.
CREATE TRIGGER suppress_automatic_outreach AFTER INSERT ON do_not_contact
BEGIN
  UPDATE outreach_deliveries SET cancel_requested=1,updated_at=NEW.created_at,
    state=CASE WHEN state='pending' THEN 'blocked' ELSE state END,
    last_error=CASE WHEN state IN ('pending','submitting') THEN 'This recipient is on the do-not-contact list.' ELSE last_error END
    WHERE recipient=NEW.recipient AND state IN ('pending','submitting','accepted','sent','needs_attention');
END;
