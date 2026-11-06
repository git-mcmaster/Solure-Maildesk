-- Additive local review queue. Load history is retained. Existing do-not-contact
-- matches are paused and their queued alerts suppressed in the backfill below.
CREATE TABLE outreach_jobs (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','prepared','approved','scheduled','submitting','awaiting_confirmation','cooldown','tracking','cancelled','blocked','needs_attention')),
  label TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  prepared_html TEXT,
  prepared_text TEXT,
  pixel_id TEXT REFERENCES pixels(id) ON DELETE SET NULL,
  opt_out_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  approved_version INTEGER,
  scheduled_at TEXT,
  sent_at TEXT,
  tracking_starts_at TEXT,
  delay_seconds INTEGER NOT NULL DEFAULT 45 CHECK(delay_seconds=45),
  mailbox_draft_id TEXT,
  submit_started_at TEXT,
  claim_token TEXT,
  last_error TEXT
);
CREATE INDEX outreach_dispatch ON outreach_jobs(state,scheduled_at);
CREATE INDEX outreach_pixel ON outreach_jobs(pixel_id);

UPDATE pixels SET status='paused'
  WHERE status='armed' AND EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=lower(trim(pixels.recipient)));
UPDATE notifications SET status='disabled',
  lease_token=CASE WHEN status='sending' THEN lease_token ELSE NULL END,
  lease_until=CASE WHEN status='sending' THEN lease_until ELSE NULL END,
  last_error='This recipient is on the do-not-contact list.'
  WHERE status IN ('pending','failed','sending') AND pixel_id IN
    (SELECT id FROM pixels p WHERE EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=lower(trim(p.recipient))));

-- A confirmed opt-out takes effect immediately, including during the cooldown.
-- In-flight mailbox operations cannot be unsent; their outcome needs checking.
CREATE TRIGGER suppress_outreach AFTER INSERT ON do_not_contact
BEGIN
  UPDATE pixels SET status='paused',updated_at=NEW.created_at
    WHERE lower(trim(recipient))=NEW.recipient AND status='armed';
  UPDATE outreach_jobs SET state='blocked',updated_at=NEW.created_at,
    last_error='This recipient is on the do-not-contact list.'
    WHERE recipient=NEW.recipient AND state IN ('draft','prepared','approved','scheduled','cooldown','tracking');
  UPDATE notifications SET status='disabled',
    lease_token=CASE WHEN status='sending' THEN lease_token ELSE NULL END,
    lease_until=CASE WHEN status='sending' THEN lease_until ELSE NULL END,
    last_error='This recipient is on the do-not-contact list.'
    WHERE status IN ('pending','failed','sending') AND pixel_id IN
      (SELECT id FROM pixels WHERE lower(trim(recipient))=NEW.recipient);
END;
