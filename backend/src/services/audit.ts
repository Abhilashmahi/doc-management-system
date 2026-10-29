import type { Request } from 'express';
import { getPool, sql } from '../db/pool.js';

export interface AuditEntry {
  accountId?: number | null;
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

// Writes one audit row. Callers must never put passwords or tokens into details.
export async function writeAudit(entry: AuditEntry): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('accountId', sql.Int, entry.accountId ?? null)
    .input('userId', sql.Int, entry.userId ?? null)
    .input('action', sql.NVarChar(100), entry.action)
    .input('entityType', sql.NVarChar(60), entry.entityType ?? null)
    .input('entityId', sql.NVarChar(60), entry.entityId ?? null)
    .input('details', sql.NVarChar(sql.MAX), entry.details ? JSON.stringify(entry.details) : null)
    .input('ipAddress', sql.NVarChar(64), entry.ipAddress ?? null)
    .query(`
      INSERT INTO dbo.AuditLogs (AccountId, UserId, Action, EntityType, EntityId, Details, IpAddress)
      VALUES (@accountId, @userId, @action, @entityType, @entityId, @details, @ipAddress)
    `);
}

// Shortcut for routes: fills in the user, office and network address from the request.
export async function auditRequest(
  req: Request,
  action: string,
  entityType: string,
  entityId: number | string,
  details?: Record<string, unknown>,
  accountId: number | null = req.scope?.accountId ?? req.user?.accountId ?? null,
): Promise<void> {
  await writeAudit({
    accountId,
    userId: req.user?.userId ?? null,
    action,
    entityType,
    entityId: String(entityId),
    details,
    ipAddress: req.ip ?? null,
  });
}
