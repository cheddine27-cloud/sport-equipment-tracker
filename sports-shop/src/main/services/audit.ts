import type Database from 'better-sqlite3'

/** Append-only audit trail for important business actions. */
export function logAudit(
  db: Database.Database,
  action: string,
  entity: string,
  entityId: number | null,
  details?: string | null
): void {
  db.prepare('INSERT INTO audit_log (action, entity, entity_id, details) VALUES (?, ?, ?, ?)').run(
    action,
    entity,
    entityId,
    details ?? null
  )
}

export function recentAuditEntries(db: Database.Database, limit = 200): Array<{
  id: number
  action: string
  entity: string
  entityId: number | null
  details: string | null
  createdAt: string
}> {
  const rows = db
    .prepare(
      'SELECT id, action, entity, entity_id, details, created_at FROM audit_log ORDER BY id DESC LIMIT ?'
    )
    .all(limit) as Array<{
    id: number
    action: string
    entity: string
    entity_id: number | null
    details: string | null
    created_at: string
  }>
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    details: r.details,
    createdAt: r.created_at
  }))
}
