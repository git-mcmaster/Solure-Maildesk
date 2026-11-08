-- Additive private connection storage. No existing message, pairing or schedule
-- is adopted, changed, sent or deleted. Token ciphertext needs a separate Worker key.
CREATE TABLE mailbox_connection (
  id INTEGER PRIMARY KEY CHECK(id=1),
  tenant_id TEXT,
  client_id TEXT,
  owner_id TEXT,
  account_email TEXT,
  encrypted_tokens TEXT,
  access_expires_at INTEGER,
  granted_scopes TEXT NOT NULL DEFAULT '[]',
  connected_at TEXT,
  updated_at TEXT,
  last_error TEXT,
  refresh_lease_token TEXT,
  refresh_lease_until INTEGER,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0)
);
INSERT INTO mailbox_connection(id) VALUES(1);

CREATE TABLE mailbox_oauth_states (
  state_hash TEXT PRIMARY KEY CHECK(length(state_hash)=64),
  browser_hash TEXT NOT NULL CHECK(length(browser_hash)=64),
  encrypted_flow TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX mailbox_oauth_expiry ON mailbox_oauth_states(expires_at);
