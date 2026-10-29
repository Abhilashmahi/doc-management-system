import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { assertCanEdit, idParam, requireAccountId } from '../middleware/scope.js';
import { auditRequest } from '../services/audit.js';
import { receiveUpload, sendStoredFile, storeFile } from '../services/files.js';

// Images used inside designs (logos, photos, seals). They are served only to users of the same office.
export const filesRouter = Router();

filesRouter.post('/assets', async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const file = await receiveUpload(req, res);
  const stored = await storeFile(file, { accountId, userId: req.user!.userId, purpose: 'asset' });
  await auditRequest(req, 'ASSET_UPLOADED', 'File', stored.id, { name: stored.originalName });
  res.status(201).json({ file: stored });
});

// The office's uploaded images, newest first, for the designer's Uploads panel.
filesRouter.get('/assets', async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('accountId', sql.Int, req.scope!.accountId)
    .query(`
      SELECT TOP 200 Id AS id, OriginalName AS originalName, MimeType AS mimeType, SizeBytes AS sizeBytes, CreatedAt AS createdAt
      FROM dbo.StoredFiles
      WHERE Purpose = N'asset' AND (@accountId IS NULL OR AccountId = @accountId)
      ORDER BY CreatedAt DESC
    `);
  res.json({ files: result.recordset });
});

filesRouter.get('/:id', async (req, res) => {
  await sendStoredFile(res, idParam(req), req.scope!.accountId, { inline: true });
});
