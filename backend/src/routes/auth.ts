import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { getPool, sql } from '../db/pool.js';
import { requireAuth, SESSION_COOKIE, setSessionCookie } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';
import { createSession, revokeSession } from '../services/sessions.js';
import { HttpError } from '../utils/http-error.js';

export const authRouter = Router();

// Limits login attempts per IP address. This is the first line of defence against password guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts from this network. Please wait 15 minutes and try again.' },
});

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username.').max(256),
  password: z.string().min(1, 'Enter your password.').max(256),
});

// Used when the username is unknown, so the reply takes about as long as a real check.
// This stops attackers from finding valid usernames by measuring response times.
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword('dummy-password-for-timing-only');
  return dummyHash;
}

interface LoginUserRow {
  Id: number;
  AccountId: number | null;
  PasswordHash: string | null; // null for accounts created with Google
  IsActive: boolean;
  FailedLoginCount: number;
  LockedUntil: Date | null;
  AccountActive: boolean | null;
}

authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const username = body.username.trim().toLowerCase();
    const ip = req.ip ?? null;
    const pool = await getPool();

    const found = await pool
      .request()
      .input('username', sql.NVarChar(256), username)
      .query<LoginUserRow>(`
        SELECT u.Id, u.AccountId, u.PasswordHash, u.IsActive, u.FailedLoginCount, u.LockedUntil,
               a.IsActive AS AccountActive
        FROM dbo.Users u
        LEFT JOIN dbo.Accounts a ON a.Id = u.AccountId
        WHERE u.Username = @username
      `);
    const user = found.recordset[0];

    // Same generic message for an unknown username and a wrong password, so attackers cannot tell which usernames exist.
    const invalid = new HttpError(401, 'Invalid username or password.');

    if (!user) {
      await verifyPassword(await getDummyHash(), body.password);
      throw invalid;
    }

    if (user.LockedUntil && user.LockedUntil.getTime() > Date.now()) {
      await writeAudit({ userId: user.Id, accountId: user.AccountId, action: 'LOGIN_LOCKED', ipAddress: ip });
      throw new HttpError(423, 'This account is temporarily locked after too many failed attempts. Try again later.');
    }
    if (!user.IsActive || user.AccountActive === false) {
      throw new HttpError(403, 'This account is deactivated. Please contact your administrator.');
    }

    // Accounts created with Google have no password. They still run the check, so the reply takes the same time.
    const passwordOk = await verifyPassword(user.PasswordHash ?? (await getDummyHash()), body.password);
    const ok = user.PasswordHash !== null && passwordOk;
    if (!ok) {
      const newCount = user.FailedLoginCount + 1;
      const lockNow = newCount >= env.LOGIN_MAX_FAILED_ATTEMPTS;
      await pool
        .request()
        .input('id', sql.Int, user.Id)
        .input('count', sql.Int, newCount)
        .input('lockMinutes', sql.Int, env.LOGIN_LOCKOUT_MINUTES)
        .input('lock', sql.Bit, lockNow)
        .query(`
          UPDATE dbo.Users
          SET FailedLoginCount = CASE WHEN @lock = 1 THEN 0 ELSE @count END,
              LockedUntil = CASE WHEN @lock = 1 THEN DATEADD(MINUTE, @lockMinutes, SYSUTCDATETIME()) ELSE LockedUntil END
          WHERE Id = @id
        `);
      await writeAudit({ userId: user.Id, accountId: user.AccountId, action: 'LOGIN_FAILED', ipAddress: ip });
      throw invalid;
    }

    await pool
      .request()
      .input('id', sql.Int, user.Id)
      .query('UPDATE dbo.Users SET FailedLoginCount = 0, LockedUntil = NULL, LastLoginAt = SYSUTCDATETIME() WHERE Id = @id');

    const session = await createSession(user.Id, ip, req.get('user-agent') ?? null);
    setSessionCookie(res, session.token, session.expiresAt);
    await writeAudit({ userId: user.Id, accountId: user.AccountId, action: 'LOGIN_SUCCESS', ipAddress: ip });

    const me = await pool
      .request()
      .input('id', sql.Int, user.Id)
      .query(`
        SELECT u.Id AS id, u.Username AS username, u.FullName AS fullName, u.Role AS role,
               u.AccountId AS accountId, a.Name AS accountName
        FROM dbo.Users u LEFT JOIN dbo.Accounts a ON a.Id = u.AccountId
        WHERE u.Id = @id
      `);
    res.json({ user: me.recordset[0] });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') await revokeSession(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const u = req.user!;
  let accountName: string | null = null;
  if (u.accountId !== null) {
    const pool = await getPool();
    const found = await pool.request().input('id', sql.Int, u.accountId).query<{ name: string }>('SELECT Name AS name FROM dbo.Accounts WHERE Id = @id');
    accountName = found.recordset[0]?.name ?? null;
  }
  res.json({
    user: { id: u.userId, username: u.username, fullName: u.fullName, role: u.role, accountId: u.accountId, accountName },
  });
});
