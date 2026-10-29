import { Router } from 'express';
import { z } from 'zod';
import { getPool, sql } from '../db/pool.js';
import { requireRole } from '../middleware/auth.js';
import { idParam } from '../middleware/scope.js';
import { createAccountWithAdmin } from '../services/accounts.js';
import { auditRequest } from '../services/audit.js';
import { hashPassword } from '../services/passwords.js';
import { HttpError } from '../utils/http-error.js';
import { passwordSchema } from './users.js';

// Offices (accounts). Only the Master Admin can see and change them.
export const accountsRouter = Router();
accountsRouter.use(requireRole('MasterAdmin'));

const MB = 1024 * 1024;

accountsRouter.get('/', async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT a.Id AS id, a.Name AS name, a.IsActive AS isActive, a.StorageLimitBytes AS storageLimitBytes,
           a.CreatedAt AS createdAt,
           (SELECT COUNT(*) FROM dbo.Users u WHERE u.AccountId = a.Id) AS userCount,
           (SELECT COUNT(*) FROM dbo.Documents d WHERE d.AccountId = a.Id AND d.DeletedAt IS NULL) AS documentCount,
           (SELECT COUNT(*) FROM dbo.Templates t WHERE t.AccountId = a.Id) AS templateCount,
           CAST(ISNULL((SELECT SUM(f.SizeBytes) FROM dbo.StoredFiles f WHERE f.AccountId = a.Id), 0) AS BIGINT) AS storageUsedBytes,
           (SELECT MAX(l.CreatedAt) FROM dbo.AuditLogs l WHERE l.AccountId = a.Id) AS lastActivityAt
    FROM dbo.Accounts a
    ORDER BY a.Name
  `);
  // BIGINT values arrive as strings from the driver; turn them into numbers for the browser.
  res.json({
    accounts: result.recordset.map((a) => ({ ...a, storageLimitBytes: Number(a.storageLimitBytes), storageUsedBytes: Number(a.storageUsedBytes) })),
  });
});

// Creates an office together with its first Admin, who can then add the rest of the office's users.
accountsRouter.post('/', async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2, 'Enter the office name.').max(150),
      storageLimitMb: z.number().int().min(10).max(1024 * 1024).default(1024),
      admin: z.object({
        fullName: z.string().trim().min(2, 'Enter the admin\'s full name.').max(150),
        username: z
          .string()
          .trim()
          .min(3, 'Username must be at least 3 characters long.')
          .max(50)
          .regex(/^[A-Za-z0-9._@-]+$/, 'Username can use only letters, numbers, dots, underscores, hyphens and @.')
          .transform((u) => u.toLowerCase()),
        password: passwordSchema,
      }),
    })
    .parse(req.body);

  const { accountId, userId } = await createAccountWithAdmin({
    accountName: body.name,
    username: body.admin.username,
    email: null,
    fullName: body.admin.fullName,
    passwordHash: await hashPassword(body.admin.password),
    googleSubject: null,
  });
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, accountId)
    .input('limit', sql.BigInt, body.storageLimitMb * MB)
    .query('UPDATE dbo.Accounts SET StorageLimitBytes = @limit WHERE Id = @id');
  await auditRequest(req, 'ACCOUNT_CREATED', 'Account', accountId, { name: body.name, adminUserId: userId }, accountId);
  res.status(201).json({ id: accountId });
});

accountsRouter.put('/:id', async (req, res) => {
  const id = idParam(req);
  const body = z
    .object({
      name: z.string().trim().min(2, 'Enter the office name.').max(150),
      storageLimitMb: z.number().int().min(10).max(1024 * 1024),
      isActive: z.boolean(),
    })
    .parse(req.body);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar(150), body.name)
    .input('limit', sql.BigInt, body.storageLimitMb * MB)
    .input('active', sql.Bit, body.isActive)
    .query(`
      UPDATE dbo.Accounts SET Name = @name, StorageLimitBytes = @limit, IsActive = @active, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @id
    `);
  if (result.rowsAffected[0] === 0) throw new HttpError(404, 'Office not found.');
  // Deactivating an office signs out all of its users at once.
  if (!body.isActive) {
    await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        UPDATE s SET RevokedAt = SYSUTCDATETIME()
        FROM dbo.Sessions s JOIN dbo.Users u ON u.Id = s.UserId
        WHERE u.AccountId = @id AND s.RevokedAt IS NULL
      `);
  }
  await auditRequest(req, 'ACCOUNT_UPDATED', 'Account', id, body, id);
  res.status(204).end();
});
