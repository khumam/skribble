import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dir = process.env.SKRIBBLE_DATA_DIR || path.resolve('data');
mkdirSync(dir, { recursive: true });

const db = new Database(path.join(dir, 'skribble.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  code        TEXT PRIMARY KEY,
  state       TEXT NOT NULL DEFAULT 'lobby',   -- lobby | playing | ended
  phase       TEXT NOT NULL DEFAULT 'draw',    -- draw | guess | wait (between turns)
  round       INTEGER NOT NULL DEFAULT 1,
  turn_index  INTEGER NOT NULL DEFAULT 0,      -- index into players order
  word        TEXT,
  deadline    INTEGER NOT NULL DEFAULT 0,      -- epoch ms when current phase ends
  draw_ms     INTEGER NOT NULL DEFAULT 10000,
  guess_ms    INTEGER NOT NULL DEFAULT 10000,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code   TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  guessed     INTEGER NOT NULL DEFAULT 0,      -- 1 if guessed correctly this turn
  is_host     INTEGER NOT NULL DEFAULT 0,
  last_seen   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS strokes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code   TEXT NOT NULL,
  round       INTEGER NOT NULL,
  color       TEXT NOT NULL,
  size        INTEGER NOT NULL,
  path        TEXT NOT NULL,   -- JSON array of [x,y] (0..1000 normalized)
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_strokes_room ON strokes(room_code, round, id);
`);

// migrations for rooms created before phase/timer columns existed
try { db.exec(`ALTER TABLE rooms ADD COLUMN phase TEXT NOT NULL DEFAULT 'draw'`); } catch {}
try { db.exec(`ALTER TABLE rooms ADD COLUMN draw_ms INTEGER NOT NULL DEFAULT 10000`); } catch {}
try { db.exec(`ALTER TABLE rooms ADD COLUMN guess_ms INTEGER NOT NULL DEFAULT 10000`); } catch {}
// word_reveal was removed from the design; harmless if it lingers in old dbs

export default db;
