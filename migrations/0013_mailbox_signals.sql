-- Metadata-only inbound monitoring. Existing messages, links and history remain.
CREATE TABLE outreach_signal_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_checked_at TEXT,
  scan_from TEXT,
  scan_until TEXT,
  next_link TEXT,
  lease_token TEXT,
  lease_until TEXT,
  last_error TEXT
);
INSERT INTO outreach_signal_state(id) VALUES(1);

-- Record unmatched report notices without storing incoming message bodies.
CREATE TABLE outreach_signal_notices (
  source_message_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  message TEXT NOT NULL
);

-- Reply/bounce holds are distinct from explicit do-not-contact preferences.
CREATE TABLE outreach_recipient_stops (
  recipient TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('reply','bounce','review')),
  created_at TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TRIGGER stop_automatic_followups AFTER INSERT ON outreach_recipient_stops
BEGIN
  UPDATE outreach_deliveries SET state='blocked',cancel_requested=1,updated_at=NEW.created_at,
    version=version+1,last_error=NEW.message
    WHERE recipient=NEW.recipient AND state='pending';
  UPDATE outreach_jobs SET state='needs_attention',updated_at=NEW.created_at,last_error=NEW.message
    WHERE id IN (SELECT job_id FROM outreach_deliveries WHERE recipient=NEW.recipient AND state='blocked');
END;
