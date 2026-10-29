import { Router, type Request } from 'express';
import { z } from 'zod';
import { getPool, sql } from '../db/pool.js';
import { assertCanManage, idParam } from '../middleware/scope.js';
import { isDuplicateKeyError } from '../services/accounts.js';
import { auditRequest } from '../services/audit.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';
import { HttpError } from '../utils/http-error.js';

// User management. Office Admins manage the users of their own office. The Master Admin manages everyone.
export const usersRouter = Router();

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters long.')
  .max(256)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters long.')
  .max(50, 'Username can be at most 50 characters long.')
  .regex(/^[A-Za-z0-9._@-]+$/, 'Username can use only letters, numbers, dots, underscores, hyphens and @.')
  .transform((u) => u.toLowerCase());

const emailSchema = z
  .union([z.literal(''), z.email('Enter a valid email address.')])
  .optional()
  .transform((e) => (e ? e.toLowerCase() : null));

const roles = ['MasterAdmin', 'Admin', 'Editor', 'Viewer'] as const;
type Role = (typeof roles)[number];

interface UserRow {
  id: number;
  accountId: number | null;
  accountName: string | null;
  username: string;
  email: string | null;
  fullName: string;
  role: Role;
  isActive: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  hasPassword: boolean;
  hasGoogle: boolean;
}

const USER_COLUMNS = `
  u.Id AS id, u.AccountId AS accountId, a.Name AS accountName, u.Username AS username, u.Email AS email,
  u.FullName AS fullName, u.Role AS role, u.IsActive AS isActive, u.LockedUntil AS lockedUntil,
  u.LastLoginAt AS lastLoginAt, u.CreatedAt AS createdAt,
  CAST(CASE WHEN u.PasswordHash IS NULL THEN 0 ELSE 1 END AS BIT) AS hasPassword,
  CAST(CASE WHEN u.GoogleSubject IS NULL THEN 0 ELSE 1 END AS BIT) AS hasGoogle
`;

// Loads a user the caller is allowed to manage. Office Admins cannot touch the Master Admin or other offices.
async function loadManagedUser(req: Request, id: number): Promise<UserRow> {
  const pool = await getPool();
  const me = req.user!;
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .input('accountId', sql.Int, req.scope!.accountId)
    .query<UserRow>(`
      SELECT ${USER_COLUMNS} FROM dbo.Users u LEFT JOIN dbo.Accounts a ON a.Id = u.AccountId
      WHERE u.Id = @id AND (@accountId IS NULL OR u.AccountId = @accountId)
    `);
  const user = result.recordset[0];
  if (!user) throw new HttpError(404, 'User not found.');
  if (me.role !== 'MasterAdmin' && (user.role === 'MasterAdmin' || user.accountId !== me.accountId)) {
    throw new HttpError(404, 'User not found.');
  }
  return user;
}

async function revokeAllSessions(userId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, userId)
    .query('UPDATE dbo.Sessions SET RevokedAt = SYSUTCDATETIME() WHERE UserId = @id AND RevokedAt IS NULL');
}

usersRouter.get('/', async (req, res) => {
  assertCanManage(req);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('accountId', sql.Int, req.scope!.accountId)
    .input('isMaster', sql.Bit, req.user!.role === 'MasterAdmin')
    .query<UserRow>(`
      SELECT ${USER_COLUMNS} FROM dbo.Users u LEFT JOIN dbo.Accounts a ON a.Id = u.AccountId
      WHERE (@accountId IS NULL OR u.AccountId = @accountId OR (@isMaster = 1 AND u.AccountId IS NULL))
        AND (@isMaster = 1 OR u.Role <> N'MasterAdmin')
      ORDER BY u.FullName
    `);
  res.json({ users: result.recordset });
});

usersRouter.post('/', async (req, res) => {
  assertCanManage(req);
  const me = req.user!;
  const body = z
    .object({
      fullName: z.string().trim().min(2, 'Enter the full name.').max(150),
      username: usernameSchema,
      email: emailSchema,
      password: passwordSchema,
      role: z.enum(roles),
      accountId: z.number().int().positive().nullable().optional(),
    })
    .parse(req.body);

  let accountId: number | null;
  if (body.role === 'MasterAdmin') {
    if (me.role !== 'MasterAdmin') throw new HttpError(403, 'Only the Master Admin can create another Master Admin.');
    accountId = null;
  } else if (me.role === 'MasterAdmin') {
    accountId = body.accountId ?? req.scope!.accountId;
    if (!accountId) throw new HttpError(400, 'Choose the office this user belongs to.');
  } else {
    accountId = me.accountId;
  }

  const pool = await getPool();
  if (accountId) {
    const found = await pool.request().input('id', sql.Int, accountId).query('SELECT 1 AS ok FROM dbo.Accounts WHERE Id = @id');
    if (found.recordset.length === 0) throw new HttpError(400, 'The chosen office does not exist.');
  }
  const passwordHash = await hashPassword(body.password);
  try {
    const inserted = await pool
      .request()
      .input('accountId', sql.Int, accountId)
      .input('username', sql.NVarChar(256), body.username)
      .input('email', sql.NVarChar(256), body.email)
      .input('fullName', sql.NVarChar(150), body.fullName)
      .input('hash', sql.NVarChar(512), passwordHash)
      .input('role', sql.NVarChar(20), body.role)
      .query<{ id: number }>(`
        INSERT INTO dbo.Users (AccountId, Username, Email, FullName, PasswordHash, Role)
        OUTPUT INSERTED.Id AS id
        VALUES (@accountId, @username, @email, @fullName, @hash, @role)
      `);
    const id = inserted.recordset[0].id;
    await auditRequest(req, 'USER_CREATED', 'User', id, { username: body.username, role: body.role }, accountId);
    res.status(201).json({ id });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new HttpError(409, 'That username or email is already used by another user.');
    throw error;
  }
});

usersRouter.put('/:id', async (req, res) => {
  assertCanManage(req);
  const me = req.user!;
  const user = await loadManagedUser(req, idParam(req));
  const body = z
    .object({
      fullName: z.string().trim().min(2, 'Enter the full name.').max(150),
      email: emailSchema,
      role: z.enum(roles),
    })
    .parse(req.body);

  if (user.id === me.userId && body.role !== user.role) throw new HttpError(400, 'You cannot change your own role.');
  if ((body.role === 'MasterAdmin') !== (user.role === 'MasterAdmin')) {
    throw new HttpError(400, 'The Master Admin role cannot be given to or removed from an existing user. Create a new user instead.');
  }

  const pool = await getPool();
  try {
    await pool
      .request()
      .input('id', sql.Int, user.id)
      .input('fullName', sql.NVarChar(150), body.fullName)
      .input('email', sql.NVarChar(256), body.email)
      .input('role', sql.NVarChar(20), body.role)
      .query('UPDATE dbo.Users SET FullName = @fullName, Email = @email, Role = @role, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id');
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new HttpError(409, 'That email is already used by another user.');
    throw error;
  }
  // A role change takes effect at once: the user signs in again with the new role.
  if (body.role !== user.role) await revokeAllSessions(user.id);
  await auditRequest(req, 'USER_UPDATED', 'User', user.id, { role: body.role, previousRole: user.role }, user.accountId);
  res.status(204).end();
});

usersRouter.post('/:id/status', async (req, res) => {
  assertCanManage(req);
  const user = await loadManagedUser(req, idParam(req));
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  if (user.id === req.user!.userId) throw new HttpError(400, 'You cannot deactivate your own user.');
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, user.id)
    .input('active', sql.Bit, isActive)
    .query('UPDATE dbo.Users SET IsActive = @active, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id');
  if (!isActive) await revokeAllSessions(user.id);
  await auditRequest(req, isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'User', user.id, { username: user.username }, user.accountId);
  res.status(204).end();
});

// An administrator sets a new temporary password. It signs the user out everywhere and clears any lockout.
usersRouter.post('/:id/password', async (req, res) => {
  assertCanManage(req);
  const user = await loadManagedUser(req, idParam(req));
  const { password } = z.object({ password: passwordSchema }).parse(req.body);
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, user.id)
    .input('hash', sql.NVarChar(512), await hashPassword(password))
    .query(`
      UPDATE dbo.Users SET PasswordHash = @hash, FailedLoginCount = 0, LockedUntil = NULL, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @id
    `);
  await revokeAllSessions(user.id);
  await auditRequest(req, 'USER_PASSWORD_RESET', 'User', user.id, { username: user.username }, user.accountId);
  res.status(204).end();
});

usersRouter.post('/:id/unlock', async (req, res) => {
  assertCanManage(req);
  const user = await loadManagedUser(req, idParam(req));
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, user.id)
    .query('UPDATE dbo.Users SET FailedLoginCount = 0, LockedUntil = NULL WHERE Id = @id');
  await auditRequest(req, 'USER_UNLOCKED', 'User', user.id, { username: user.username }, user.accountId);
  res.status(204).end();
});

// ---------- The signed-in user's own profile ----------

export const profileRouter = Router();

profileRouter.post('/password', async (req, res) => {
  const body = z
    .object({ currentPassword: z.string().max(256), newPassword: passwordSchema })
    .parse(req.body);
  const pool = await getPool();
  const found = await pool
    .request()
    .input('id', sql.Int, req.user!.userId)
    .query<{ hash: string | null }>('SELECT PasswordHash AS hash FROM dbo.Users WHERE Id = @id');
  const hash = found.recordset[0]?.hash ?? null;
  // Google-only users have no password yet; they may set one without a current password.
  if (hash && !(await verifyPassword(hash, body.currentPassword))) {
    throw new HttpError(400, 'Your current password is not correct.', [{ field: 'currentPassword', message: 'Your current password is not correct.' }]);
  }
  await pool
    .request()
    .input('id', sql.Int, req.user!.userId)
    .input('hash', sql.NVarChar(512), await hashPassword(body.newPassword))
    .input('sessionId', sql.NVarChar(36), req.user!.sessionId)
    .query(`
      UPDATE dbo.Users SET PasswordHash = @hash, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id;
      UPDATE dbo.Sessions SET RevokedAt = SYSUTCDATETIME()
      WHERE UserId = @id AND RevokedAt IS NULL AND CAST(Id AS NVARCHAR(36)) <> @sessionId;
    `);
  await auditRequest(req, 'PASSWORD_CHANGED', 'User', req.user!.userId, undefined, req.user!.accountId);
  res.status(204).end();
});
