import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { migrate } from './migrations'

/**
 * Single database connection for the main process. All DB access stays here;
 * the renderer only ever talks to narrow IPC handlers (see src/main/ipc.ts).
 */
let db: Database.Database | null = null

/** Database file path: <userData>/sports-shop.db (Windows: %APPDATA%\sports-shop\). */
export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'sports-shop.db')
}

/** Opens (creating/migrating on first run) and returns the shared connection. */
export function getDb(): Database.Database {
  if (!db) {
    db = new Database(getDatabasePath())
    migrate(db)
  }
  return db
}

/** Closes the connection (called on app quit). */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
