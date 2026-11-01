/**
 * db.js — Local SQLite storage layer.
 *
 * Uses Node's built-in `node:sqlite` module (no native compilation,
 * no npm install headaches — works the same on Termux, Linux, Mac, Windows).
 *
 * Every device has its OWN local database file (splitwise-p2p.db).
 * There is no shared/central database — sync.js is what reconciles
 * differences between each device's local copy.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'splitwise-p2p.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Pragmas for reasonable durability/performance on a local single-writer DB
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    device_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id),
    UNIQUE (group_id, device_id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    paid_by TEXT NOT NULL,
    split_between TEXT NOT NULL,
    created_by_device TEXT NOT NULL,
    hlc TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_hlc TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id)
  );
`);

// Tracks the last HLC we've seen FROM each peer device, per group.
// Lets sync.js ask a peer "give me everything after this point" instead
// of re-sending the full history every time.
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_state (
    group_id TEXT NOT NULL,
    peer_device_id TEXT NOT NULL,
    last_seen_hlc TEXT NOT NULL,
    PRIMARY KEY (group_id, peer_device_id)
  );
`);

module.exports = { db, DB_PATH };
