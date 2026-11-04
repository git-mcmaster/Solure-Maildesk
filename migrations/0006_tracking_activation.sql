-- A tracking activation is an explicit start/resume, separate from lifetime history.
ALTER TABLE pixels ADD COLUMN activation_id TEXT;
ALTER TABLE pixels ADD COLUMN activation_alert_at TEXT;
ALTER TABLE notifications ADD COLUMN activation_id TEXT;

UPDATE pixels SET activation_id=lower(hex(randomblob(16))) WHERE status='armed';
-- Associate only queues that belong to the current, already-active session.
UPDATE notifications SET activation_id=(SELECT p.activation_id FROM pixels p
  WHERE p.id=notifications.pixel_id AND p.status='armed' AND p.armed_at IS NOT NULL
    AND notifications.created_at>=p.armed_at);
-- A cleared notification must not cause an unsolicited first alert on upgrade.
UPDATE pixels SET activation_alert_at=COALESCE(
  (SELECT MAX(n.created_at) FROM notifications n WHERE n.pixel_id=pixels.id AND n.activation_id=pixels.activation_id),
  first_alert_at) WHERE status='armed';
-- Keep the lease of an in-flight send until its provider outcome can be recorded.
UPDATE notifications SET status='disabled',
  lease_token=CASE WHEN status='sending' THEN lease_token ELSE NULL END,
  lease_until=CASE WHEN status='sending' THEN lease_until ELSE NULL END
WHERE status IN ('pending','failed','sending') AND NOT EXISTS (
  SELECT 1 FROM pixels p WHERE p.id=notifications.pixel_id AND p.status='armed'
    AND p.activation_id=notifications.activation_id);
CREATE INDEX notifications_activation ON notifications(pixel_id,activation_id,created_at DESC);

DROP TRIGGER record_load;
CREATE TRIGGER record_load AFTER INSERT ON events
BEGIN
  UPDATE pixels SET
    first_loaded_at=COALESCE(first_loaded_at,NEW.created_at),
    last_loaded_at=NEW.created_at,
    load_count=load_count+1,
    early_load_count=early_load_count+CASE WHEN NEW.phase='before_arming' THEN 1 ELSE 0 END,
    daily_load_count=CASE WHEN daily_load_day=substr(NEW.created_at,1,10) THEN daily_load_count+1 ELSE 1 END,
    daily_load_day=substr(NEW.created_at,1,10)
  WHERE id=NEW.pixel_id;
  UPDATE settings SET
    event_count=CASE WHEN event_day=substr(NEW.created_at,1,10) THEN event_count+1 ELSE 1 END,
    event_day=substr(NEW.created_at,1,10)
  WHERE id=1;

  INSERT OR IGNORE INTO notifications
    (id,pixel_id,activation_id,dedupe_key,created_at,status,next_attempt_at)
  SELECT lower(hex(randomblob(16))),NEW.pixel_id,p.activation_id,
    CASE WHEN p.activation_alert_at IS NULL
      THEN 'activation:' || NEW.pixel_id || ':' || p.activation_id
      ELSE 'repeat:' || NEW.pixel_id || ':' || p.activation_id || ':' || CAST(unixepoch(NEW.created_at)/3600 AS TEXT)
    END,
    NEW.created_at,CASE WHEN s.email_enabled=1 THEN 'pending' ELSE 'disabled' END,NEW.created_at
  FROM settings s JOIN pixels p ON p.id=NEW.pixel_id
  WHERE s.id=1 AND NEW.phase='after_arming' AND p.status='armed' AND p.activation_id IS NOT NULL
    AND (p.activation_alert_at IS NULL OR (s.repeat_alerts=1
      AND p.activation_alert_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour')))
    AND (SELECT COUNT(*) FROM notifications WHERE created_at>=substr(NEW.created_at,1,10) || 'T00:00:00.000Z')<200;

  -- This durable marker survives Clear Activity and preserves the repeat cooldown.
  UPDATE pixels SET activation_alert_at=NEW.created_at,first_alert_at=COALESCE(first_alert_at,NEW.created_at)
  WHERE id=NEW.pixel_id AND EXISTS (SELECT 1 FROM notifications n
    WHERE n.pixel_id=NEW.pixel_id AND n.activation_id=pixels.activation_id AND n.created_at=NEW.created_at);
END;
