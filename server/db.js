import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DATA_DIR lets Railway/Render mount a persistent volume (e.g. /data)
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "rhodes.db"));
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id TEXT,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  rating REAL,
  category TEXT DEFAULT '',
  photos TEXT DEFAULT '[]',
  tips TEXT DEFAULT '[]',
  note TEXT DEFAULT '',
  source TEXT DEFAULT 'api',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS place_folders (
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  PRIMARY KEY (place_id, folder_id)
);

CREATE TABLE IF NOT EXISTS trip (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,
  default_mode TEXT DEFAULT 'foot',
  stops TEXT DEFAULT '[]'
);
`);

// Foreign keys + cascade need enabling per-connection in SQLite
db.exec("PRAGMA foreign_keys = ON;");

// Seed trip + a starter folder on first run
const tripRow = db.prepare("SELECT * FROM trip WHERE id = 1").get();
if (!tripRow) {
  db.prepare("INSERT INTO trip (id, start_date, end_date) VALUES (1, ?, ?)").run(
    "2026-07-25",
    "2026-08-01"
  );
}
const folderCount = db.prepare("SELECT COUNT(*) AS c FROM folders").get().c;
if (folderCount === 0) {
  db.prepare("INSERT INTO folders (name) VALUES (?)").run("Want to Go");
}

export default db;
