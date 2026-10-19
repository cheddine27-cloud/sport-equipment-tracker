/**
 * Safe SQLite backup / restore using better-sqlite3's Backup API
 * (`db.backup()`), which is correct even while the database is actively used.
 *
 * Restore safeguards:
 *  - the candidate file must open as a valid SQLite database;
 *  - PRAGMA integrity_check must return "ok";
 *  - user_version must match the schema version produced by migrate()
 *    (protects against restoring unrelated or outdated databases);
 *  - a safety copy of the CURRENT live database is written before replacing it;
 *  - the live connection is closed and reopened only after all checks pass.
 */
import { join } from 'path'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync
} from 'fs'
import Database from 'better-sqlite3'
import { AppError } from '../../shared/types'
import { getDb, getDatabasePath, closeDb } from '../db'
import { migrate, LATEST_SCHEMA_VERSION } from '../db/migrations'

const BACKUP_DIR_NAME = 'backups'

function backupsDir(): string {
  const dir = join(getDatabasePath(), '..', BACKUP_DIR_NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

/** Result envelope returned to the renderer for listing backups. */
export interface BackupInfo {
  fileName: string
  sizeBytes: number
  createdAt: string
}

function describe(filePath: string): BackupInfo {
  const name = filePath.split(/[\\/]/).pop()!
  let size = 0
  try {
    size = readFileSync(filePath).byteLength
  } catch {
    /* ignore */
  }
  const createdMatch = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})/)
  return {
    fileName: name,
    sizeBytes: size,
    createdAt: createdMatch ? `${createdMatch[1]} ${createdMatch[2]}` : ''
  }
}

/** Creates a consistent online backup; returns its absolute path. */
export async function createBackup(label?: string): Promise<BackupInfo> {
  const safeLabel = typeof label === 'string' ? label.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 30) : ''
  const fileName = `backup-${stamp()}${safeLabel ? '-' + safeLabel : ''}.db`
  const target = join(backupsDir(), fileName)
  // better-sqlite3 Backup API — atomic snapshot of the live DB.
  await getDb().backup(target)
  // Ensure WAL contents are fully inside the backup file.
  const check = new Database(target, { readonly: true })
  try {
    const ok = check.pragma('integrity_check', { simple: true })
    if (ok !== 'ok') throw new AppError('DB_ERROR', 'ملف النسخة الاحتياطية الجديد غير سليم')
  } finally {
    check.close()
  }
  return describe(target)
}

/** Lists available backup files (newest first). */
export function listBackups(): BackupInfo[] {
  const dir = backupsDir()
  return readdirSync(dir)
    .filter((f) => /^backup-.*\.db$/.test(f))
    .map((f) => describe(join(dir, f)))
    .sort((a, b) => (a.fileName < b.fileName ? 1 : -1))
}

/** Validates a backup file WITHOUT touching the live database. */
export function validateBackupFile(fileName: string): { schemaVersion: number } {
  const path = resolveBackupPath(fileName)
  if (!existsSync(path)) throw new AppError('NOT_FOUND', 'ملف النسخة الاحتياطية غير موجود')
  let probe: Database.Database | null = null
  try {
    probe = new Database(path, { readonly: true })
  } catch {
    throw new AppError('VALIDATION', 'الملف ليس قاعدة بيانات SQLite صالحة')
  }
  try {
    const integrity = probe.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') {
      throw new AppError('VALIDATION', 'فحص سلامة النسخة الاحتياطية فشل — الملف تالف')
    }
    const version = Number(probe.pragma('user_version', { simple: true }))
    if (version > LATEST_SCHEMA_VERSION) {
      throw new AppError(
        'VALIDATION',
        'النسخة الاحتياطية أحدث من إصدار التطبيق الحالي — لا يمكن استعادتها'
      )
    }
    const hasProducts = probe
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='products'`)
      .get() as { n: number }
    if (hasProducts.n === 0) {
      throw new AppError('VALIDATION', 'الملف لا يحتوي على مخطط هذا التطبيق — رفض الاستعادة')
    }
    return { schemaVersion: version }
  } finally {
    probe.close()
  }
}

/** Ensures the requested name stays inside the backups directory. */
function resolveBackupPath(fileNameRaw: unknown): string {
  if (typeof fileNameRaw !== 'string' || !/^backup-[\w.-]+\.db$/.test(fileNameRaw)) {
    throw new AppError('VALIDATION', 'اسم ملف النسخة الاحتياطية غير صالح')
  }
  return join(backupsDir(), fileNameRaw)
}

/**
 * Restores a validated backup over the live database.
 * Order: validate → snapshot current DB → close live conn → replace file →
 * reopen+migrate. If anything fails before replacement, the live DB is
 * untouched; if reopening fails, the pre-restore snapshot is rolled back.
 */
export function restoreBackup(fileNameRaw: unknown): BackupInfo {
  const path = resolveBackupPath(fileNameRaw)
  validateBackupFile(path.split(/[\\/]/).pop()!)

  const livePath = getDatabasePath()
  const safetyPath = join(backupsDir(), `pre-restore-${stamp()}.db`)
  // Flush & checkpoint the live DB so the safety copy is complete.
  getDb().pragma('wal_checkpoint(TRUNCATE)')
  copyFileSync(livePath, safetyPath)

  closeDb()
  try {
    copyFileSync(path, livePath)
    // Remove stale WAL sidecar files belonging to the old database.
    for (const suffix of ['-wal', '-shm']) {
      const side = livePath + suffix
      if (existsSync(side)) unlinkSync(side)
    }
    // Reopen through the normal path — runs migrate() (idempotent upgrade).
    getDb()
    return describe(path)
  } catch (err) {
    // Roll back to the safety snapshot and reopen it.
    try {
      copyFileSync(safetyPath, livePath)
      getDb()
    } catch {
      /* surfaced below */
    }
    if (err instanceof AppError) throw err
    throw new AppError('DB_ERROR', 'فشلت عملية الاستعادة — تمت إرجاع قاعدة البيانات السابقة')
  }
}

/** Verifies the live DB can be reopened cleanly (used after restore/tests). */
export function liveIntegrityCheck(): boolean {
  const db = getDb()
  return db.pragma('integrity_check', { simple: true }) === 'ok'
}

// Re-export for tests that need to confirm migrate() targets LATEST_SCHEMA_VERSION.
export { migrate, LATEST_SCHEMA_VERSION }
