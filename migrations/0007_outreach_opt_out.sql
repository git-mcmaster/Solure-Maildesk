-- These records intentionally have no pixel foreign key: sent links and opt-out
-- preferences remain valid after pixel history is cleared, deleted or retained.
CREATE TABLE opt_out_links (
  token TEXT PRIMARY KEY CHECK(length(token)=64),
  pixel_id TEXT NOT NULL,
  recipient TEXT NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254),
  created_at TEXT NOT NULL,
  UNIQUE(pixel_id,recipient)
);
CREATE TABLE do_not_contact (
  recipient TEXT PRIMARY KEY CHECK(length(recipient) BETWEEN 3 AND 254),
  created_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('recipient','owner'))
);
CREATE INDEX do_not_contact_created ON do_not_contact(created_at DESC,recipient);
