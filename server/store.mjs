import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

// One row per Math Academy step that was followed, plus a few named values (which step is current).
export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS steps (key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, body TEXT NOT NULL);`);
    if (path !== ':memory:') chmodSync(path, 0o600);
  }
  step(key) {
    const row = this.db.prepare('SELECT body FROM steps WHERE key=?').get(key);
    return row ? JSON.parse(row.body) : null;
  }
  putStep(record) {
    this.db.prepare('INSERT INTO steps VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at')
      .run(record.key, JSON.stringify(record), record.updated_at);
  }
  steps() {
    return this.db.prepare('SELECT body FROM steps ORDER BY updated_at DESC').all().map(r => JSON.parse(r.body));
  }
  get(name) {
    const row = this.db.prepare('SELECT body FROM meta WHERE name=?').get(name);
    return row ? JSON.parse(row.body) : null;
  }
  set(name, value) {
    this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body').run(name, JSON.stringify(value));
  }
  close() { this.db.close(); }
}
