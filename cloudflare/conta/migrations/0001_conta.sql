CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  picture TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX web_sessions_user ON web_sessions(user_id);

CREATE TABLE google_pending (
  state_hash TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('conta', 'servidor')),
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL UNIQUE,
  machine TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT,
  credential_lookup TEXT UNIQUE,
  credential_hash TEXT,
  credential_prefix TEXT NOT NULL,
  tunnel_id TEXT,
  dns_record_id TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE INDEX installations_user ON installations(user_id);

CREATE TABLE activations (
  device_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  machine TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT,
  credential_prefix TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'consumed')),
  installation_id TEXT REFERENCES installations(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_codes (
  code_hash TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  nonce TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window_ends_at INTEGER NOT NULL
);
