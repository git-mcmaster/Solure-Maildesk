-- Add the owner's Outlook send-plan timestamp, never a delivery confirmation.
-- Manual records and history are preserved; obsolete preview plans are paused below.
ALTER TABLE pixels ADD COLUMN scheduled_send_at TEXT;

-- Earlier local preview builds had a simulated send queue. Never carry a
-- simulated activation window into the production planned-time workflow.
-- Manual pixels, recipient links and recorded load history are untouched.
UPDATE pixels SET status='paused',scheduled_send_at=NULL
  WHERE id IN (SELECT pixel_id FROM outreach_jobs WHERE state IN
    ('scheduled','submitting','awaiting_confirmation','cooldown','tracking','needs_attention'));
UPDATE outreach_jobs SET state='cancelled',approved_at=NULL,approved_version=NULL,
  scheduled_at=NULL,tracking_starts_at=NULL,claim_token=NULL,
  last_error='Prior timing cleared during the planned-time upgrade. Review and set your Outlook send time.'
  WHERE state IN ('scheduled','submitting','awaiting_confirmation','cooldown','tracking','needs_attention');
