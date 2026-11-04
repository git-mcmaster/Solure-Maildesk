-- Loaded history never expires automatically. Both preservation toggles default
-- off, permitting cleanup only of genuinely never-loaded pixels older than 90d.
ALTER TABLE settings ADD COLUMN keep_unloaded_pixels INTEGER NOT NULL DEFAULT 0 CHECK (keep_unloaded_pixels IN (0, 1));
ALTER TABLE pixels ADD COLUMN has_recorded_load INTEGER NOT NULL DEFAULT 0 CHECK (has_recorded_load IN (0, 1));
ALTER TABLE pixels ADD COLUMN preserve_unloaded INTEGER NOT NULL DEFAULT 0 CHECK (preserve_unloaded IN (0, 1));

CREATE INDEX notifications_pixel_id ON notifications(pixel_id);

-- Preserve any existing evidence, including counters left after manual history
-- clearing and notifications whose detailed events were previously expired.
UPDATE pixels SET has_recorded_load=1 WHERE load_count<>0 OR early_load_count<>0 OR daily_load_count<>0
  OR first_loaded_at IS NOT NULL OR last_loaded_at IS NOT NULL OR first_alert_at IS NOT NULL
  OR EXISTS (SELECT 1 FROM events WHERE events.pixel_id=pixels.id)
  OR EXISTS (SELECT 1 FROM notifications WHERE notifications.pixel_id=pixels.id);

CREATE INDEX pixels_unloaded_cleanup ON pixels(created_at,id) WHERE has_recorded_load=0 AND preserve_unloaded=0;

CREATE TRIGGER remember_recorded_load AFTER INSERT ON events
BEGIN
  UPDATE pixels SET has_recorded_load=1 WHERE id=NEW.pixel_id AND has_recorded_load=0;
END;
