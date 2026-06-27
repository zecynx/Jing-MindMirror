CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  conversation_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  type TEXT,
  status TEXT,
  confidence INTEGER,
  hero_quote TEXT,
  essay TEXT,
  annotations TEXT,
  schema_version TEXT,
  stances TEXT,
  premortem_change TEXT,
  premortem_stay TEXT,
  blindspots TEXT,
  future_perspective TEXT,
  calibration_date TEXT,
  messages TEXT,
  total_turns INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  conversation_id TEXT,
  data TEXT,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
