PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email_enabled INTEGER NOT NULL DEFAULT 0 CHECK (email_enabled IN (0, 1)),
  retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days IN (30, 90, 180)),
  repeat_alerts INTEGER NOT NULL DEFAULT 0 CHECK (repeat_alerts IN (0, 1))
);
INSERT INTO settings (id) VALUES (1);

CREATE TABLE pixels (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'armed', 'paused', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  armed_at TEXT,
  first_loaded_at TEXT,
  last_loaded_at TEXT,
  first_alert_at TEXT,
  load_count INTEGER NOT NULL DEFAULT 0,
  early_load_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX pixels_created_at ON pixels(created_at DESC);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  pixel_id TEXT NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('before_arming', 'after_arming'))
);
CREATE INDEX events_pixel_time ON events(pixel_id, created_at DESC);
CREATE INDEX events_time ON events(created_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  pixel_id TEXT NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  read_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dry_run', 'disabled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  lease_token TEXT,
  delivered_at TEXT
);
CREATE INDEX notifications_delivery ON notifications(status, next_attempt_at);
CREATE INDEX notifications_created_at ON notifications(created_at DESC);

-- SQLite serializes writes. Recording the event, counters and unique outbox item
-- in one statement prevents concurrent image requests from scheduling duplicate
-- first-load alerts. The outbox is not a promise of exactly-once email delivery.
CREATE TRIGGER record_load AFTER INSERT ON events
BEGIN
  UPDATE pixels SET
    first_loaded_at = COALESCE(first_loaded_at, NEW.created_at),
    last_loaded_at = NEW.created_at,
    load_count = load_count + 1,
    early_load_count = early_load_count + CASE WHEN NEW.phase = 'before_arming' THEN 1 ELSE 0 END
  WHERE id = NEW.pixel_id;

  INSERT OR IGNORE INTO notifications
    (id, pixel_id, dedupe_key, created_at, status, next_attempt_at)
  SELECT
    lower(hex(randomblob(16))), NEW.pixel_id,
    CASE WHEN p.first_alert_at IS NULL
      THEN 'first:' || NEW.pixel_id
      ELSE 'repeat:' || NEW.pixel_id || ':' || CAST(unixepoch(NEW.created_at) / 3600 AS TEXT)
    END,
    NEW.created_at,
    CASE WHEN s.email_enabled = 1 THEN 'pending' ELSE 'disabled' END,
    NEW.created_at
  FROM settings s JOIN pixels p ON p.id=NEW.pixel_id
  WHERE s.id = 1 AND NEW.phase = 'after_arming'
    AND (p.first_alert_at IS NULL
      OR (s.repeat_alerts = 1 AND NOT EXISTS (
        SELECT 1 FROM notifications WHERE pixel_id = NEW.pixel_id
          AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '-1 hour')
      )))
    AND (SELECT COUNT(*) FROM notifications WHERE created_at >= substr(NEW.created_at, 1, 10) || 'T00:00:00.000Z') < 200;

  UPDATE pixels SET first_alert_at=COALESCE(first_alert_at, NEW.created_at)
  WHERE id=NEW.pixel_id AND EXISTS (SELECT 1 FROM notifications WHERE dedupe_key='first:' || NEW.pixel_id);
END;
