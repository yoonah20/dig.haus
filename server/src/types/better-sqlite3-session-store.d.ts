declare module 'better-sqlite3-session-store' {
  import type { Store, SessionData } from 'express-session';
  import type Database from 'better-sqlite3';

  interface StoreOptions {
    client: Database.Database;
    expired?: { clear?: boolean; intervalMs?: number };
  }

  interface StoreCtor {
    new (options: StoreOptions): Store;
  }

  function factory(session: any): StoreCtor;
  export default factory;
}
