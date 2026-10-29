import { Router } from 'express';
import { z } from 'zod';
import { getPool, sql } from '../db/pool.js';
import { requireRole } from '../middleware/auth.js';
import { assertCanManage } from '../middleware/scope.js';
import { auditRequest } from '../services/audit.js';
import { SUPPORTED_EXTENSIONS } from '../services/files.js';
import { getAppSettings, saveAppSettings } from '../services/settings.js';

// ---------- Application settings ----------

export const settingsRouter = Router();

// Every signed-in user may read the settings (the app name, colour and upload rules shape the screens).
settingsRouter.get('/', async (_req, res) => {
  res.json({ settings: await getAppSettings(), supportedFileTypes: SUPPORTED_EXTENSIONS });
});

settingsRouter.put('/', requireRole('MasterAdmin'), async (req, res) => {
  const body = z
    .object({
      appName: z.string().trim().min(2, 'Enter the application name.').max(100),
      brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a colour like #4f46e5.'),
      allowSelfSignup: z.boolean(),
      allowedFileTypes: z
        .array(z.enum(SUPPORTED_EXTENSIONS as [string, ...string[]]))
        .min(1, 'Allow at least one file type.'),
      maxUploadMb: z.number().int().min(1, 'At least 1 MB.').max(500, 'At most 500 MB.'),
      defaultExportFormat: z.enum(['pdf', 'png', 'jpeg']),
      auditRetentionDays: z.number().int().min(30, 'Keep the audit log for at least 30 days.').max(3650),
    })
    .parse(req.body);
  await saveAppSettings(body);
  await auditRequest(req, 'SETTINGS_UPDATED', 'Settings', 'app', body, null);
  res.status(204).end();
});

// ---------- Activity (audit log) ----------

export const activityRouter = Router();

const ACTIVITY_COLUMNS = `
  l.Id AS id, l.Action AS action, l.EntityType AS entityType, l.EntityId AS entityId, l.Details AS details,
  l.IpAddress AS ipAddress, l.CreatedAt AS createdAt, u.FullName AS userName, u.Username AS username,
  a.Name AS accountName,
  CASE WHEN l.EntityType = N'Document' THEN (SELECT d.Name FROM dbo.Documents d WHERE d.Id = TRY_CAST(l.EntityId AS INT)) END AS documentName
`;

// Full audit log, for administrators. Filter by user, action or date.
activityRouter.get('/', async (req, res) => {
  assertCanManage(req);
  const query = z
    .object({
      userId: z.coerce.number().int().positive().optional(),
      action: z.string().trim().max(100).optional(),
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    })
    .parse(req.query);
  const pool = await getPool();
  const where = `
    WHERE (@accountId IS NULL OR l.AccountId = @accountId)
      AND (@userId IS NULL OR l.UserId = @userId)
      AND (@action IS NULL OR l.Action LIKE @action)
      AND (@from IS NULL OR l.CreatedAt >= @from)
      AND (@to IS NULL OR l.CreatedAt < DATEADD(DAY, 1, @to))
  `;
  const result = await pool
    .request()
    .input('accountId', sql.Int, req.scope!.accountId)
    .input('userId', sql.Int, query.userId ?? null)
    .input('action', sql.NVarChar(102), query.action ? `%${query.action}%` : null)
    .input('from', sql.Date, query.from ?? null)
    .input('to', sql.Date, query.to ?? null)
    .input('offset', sql.Int, (query.page - 1) * query.pageSize)
    .input('pageSize', sql.Int, query.pageSize)
    .query(`
      SELECT COUNT(*) AS total FROM dbo.AuditLogs l ${where};
      SELECT ${ACTIVITY_COLUMNS}
      FROM dbo.AuditLogs l LEFT JOIN dbo.Users u ON u.Id = l.UserId LEFT JOIN dbo.Accounts a ON a.Id = l.AccountId
      ${where}
      ORDER BY l.CreatedAt DESC, l.Id DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
    `);
  const sets = result.recordsets as unknown as [{ total: number }[], Record<string, unknown>[]];
  res.json({ total: sets[0][0].total, page: query.page, pageSize: query.pageSize, activity: sets[1] });
});

// Short list for the notification bell. Everyone sees document and template activity in their office;
// sign-in events are left out, because they are noise for most people.
activityRouter.get('/recent', async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('accountId', sql.Int, req.scope!.accountId)
    .query(`
      SELECT TOP 15 ${ACTIVITY_COLUMNS}
      FROM dbo.AuditLogs l LEFT JOIN dbo.Users u ON u.Id = l.UserId LEFT JOIN dbo.Accounts a ON a.Id = l.AccountId
      WHERE (@accountId IS NULL OR l.AccountId = @accountId) AND l.Action NOT LIKE N'LOGIN%'
      ORDER BY l.CreatedAt DESC, l.Id DESC
    `);
  res.json({ activity: result.recordset });
});

// ---------- Dashboard ----------

export const dashboardRouter = Router();

// Every number here is counted live in SQL Server and limited to the caller's office.
dashboardRouter.get('/', async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('accountId', sql.Int, req.scope!.accountId)
    .query(`
      DECLARE @monthStart DATE = DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1);

      SELECT
        (SELECT COUNT(*) FROM dbo.Documents WHERE DeletedAt IS NULL AND (@accountId IS NULL OR AccountId = @accountId)) AS documents,
        (SELECT COUNT(*) FROM dbo.Documents WHERE DeletedAt IS NULL AND IsArchived = 1 AND (@accountId IS NULL OR AccountId = @accountId)) AS archivedDocuments,
        (SELECT COUNT(*) FROM dbo.Templates WHERE (@accountId IS NULL OR AccountId = @accountId)) AS templates,
        (SELECT COUNT(*) FROM dbo.Templates WHERE Status = N'Published' AND (@accountId IS NULL OR AccountId = @accountId)) AS publishedTemplates,
        (SELECT COUNT(*) FROM dbo.DocumentCategories WHERE IsActive = 1 AND (@accountId IS NULL OR AccountId = @accountId)) AS categories,
        (SELECT COUNT(*) FROM dbo.Users WHERE IsActive = 1 AND (@accountId IS NULL OR AccountId = @accountId)) AS users,
        (SELECT COUNT(*) FROM dbo.Documents WHERE DeletedAt IS NULL AND CreatedAt >= @monthStart AND (@accountId IS NULL OR AccountId = @accountId)) AS createdThisMonth,
        (SELECT COUNT(*) FROM dbo.AuditLogs WHERE Action = N'DOCUMENT_DOWNLOADED' AND CreatedAt >= DATEADD(DAY, -30, SYSUTCDATETIME()) AND (@accountId IS NULL OR AccountId = @accountId)) AS downloads30d,
        CAST(ISNULL((SELECT SUM(SizeBytes) FROM dbo.StoredFiles WHERE (@accountId IS NULL OR AccountId = @accountId)), 0) AS BIGINT) AS storageUsedBytes,
        CAST(ISNULL((SELECT SUM(StorageLimitBytes) FROM dbo.Accounts WHERE (@accountId IS NULL OR Id = @accountId)), 0) AS BIGINT) AS storageLimitBytes;

      SELECT ISNULL(c.Name, N'Uncategorised') AS name, COUNT(*) AS total
      FROM dbo.Documents d LEFT JOIN dbo.DocumentCategories c ON c.Id = d.CategoryId
      WHERE d.DeletedAt IS NULL AND (@accountId IS NULL OR d.AccountId = @accountId)
      GROUP BY ISNULL(c.Name, N'Uncategorised')
      ORDER BY total DESC;

      SELECT FORMAT(DATEFROMPARTS(YEAR(CreatedAt), MONTH(CreatedAt), 1), 'yyyy-MM') AS month, COUNT(*) AS total
      FROM dbo.Documents
      WHERE DeletedAt IS NULL AND CreatedAt >= DATEADD(MONTH, -11, @monthStart) AND (@accountId IS NULL OR AccountId = @accountId)
      GROUP BY DATEFROMPARTS(YEAR(CreatedAt), MONTH(CreatedAt), 1);

      SELECT TOP 8 d.Id AS id, d.Name AS name, d.Status AS status, d.SourceType AS sourceType, c.Name AS categoryName,
             d.UpdatedAt AS updatedAt, u.FullName AS updatedByName
      FROM dbo.Documents d LEFT JOIN dbo.DocumentCategories c ON c.Id = d.CategoryId
      LEFT JOIN dbo.Users u ON u.Id = COALESCE(d.UpdatedById, d.CreatedById)
      WHERE d.DeletedAt IS NULL AND d.IsArchived = 0 AND (@accountId IS NULL OR d.AccountId = @accountId)
      ORDER BY d.UpdatedAt DESC;

      SELECT TOP 8 d.Id AS id, d.Name AS name, d.Status AS status, d.SourceType AS sourceType, c.Name AS categoryName,
             d.LastOpenedAt AS lastOpenedAt
      FROM dbo.Documents d LEFT JOIN dbo.DocumentCategories c ON c.Id = d.CategoryId
      WHERE d.DeletedAt IS NULL AND d.LastOpenedAt IS NOT NULL AND (@accountId IS NULL OR d.AccountId = @accountId)
      ORDER BY d.LastOpenedAt DESC;

      SELECT TOP 10 ${ACTIVITY_COLUMNS}
      FROM dbo.AuditLogs l LEFT JOIN dbo.Users u ON u.Id = l.UserId LEFT JOIN dbo.Accounts a ON a.Id = l.AccountId
      WHERE (@accountId IS NULL OR l.AccountId = @accountId) AND l.Action NOT LIKE N'LOGIN%'
      ORDER BY l.CreatedAt DESC, l.Id DESC;
    `);
  const [totalsSet, byCategory, monthlyRows, recentlyEdited, recentlyOpened, recentActivity] =
    result.recordsets as unknown as Record<string, unknown>[][];
  const totals = totalsSet[0] as Record<string, unknown>;

  // Fill in months with no documents, so the chart always shows the last 12 months.
  const counts = new Map(monthlyRows.map((r) => [r.month as string, r.total as number]));
  const monthly: { month: string; total: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    monthly.push({ month: key, total: counts.get(key) ?? 0 });
  }

  res.json({
    totals: { ...totals, storageUsedBytes: Number(totals.storageUsedBytes), storageLimitBytes: Number(totals.storageLimitBytes) },
    byCategory,
    monthly,
    recentlyEdited,
    recentlyOpened,
    recentActivity,
  });
});
