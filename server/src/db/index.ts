import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', '..', 'diggershaus.db');

let db: Database.Database;

export function queryGet(sql: string, params: any[] = []): any | null {
  return db.prepare(sql).get(...params) ?? null;
}

export function queryAll(sql: string, params: any[] = []): any[] {
  return db.prepare(sql).all(...params);
}

export function execute(sql: string, params: any[] = []): void {
  db.prepare(sql).run(...params);
}

export function execRaw(sql: string): void {
  db.exec(sql);
}

export async function initDb(): Promise<Database.Database> {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  initializeDatabase(db);

  // Enforce FK constraints AFTER migrations (migrations temporarily toggle FK off).
  db.pragma('foreign_keys = ON');
  return db;
}

export function transaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

export function getDb(): Database.Database {
  return db;
}

export function closeDb(): void {
  if (!db) return;
  try {
    db.close();
    console.log('Database closed');
  } catch (err) {
    console.error('Error closing database:', err);
  }
}

export default { queryGet, queryAll, execute, execRaw, initDb, getDb, closeDb };
