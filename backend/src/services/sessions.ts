import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { getPool, sql } from '../db/pool.js';
import { hashToken } from '../utils/token-hash.js';

export async function createSession(
  userId: number,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
  const pool = await getPool();
  await pool
    .request()
    .input('userId', sql.Int, userId)
    .input('tokenHash', sql.Char(64), hashToken(token))
    .input('ipAddress', sql.NVarChar(64), ipAddress)
    .input('userAgent', sql.NVarChar(300), userAgent?.slice(0, 300) ?? null)
    .input('expiresAt', sql.DateTime2, expiresAt)
    .query(`
      INSERT INTO dbo.Sessions (UserId, TokenHash, IpAddress, UserAgent, ExpiresAt)
      VALUES (@userId, @tokenHash, @ipAddress, @userAgent, @expiresAt)
    `);
  return { token, expiresAt };
}

export interface SessionUser {
  userId: number;
  accountId: number | null;
  username: string;
  fullName: string;
  role: 'MasterAdmin' | 'Admin' | 'Editor' | 'Viewer';
  sessionId: string;
}

// Looks up the session on every request. Expired, revoked, or deactivated accounts are rejected here.
export async function findSessionUser(token: string): Promise<SessionUser | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('tokenHash', sql.Char(64), hashToken(token))
    .query<{
      userId: number;
      accountId: number | null;
      username: string;
      fullName: string;
      role: SessionUser['role'];
      sessionId: string;
    }>(`
      SELECT u.Id AS userId, u.AccountId AS accountId, u.Username AS username,
             u.FullName AS fullName, u.Role AS role, CAST(s.Id AS NVARCHAR(36)) AS sessionId
      FROM dbo.Sessions s
      JOIN dbo.Users u ON u.Id = s.UserId
      LEFT JOIN dbo.Accounts a ON a.Id = u.AccountId
      WHERE s.TokenHash = @tokenHash
        AND s.RevokedAt IS NULL
        AND s.ExpiresAt > SYSUTCDATETIME()
        AND u.IsActive = 1
        AND (u.AccountId IS NULL OR a.IsActive = 1)
    `);
  return result.recordset[0] ?? null;
}

export async function revokeSession(token: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('tokenHash', sql.Char(64), hashToken(token))
    .query('UPDATE dbo.Sessions SET RevokedAt = SYSUTCDATETIME() WHERE TokenHash = @tokenHash AND RevokedAt IS NULL');
}
