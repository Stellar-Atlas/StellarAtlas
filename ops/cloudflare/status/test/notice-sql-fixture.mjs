import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { NoticeDeliveryStore } from '../lib/notice-delivery-store.mjs';

export class SqlD1 {
  constructor(file = ':memory:') {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON');
  }
  prepare(sql) {
    const raw = this.raw;
    return {sql, args: [], bind(...args) { this.args = args; return this; },
      async run() { return {meta: {changes: Number(raw.prepare(sql).run(...this.args).changes)}}; },
      async all() { return {results: raw.prepare(sql).all(...this.args)}; }};
  }
  async batch(statements) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => ({meta: {changes: Number(
        this.raw.prepare(statement.sql).run(...statement.args).changes)}}));
      this.raw.exec('COMMIT'); return results;
    } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}
export function migrate(db, files = ['0001_status.sql', '0002_incident_details.sql', 'notice-delivery-schema.sql']) {
  for (const file of files) {
    const source = file === 'notice-delivery-schema.sql'
      ? new URL('./fixtures/notice-delivery-schema.sql', import.meta.url)
      : new URL('../migrations/' + file, import.meta.url);
    db.raw.exec(readFileSync(source, 'utf8'));
  }
}
export function persistentFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-notice-sql-')), file = join(directory, 'notice.sqlite');
  const f = {file, now: 1_793_620_800_123, handles: []};
  f.open = () => {
    const db = new SqlD1(file); f.handles.push(db);
    return {db, store: new NoticeDeliveryStore(db, () => f.now)};
  };
  f.close = db => { db.raw.close(); f.handles = f.handles.filter(item => item !== db); };
  t.after(() => {
    for (const db of f.handles) db.raw.close();
    if (resolve(dirname(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('atlas-notice-sql-'))
      throw new Error('Unexpected test cleanup target');
    for (const suffix of ['', '-journal', '-wal', '-shm']) if (existsSync(file + suffix)) unlinkSync(file + suffix);
    rmdirSync(directory);
  });
  const opened = f.open(); migrate(opened.db); return Object.assign(f, opened);
}
