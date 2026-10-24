// Minimal Cloudflare D1 API over node:sqlite, covering what the Sites code
// uses: prepare().bind().all/first/run/raw, exec and batch. Values and result
// shapes follow D1 so the original stores run unchanged.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

// node:sqlite rows have a null prototype; D1 returns plain objects.
const plain = row => row ? {...row} : row;

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params.map(v => v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)); }
  #stmt() { return this.db.prepare(this.sql); }
  async all() { const results = this.#stmt().all(...this.params).map(plain); return {results, success: true, meta: {changes: 0}}; }
  async first(column) { const row = plain(this.#stmt().get(...this.params)) ?? null; return column && row ? row[column] ?? null : row; }
  async raw() { return this.#stmt().all(...this.params).map(row => Object.values(row)); }
  async run() {
    const result = this.#stmt().run(...this.params);
    return {success: true, results: [], meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}};
  }
}

export class D1Shim {
  constructor(file) { this.db = new DatabaseSync(file); this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;'); }
  prepare(sql) { return new Statement(this.db, sql); }
  async exec(sql) { this.db.exec(sql); return {count: 0, duration: 0}; }
  async batch(statements) {
    this.db.exec('BEGIN');
    try { const out = []; for (const s of statements) out.push(await s.run()); this.db.exec('COMMIT'); return out; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  // Applies drizzle migrations once, tracking them like wrangler's d1_migrations.
  migrate(dir) {
    this.db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const done = new Set(this.db.prepare('SELECT name FROM d1_migrations').all().map(r => r.name));
    for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      const sql = readFileSync(path.join(dir, name), 'utf8').split('--> statement-breakpoint').join('\n');
      this.db.exec('BEGIN'); this.db.exec(sql);
      this.db.prepare('INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
      this.db.exec('COMMIT');
    }
  }
  close() { this.db.close(); }
}
