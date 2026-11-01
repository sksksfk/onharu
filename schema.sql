-- Apply once to an empty D1 database. No patient/medicine/contact fields.
CREATE TABLE IF NOT EXISTS vapid (
 id INTEGER PRIMARY KEY CHECK(id=1),
 public_key TEXT NOT NULL,
 private_jwk TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
 id TEXT PRIMARY KEY NOT NULL,
 endpoint TEXT UNIQUE NOT NULL,
 subscription TEXT NOT NULL,
 token_hash TEXT NOT NULL,
 times TEXT NOT NULL,
 time_zone TEXT NOT NULL CHECK(time_zone='Asia/Seoul'),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 schedule_since INTEGER NOT NULL,
 last_slot INTEGER,
 slot_attempts INTEGER NOT NULL DEFAULT 0,
 claimed_at INTEGER,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,
 last_attempt_at INTEGER,
 last_transport_status INTEGER,
 last_test_at INTEGER,
 test_due_at INTEGER
);
CREATE TABLE IF NOT EXISTS api_rate (
 id INTEGER PRIMARY KEY CHECK(id=1),
 minute INTEGER NOT NULL,
 count INTEGER NOT NULL
);
