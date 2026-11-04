-- Each pixel receives one durable 89-day snapshot. Automatic pixel cleanup
-- keeps the report; explicit owner deletion removes it before deleting a pixel.
ALTER TABLE pixels ADD COLUMN report_queued_at TEXT;
ALTER TABLE pixels ADD COLUMN report_sent_at TEXT;
CREATE INDEX pixels_report_due ON pixels(created_at,id) WHERE report_queued_at IS NULL;
CREATE INDEX pixels_reported_cleanup ON pixels(created_at,id) WHERE has_recorded_load=0 AND preserve_unloaded=0 AND report_sent_at IS NOT NULL;

CREATE TABLE pixel_reports (
  id TEXT PRIMARY KEY,
  pixel_id TEXT REFERENCES pixels(id) ON DELETE SET NULL,
  source_pixel_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  recipient TEXT NOT NULL,
  pixel_created_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  snapshot_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','dry_run')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  lease_token TEXT,
  delivered_at TEXT
);
CREATE INDEX pixel_reports_delivery ON pixel_reports(status,next_attempt_at);
CREATE INDEX pixel_reports_created ON pixel_reports(created_at DESC,id DESC);
CREATE INDEX pixel_reports_pixel_id ON pixel_reports(pixel_id);
