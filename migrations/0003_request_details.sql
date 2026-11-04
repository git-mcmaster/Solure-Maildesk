-- Additive: existing events retain NULL metadata and capture stays off by default.
-- Detailed request data follows event retention and cascaded history deletion.
ALTER TABLE settings ADD COLUMN capture_request_details INTEGER NOT NULL DEFAULT 0 CHECK (capture_request_details IN (0, 1));
ALTER TABLE events ADD COLUMN request_metadata TEXT;
CREATE INDEX events_pixel_time_id ON events(pixel_id, created_at DESC, id DESC);
