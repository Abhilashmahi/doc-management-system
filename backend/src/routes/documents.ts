import { Router, type Request } from 'express';
import { z } from 'zod';
import { getPool, sql } from '../db/pool.js';
import { assertCanEdit, assertCanManage, canManage, idParam, requireAccountId } from '../middleware/scope.js';
import { auditRequest } from '../services/audit.js';
import { canvasSchema, type CanvasDocument, type TemplateFields } from '../services/canvas.js';
import { validateDocumentData } from '../services/document-data.js';
import { purgeDocuments } from '../services/trash.js';
import { applyTextEdits, textEditSchema } from '../services/pdf-text-edit.js';
import { conversionOptions, convert } from '../services/convert/index.js';
import { extensionOf, readStoredFile, receiveUpload, sendStoredFile, storeFile, storeGeneratedFile } from '../services/files.js';
import { HttpError } from '../utils/http-error.js';
import { loadFields } from './masters.js';
import { checkReferences, loadTemplateVersion } from './templates.js';

// Documents come from two sources: filled-in templates, and uploaded files. Every change adds a version row,
// and uploaded originals are never overwritten. Deleting is a soft delete, so history stays for the audit trail.
export const documentsRouter = Router();

export const folderSchema = z
  .string()
  .trim()
  .max(400)
  .default('/')
  .transform((raw) => {
    const parts = raw.split(/[\\/]+/).map((p) => p.trim()).filter(Boolean);
    return '/' + parts.join('/');
  })
  .refine((path) => path.split('/').every((part) => part.length <= 60 && !/[<>:"|?*\x00-\x1f]/.test(part)), {
    message: 'Folder names cannot contain < > : " | ? * and can be at most 60 characters each.',
  });

const nameSchema = z.string().trim().min(1, 'Enter a document name.').max(200);

export interface DocumentRow {
  id: number;
  accountId: number;
  name: string;
  status: 'Draft' | 'Final' | 'Archived';
  sourceType: 'template' | 'upload';
  folderPath: string;
  categoryId: number | null;
  categoryName: string | null;
  templateId: number | null;
  templateName: string | null;
  templateVersionNo: number | null;
  currentVersionNo: number;
  isArchived: boolean;
  fileId: number | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt: Date | null;
  createdByName: string;
  updatedByName: string | null;
  deletedAt: Date | null;
  deletedByName: string | null;
}

// For uploads, the file shown is the one attached to the current version, so a newer upload replaces it on screen
// while the original stays in version 1.
const DOCUMENT_COLUMNS = `
  d.Id AS id, d.AccountId AS accountId, d.Name AS name, d.Status AS status, d.SourceType AS sourceType,
  d.FolderPath AS folderPath, d.CategoryId AS categoryId, c.Name AS categoryName, d.TemplateId AS templateId,
  t.Name AS templateName, d.TemplateVersionNo AS templateVersionNo, d.CurrentVersionNo AS currentVersionNo,
  d.IsArchived AS isArchived, f.Id AS fileId, f.OriginalName AS fileName, f.MimeType AS mimeType, f.SizeBytes AS sizeBytes,
  d.CreatedAt AS createdAt, d.UpdatedAt AS updatedAt, d.LastOpenedAt AS lastOpenedAt,
  cu.FullName AS createdByName, uu.FullName AS updatedByName, d.DeletedAt AS deletedAt, du.FullName AS deletedByName
`;

const DOCUMENT_JOINS = `
  FROM dbo.Documents d
  LEFT JOIN dbo.DocumentCategories c ON c.Id = d.CategoryId
  LEFT JOIN dbo.Templates t ON t.Id = d.TemplateId
  LEFT JOIN dbo.DocumentVersions cv ON cv.DocumentId = d.Id AND cv.VersionNo = d.CurrentVersionNo
  LEFT JOIN dbo.StoredFiles f ON f.Id = COALESCE(cv.FileId, d.FileId)
  JOIN dbo.Users cu ON cu.Id = d.CreatedById
  LEFT JOIN dbo.Users uu ON uu.Id = d.UpdatedById
  LEFT JOIN dbo.Users du ON du.Id = d.DeletedById
`;

export async function loadDocument(req: Request, id: number): Promise<DocumentRow> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .input('accountId', sql.Int, req.scope!.accountId)
    .query<DocumentRow>(`
      SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_JOINS}
      WHERE d.Id = @id AND d.DeletedAt IS NULL AND (@accountId IS NULL OR d.AccountId = @accountId)
    `);
  const row = result.recordset[0];
  if (!row) throw new HttpError(404, 'Document not found.');
  return row;
}

async function checkCategory(accountId: number, categoryId: number | null): Promise<void> {
  if (categoryId) await checkReferences(accountId, { categoryId });
}

// ---------- List and search ----------

documentsRouter.get('/', async (req, res) => {
  const query = z
    .object({
      q: z.string().trim().max(100).optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      status: z.enum(['Draft', 'Final']).optional(),
      sourceType: z.enum(['template', 'upload']).optional(),
      folder: z.string().max(400).optional(),
      archived: z.enum(['true', 'false']).default('false'),
      // 'trash' lists deleted documents; otherwise active or archived ones.
      view: z.enum(['active', 'archived', 'trash']).optional(),
      sort: z.enum(['updated', 'created', 'name', 'opened']).default('updated'),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(req.query);
  const orderBy = {
    updated: 'd.UpdatedAt DESC',
    created: 'd.CreatedAt DESC',
    name: 'd.Name ASC',
    opened: 'CASE WHEN d.LastOpenedAt IS NULL THEN 1 ELSE 0 END, d.LastOpenedAt DESC',
  }[query.sort];
  const folder = query.folder ? folderSchema.parse(query.folder) : null;

  const pool = await getPool();
  const request = pool
    .request()
    .input('accountId', sql.Int, req.scope!.accountId)
    .input('q', sql.NVarChar(102), query.q ? `%${query.q}%` : null)
    .input('categoryId', sql.Int, query.categoryId ?? null)
    .input('status', sql.NVarChar(20), query.status ?? null)
    .input('sourceType', sql.NVarChar(20), query.sourceType ?? null)
    .input('folder', sql.NVarChar(400), folder)
    .input('archived', sql.Bit, (query.view ?? (query.archived === 'true' ? 'archived' : 'active')) === 'archived')
    .input('trash', sql.Bit, query.view === 'trash')
    .input('offset', sql.Int, (query.page - 1) * query.pageSize)
    .input('pageSize', sql.Int, query.pageSize);
  const where = `
    WHERE ((@trash = 1 AND d.DeletedAt IS NOT NULL) OR (@trash = 0 AND d.DeletedAt IS NULL AND d.IsArchived = @archived))
      AND (@accountId IS NULL OR d.AccountId = @accountId)
      AND (@q IS NULL OR d.Name LIKE @q OR f.OriginalName LIKE @q)
      AND (@categoryId IS NULL OR d.CategoryId = @categoryId)
      AND (@status IS NULL OR d.Status = @status)
      AND (@sourceType IS NULL OR d.SourceType = @sourceType)
      AND (@folder IS NULL OR d.FolderPath = @folder OR d.FolderPath LIKE @folder + N'/%')
  `;
  const result = await request.query(`
    SELECT COUNT(*) AS total ${DOCUMENT_JOINS} ${where};
    SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_JOINS} ${where}
    ORDER BY ${query.view === 'trash' ? 'd.DeletedAt DESC' : orderBy}, d.Id DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `);
  const recordsets = result.recordsets as unknown as [{ total: number }[], DocumentRow[]];
  res.json({ total: recordsets[0][0].total, page: query.page, pageSize: query.pageSize, documents: recordsets[1] });
});

documentsRouter.get('/folders', async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('accountId', sql.Int, req.scope!.accountId)
    .query<{ folderPath: string; total: number }>(`
      SELECT FolderPath AS folderPath, COUNT(*) AS total FROM dbo.Documents
      WHERE DeletedAt IS NULL AND (@accountId IS NULL OR AccountId = @accountId)
      GROUP BY FolderPath ORDER BY FolderPath
    `);
  res.json({ folders: result.recordset });
});

// ---------- Create ----------

documentsRouter.post('/upload', async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const file = await receiveUpload(req, res);
  const body = z
    .object({
      name: z.string().trim().max(200).optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      folder: folderSchema,
    })
    .parse(req.body ?? {});
  await checkCategory(accountId, body.categoryId ?? null);
  const stored = await storeFile(file, { accountId, userId: req.user!.userId, purpose: 'document' });
  const name = body.name || stored.originalName.replace(/\.[^.]+$/, '') || stored.originalName;
  const id = await createFileDocument(req, accountId, stored.id, { name, categoryId: body.categoryId ?? null, folder: body.folder, note: 'Original upload' });
  await auditRequest(req, 'DOCUMENT_UPLOADED', 'Document', id, { name, file: stored.originalName, sizeBytes: stored.sizeBytes });
  res.status(201).json({ id });
});

// Creates a file-based document (and its version 1) around a file that is already stored.
export async function createFileDocument(
  req: Request,
  accountId: number,
  fileId: number,
  meta: { name: string; categoryId: number | null; folder: string; note: string },
): Promise<number> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const inserted = await transaction
      .request()
      .input('accountId', sql.Int, accountId)
      .input('categoryId', sql.Int, meta.categoryId)
      .input('name', sql.NVarChar(200), meta.name.slice(0, 200))
      .input('folder', sql.NVarChar(400), meta.folder)
      .input('fileId', sql.Int, fileId)
      .input('userId', sql.Int, req.user!.userId)
      .query<{ id: number }>(`
        INSERT INTO dbo.Documents (AccountId, CategoryId, Name, Status, SourceType, FolderPath, FileId, CreatedById, UpdatedById)
        OUTPUT INSERTED.Id AS id
        VALUES (@accountId, @categoryId, @name, N'Final', N'upload', @folder, @fileId, @userId, @userId)
      `);
    const id = inserted.recordset[0].id;
    await transaction
      .request()
      .input('id', sql.Int, id)
      .input('fileId', sql.Int, fileId)
      .input('note', sql.NVarChar(200), meta.note.slice(0, 200))
      .input('userId', sql.Int, req.user!.userId)
      .query(`
        INSERT INTO dbo.DocumentVersions (DocumentId, VersionNo, FileId, Note, CreatedById)
        VALUES (@id, 1, @fileId, @note, @userId)
      `);
    await transaction.commit();
    return id;
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

// ---------- Format conversion ----------

// The file of the document's current version (uploads only).
async function currentFile(doc: DocumentRow): Promise<{ fileId: number; ext: string }> {
  if (doc.sourceType !== 'upload' || !doc.fileId || !doc.fileName) {
    throw new HttpError(400, 'Designed documents are converted with Export (PDF, PNG or JPEG) on the document page.');
  }
  return { fileId: doc.fileId, ext: extensionOf(doc.fileName) };
}

// Which formats this document's file can be converted to, with an honest quality label for each.
documentsRouter.get('/:id/conversions', async (req, res) => {
  const doc = await loadDocument(req, idParam(req));
  if (doc.sourceType !== 'upload') {
    res.json({ from: null, options: [] });
    return;
  }
  const { ext } = await currentFile(doc);
  res.json({ from: ext, options: conversionOptions(ext) });
});

// Converts the current file into a new document next to the original. The original is never changed.
documentsRouter.post('/:id/convert', async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const doc = await loadDocument(req, idParam(req));
  const { to } = z.object({ to: z.string().min(2).max(10) }).parse(req.body);
  const { fileId, ext } = await currentFile(doc);

  const source = await readStoredFile(fileId, doc.accountId);
  const started = Date.now();
  const result = await convert(source.data, ext, to, doc.name);
  // "people" -> "people (XLSX)", and converting that again gives "people (PDF)" rather than "people (XLSX) (PDF)".
  const baseName = doc.name.replace(/\s\((?:PDF|PNG|JPEG|WEBP|DOCX|ODT|XLSX|ODS|PPTX|CSV|JSON|TXT|HTML)(?: pages| sheets)?\)$/, '');
  const tag = to.toUpperCase() + (result.ext === 'zip' ? (to === 'csv' ? ' sheets' : ' pages') : '');
  const name = `${baseName} (${tag})`;
  const stored = await storeGeneratedFile(result.data, `${baseName}.${result.ext}`, { accountId, userId: req.user!.userId });
  const id = await createFileDocument(req, accountId, stored.id, {
    name,
    categoryId: doc.categoryId,
    folder: doc.folderPath,
    note: `Converted from “${doc.name}” version ${doc.currentVersionNo} (.${ext})`,
  });
  await auditRequest(req, 'DOCUMENT_CONVERTED', 'Document', id, { from: doc.id, fromFormat: ext, toFormat: result.ext, ms: Date.now() - started });
  res.status(201).json({ id, name, ext: result.ext, sizeBytes: stored.sizeBytes });
});

// Loads the template version a document uses, together with the full field definitions for the form.
async function templateContext(accountId: number, templateId: number, versionNo: number) {
  const version = await loadTemplateVersion(templateId, versionNo);
  const definitions = (await loadFields(accountId, true)).filter((f) => version.fields.some((tf) => tf.fieldKey === f.fieldKey));
  return { ...version, definitions };
}

documentsRouter.post('/', async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const body = z
    .object({
      templateId: z.number().int().positive(),
      name: nameSchema,
      categoryId: z.number().int().positive().nullable().optional(),
      folder: folderSchema,
      data: z.record(z.string(), z.unknown()).default({}),
      status: z.enum(['Draft', 'Final']).default('Draft'),
    })
    .parse(req.body);

  const pool = await getPool();
  const found = await pool
    .request()
    .input('id', sql.Int, body.templateId)
    .input('accountId', sql.Int, accountId)
    .query<{ status: string; currentVersionNo: number; categoryId: number | null }>(`
      SELECT Status AS status, CurrentVersionNo AS currentVersionNo, CategoryId AS categoryId
      FROM dbo.Templates WHERE Id = @id AND AccountId = @accountId
    `);
  const template = found.recordset[0];
  if (!template || (template.status !== 'Published' && !canManage(req.user!))) throw new HttpError(404, 'Template not found.');
  if (template.status === 'Archived') throw new HttpError(400, 'This template is archived and cannot be used for new documents.');

  const ctx = await templateContext(accountId, body.templateId, template.currentVersionNo);
  const data = validateDocumentData(ctx.definitions, ctx.fields, body.data, { draft: body.status === 'Draft' });
  const categoryId = body.categoryId === undefined ? template.categoryId : body.categoryId;
  await checkCategory(accountId, categoryId);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let id: number;
  try {
    const inserted = await transaction
      .request()
      .input('accountId', sql.Int, accountId)
      .input('categoryId', sql.Int, categoryId)
      .input('templateId', sql.Int, body.templateId)
      .input('versionNo', sql.Int, template.currentVersionNo)
      .input('name', sql.NVarChar(200), body.name)
      .input('status', sql.NVarChar(20), body.status)
      .input('folder', sql.NVarChar(400), body.folder)
      .input('data', sql.NVarChar(sql.MAX), JSON.stringify(data))
      .input('userId', sql.Int, req.user!.userId)
      .query<{ id: number }>(`
        INSERT INTO dbo.Documents (AccountId, CategoryId, TemplateId, TemplateVersionNo, Name, Status, SourceType, FolderPath, DataJson, CreatedById, UpdatedById)
        OUTPUT INSERTED.Id AS id
        VALUES (@accountId, @categoryId, @templateId, @versionNo, @name, @status, N'template', @folder, @data, @userId, @userId)
      `);
    id = inserted.recordset[0].id;
    // The document keeps its own copy of the design, so later template edits never change an existing document.
    await transaction
      .request()
      .input('id', sql.Int, id)
      .input('data', sql.NVarChar(sql.MAX), JSON.stringify(data))
      .input('canvas', sql.NVarChar(sql.MAX), JSON.stringify(ctx.canvas))
      .input('userId', sql.Int, req.user!.userId)
      .query(`
        INSERT INTO dbo.DocumentVersions (DocumentId, VersionNo, DataJson, CanvasJson, Note, CreatedById)
        VALUES (@id, 1, @data, @canvas, N'Created from template', @userId)
      `);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  await auditRequest(req, 'DOCUMENT_CREATED', 'Document', id, { name: body.name, templateId: body.templateId });
  res.status(201).json({ id });
});

// ---------- Read ----------

documentsRouter.get('/:id', async (req, res) => {
  const doc = await loadDocument(req, idParam(req));
  const pool = await getPool();
  await pool.request().input('id', sql.Int, doc.id).query('UPDATE dbo.Documents SET LastOpenedAt = SYSUTCDATETIME() WHERE Id = @id');

  const versions = await pool
    .request()
    .input('id', sql.Int, doc.id)
    .query(`
      SELECT v.VersionNo AS versionNo, v.Note AS note, v.CreatedAt AS createdAt, u.FullName AS createdByName,
             f.Id AS fileId, f.OriginalName AS fileName, f.SizeBytes AS sizeBytes
      FROM dbo.DocumentVersions v
      JOIN dbo.Users u ON u.Id = v.CreatedById
      LEFT JOIN dbo.StoredFiles f ON f.Id = v.FileId
      WHERE v.DocumentId = @id ORDER BY v.VersionNo DESC
    `);

  let content: { data: Record<string, string>; canvas: CanvasDocument; fields: TemplateFields; definitions: unknown[] } | null = null;
  if (doc.sourceType === 'template' && doc.templateId && doc.templateVersionNo) {
    const current = await pool
      .request()
      .input('id', sql.Int, doc.id)
      .input('no', sql.Int, doc.currentVersionNo)
      .query<{ dataJson: string | null; canvasJson: string | null }>(
        'SELECT DataJson AS dataJson, CanvasJson AS canvasJson FROM dbo.DocumentVersions WHERE DocumentId = @id AND VersionNo = @no',
      );
    const ctx = await templateContext(doc.accountId, doc.templateId, doc.templateVersionNo);
    const row = current.recordset[0];
    content = {
      data: row?.dataJson ? JSON.parse(row.dataJson) : {},
      canvas: row?.canvasJson ? JSON.parse(row.canvasJson) : ctx.canvas,
      fields: ctx.fields,
      definitions: ctx.definitions,
    };
  }
  res.json({ document: doc, versions: versions.recordset, content });
});

documentsRouter.get('/:id/versions/:no', async (req, res) => {
  const doc = await loadDocument(req, idParam(req));
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, doc.id)
    .input('no', sql.Int, idParam(req, 'no'))
    .query<{ dataJson: string | null; canvasJson: string | null }>(
      'SELECT DataJson AS dataJson, CanvasJson AS canvasJson FROM dbo.DocumentVersions WHERE DocumentId = @id AND VersionNo = @no',
    );
  const row = result.recordset[0];
  if (!row) throw new HttpError(404, 'Version not found.');
  res.json({ data: row.dataJson ? JSON.parse(row.dataJson) : null, canvas: row.canvasJson ? JSON.parse(row.canvasJson) : null });
});

// Streams the document's file. ?version=N picks an older version; ?inline=1 shows it in the browser instead of downloading.
documentsRouter.get('/:id/file', async (req, res) => {
  const doc = await loadDocument(req, idParam(req));
  const versionNo = req.query.version ? Number(req.query.version) : doc.currentVersionNo;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, doc.id)
    .input('no', sql.Int, Number.isInteger(versionNo) ? versionNo : -1)
    .query<{ fileId: number | null }>('SELECT FileId AS fileId FROM dbo.DocumentVersions WHERE DocumentId = @id AND VersionNo = @no');
  const fileId = result.recordset[0]?.fileId ?? (versionNo === doc.currentVersionNo ? doc.fileId : null);
  if (!fileId) throw new HttpError(404, 'This version has no file. Use Export to download a designed document.');

  const inline = req.query.inline === '1';
  if (!inline) await auditRequest(req, 'DOCUMENT_DOWNLOADED', 'Document', doc.id, { versionNo }, doc.accountId);
  const ext = doc.fileName ? extensionOf(doc.fileName) : '';
  await sendStoredFile(res, fileId, doc.accountId, { inline, downloadName: ext ? `${doc.name}.${ext}` : undefined });
});

// The browser builds PDF/PNG/JPEG exports of designed documents. It reports each export here for the download statistics.
documentsRouter.post('/:id/exported', async (req, res) => {
  const doc = await loadDocument(req, idParam(req));
  const { format } = z.object({ format: z.enum(['pdf', 'png', 'jpeg']) }).parse(req.body);
  await auditRequest(req, 'DOCUMENT_DOWNLOADED', 'Document', doc.id, { format, versionNo: doc.currentVersionNo }, doc.accountId);
  res.status(204).end();
});

// ---------- Change ----------

documentsRouter.put('/:id', async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const doc = await loadDocument(req, idParam(req));
  const body = z
    .object({ name: nameSchema, categoryId: z.number().int().positive().nullable(), folder: folderSchema })
    .parse(req.body);
  await checkCategory(accountId, body.categoryId);
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, doc.id)
    .input('name', sql.NVarChar(200), body.name)
    .input('categoryId', sql.Int, body.categoryId)
    .input('folder', sql.NVarChar(400), body.folder)
    .input('userId', sql.Int, req.user!.userId)
    .query(`
      UPDATE dbo.Documents SET Name = @name, CategoryId = @categoryId, FolderPath = @folder,
             UpdatedById = @userId, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @id
    `);
  const changes: Record<string, unknown> = {};
  if (body.name !== doc.name) changes.renamedFrom = doc.name;
  if (body.folder !== doc.folderPath) changes.movedFrom = doc.folderPath;
  await auditRequest(req, 'DOCUMENT_UPDATED', 'Document', doc.id, { name: body.name, folder: body.folder, ...changes });
  res.status(204).end();
});

async function addVersion(
  req: Request,
  doc: DocumentRow,
  baseVersionNo: number,
  values: { data?: Record<string, string>; canvas?: CanvasDocument; fileId?: number; status?: 'Draft' | 'Final'; note: string },
): Promise<number> {
  if (doc.isArchived) throw new HttpError(409, 'This document is archived. Restore it before editing.');
  if (baseVersionNo !== doc.currentVersionNo) {
    throw new HttpError(409, `Someone saved version ${doc.currentVersionNo} of this document after you opened it. Reload to see their changes.`);
  }
  const versionNo = doc.currentVersionNo + 1;
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const updated = await transaction
      .request()
      .input('id', sql.Int, doc.id)
      .input('base', sql.Int, baseVersionNo)
      .input('next', sql.Int, versionNo)
      .input('data', sql.NVarChar(sql.MAX), values.data ? JSON.stringify(values.data) : null)
      .input('status', sql.NVarChar(20), values.status ?? null)
      .input('userId', sql.Int, req.user!.userId)
      .query(`
        UPDATE dbo.Documents
        SET CurrentVersionNo = @next, DataJson = COALESCE(@data, DataJson), Status = COALESCE(@status, Status),
            UpdatedById = @userId, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @id AND CurrentVersionNo = @base
      `);
    if (updated.rowsAffected[0] === 0) throw new HttpError(409, 'Someone else saved this document at the same moment. Reload and try again.');
    await transaction
      .request()
      .input('id', sql.Int, doc.id)
      .input('no', sql.Int, versionNo)
      .input('data', sql.NVarChar(sql.MAX), values.data ? JSON.stringify(values.data) : null)
      .input('canvas', sql.NVarChar(sql.MAX), values.canvas ? JSON.stringify(values.canvas) : null)
      .input('fileId', sql.Int, values.fileId ?? null)
      .input('note', sql.NVarChar(200), values.note)
      .input('userId', sql.Int, req.user!.userId)
      .query(`
        INSERT INTO dbo.DocumentVersions (DocumentId, VersionNo, DataJson, CanvasJson, FileId, Note, CreatedById)
        VALUES (@id, @no, @data, @canvas, @fileId, @note, @userId)
      `);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  return versionNo;
}

// Saves new field values and/or a changed layout for a template-based document.
documentsRouter.put('/:id/content', async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const doc = await loadDocument(req, idParam(req));
  if (doc.sourceType !== 'template' || !doc.templateId || !doc.templateVersionNo) {
    throw new HttpError(400, 'Uploaded files cannot be edited here. Upload a new version instead.');
  }
  const body = z
    .object({
      data: z.record(z.string(), z.unknown()).default({}),
      canvas: canvasSchema.optional(),
      status: z.enum(['Draft', 'Final']),
      baseVersionNo: z.number().int().min(1),
    })
    .parse(req.body);
  const ctx = await templateContext(accountId, doc.templateId, doc.templateVersionNo);
  const data = validateDocumentData(ctx.definitions, ctx.fields, body.data, { draft: body.status === 'Draft' });

  // Keep the layout from the current version when only the field values changed.
  let canvas = body.canvas;
  if (canvas) await checkReferences(accountId, { canvas });
  else {
    const pool = await getPool();
    const current = await pool
      .request()
      .input('id', sql.Int, doc.id)
      .input('no', sql.Int, doc.currentVersionNo)
      .query<{ canvasJson: string | null }>('SELECT CanvasJson AS canvasJson FROM dbo.DocumentVersions WHERE DocumentId = @id AND VersionNo = @no');
    canvas = current.recordset[0]?.canvasJson ? JSON.parse(current.recordset[0].canvasJson) : ctx.canvas;
  }

  const note = body.canvas ? 'Layout and values edited' : body.status === 'Draft' ? 'Draft saved' : 'Values saved';
  const versionNo = await addVersion(req, doc, body.baseVersionNo, { data, canvas, status: body.status, note });
  await auditRequest(req, 'DOCUMENT_EDITED', 'Document', doc.id, { versionNo, status: body.status });
  res.json({ versionNo });
});

// Adds a new file version to an uploaded document. The earlier files stay in their own versions.
documentsRouter.post('/:id/file', async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const doc = await loadDocument(req, idParam(req));
  if (doc.sourceType !== 'upload') throw new HttpError(400, 'Only uploaded documents take new file versions.');
  const file = await receiveUpload(req, res);
  const baseVersionNo = Number(req.body?.baseVersionNo);
  if (!Number.isInteger(baseVersionNo)) throw new HttpError(400, 'baseVersionNo is required.');
  if (doc.isArchived) throw new HttpError(409, 'This document is archived. Restore it before editing.');
  const stored = await storeFile(file, { accountId, userId: req.user!.userId, purpose: 'document' });
  const versionNo = await addVersion(req, doc, baseVersionNo, { fileId: stored.id, note: `New file: ${stored.originalName}`.slice(0, 200) });
  await auditRequest(req, 'DOCUMENT_FILE_REPLACED', 'Document', doc.id, { versionNo, file: stored.originalName });
  res.json({ versionNo });
});

// Changes the wording of an uploaded PDF (see services/pdf-text-edit.ts). The result is a new version;
// the original file stays in the version history.
documentsRouter.post('/:id/edit-text', async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const doc = await loadDocument(req, idParam(req));
  const body = z
    .object({ baseVersionNo: z.number().int().positive(), edits: z.array(textEditSchema).min(1, 'There are no changes to save.').max(2000) })
    .parse(req.body);
  if (doc.sourceType !== 'upload' || !doc.fileId || extensionOf(doc.fileName ?? '') !== 'pdf') {
    throw new HttpError(400, 'Only PDF files can have their text edited.');
  }
  const original = await readStoredFile(doc.fileId, doc.accountId);
  const edited = await applyTextEdits(original.data, body.edits);
  const stored = await storeGeneratedFile(edited, doc.fileName!, { accountId, userId: req.user!.userId });
  const versionNo = await addVersion(req, doc, body.baseVersionNo, { fileId: stored.id, note: `Text edited (${body.edits.length} change${body.edits.length === 1 ? '' : 's'})` });
  await auditRequest(req, 'DOCUMENT_TEXT_EDITED', 'Document', doc.id, { versionNo, changes: body.edits.length });
  res.json({ versionNo });
});

documentsRouter.post('/:id/duplicate', async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const doc = await loadDocument(req, idParam(req));
  const pool = await getPool();
  const current = await pool
    .request()
    .input('id', sql.Int, doc.id)
    .input('no', sql.Int, doc.currentVersionNo)
    .query<{ dataJson: string | null; canvasJson: string | null; fileId: number | null }>(
      'SELECT DataJson AS dataJson, CanvasJson AS canvasJson, FileId AS fileId FROM dbo.DocumentVersions WHERE DocumentId = @id AND VersionNo = @no',
    );
  const version = current.recordset[0];
  const fileId = version?.fileId ?? doc.fileId;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let id: number;
  try {
    // A copy points at the same stored file. Files are never changed in place, so sharing them is safe.
    const inserted = await transaction
      .request()
      .input('accountId', sql.Int, accountId)
      .input('categoryId', sql.Int, doc.categoryId)
      .input('templateId', sql.Int, doc.templateId)
      .input('templateVersionNo', sql.Int, doc.templateVersionNo)
      .input('name', sql.NVarChar(200), `Copy of ${doc.name}`.slice(0, 200))
      .input('status', sql.NVarChar(20), doc.sourceType === 'template' ? 'Draft' : doc.status)
      .input('sourceType', sql.NVarChar(20), doc.sourceType)
      .input('folder', sql.NVarChar(400), doc.folderPath)
      .input('data', sql.NVarChar(sql.MAX), version?.dataJson ?? null)
      .input('fileId', sql.Int, fileId)
      .input('userId', sql.Int, req.user!.userId)
      .query<{ id: number }>(`
        INSERT INTO dbo.Documents (AccountId, CategoryId, TemplateId, TemplateVersionNo, Name, Status, SourceType, FolderPath, DataJson, FileId, CreatedById, UpdatedById)
        OUTPUT INSERTED.Id AS id
        VALUES (@accountId, @categoryId, @templateId, @templateVersionNo, @name, @status, @sourceType, @folder, @data, @fileId, @userId, @userId)
      `);
    id = inserted.recordset[0].id;
    await transaction
      .request()
      .input('id', sql.Int, id)
      .input('data', sql.NVarChar(sql.MAX), version?.dataJson ?? null)
      .input('canvas', sql.NVarChar(sql.MAX), version?.canvasJson ?? null)
      .input('fileId', sql.Int, fileId)
      .input('note', sql.NVarChar(200), `Copied from document #${doc.id}`)
      .input('userId', sql.Int, req.user!.userId)
      .query(`
        INSERT INTO dbo.DocumentVersions (DocumentId, VersionNo, DataJson, CanvasJson, FileId, Note, CreatedById)
        VALUES (@id, 1, @data, @canvas, @fileId, @note, @userId)
      `);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  await auditRequest(req, 'DOCUMENT_DUPLICATED', 'Document', id, { from: doc.id });
  res.status(201).json({ id });
});

documentsRouter.post('/:id/archive', async (req, res) => {
  assertCanEdit(req);
  requireAccountId(req);
  const doc = await loadDocument(req, idParam(req));
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, doc.id)
    .input('userId', sql.Int, req.user!.userId)
    .query('UPDATE dbo.Documents SET IsArchived = 1, UpdatedById = @userId, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id');
  await auditRequest(req, 'DOCUMENT_ARCHIVED', 'Document', doc.id, { name: doc.name });
  res.status(204).end();
});

documentsRouter.post('/:id/restore', async (req, res) => {
  assertCanManage(req);
  requireAccountId(req);
  const doc = await loadDocument(req, idParam(req));
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, doc.id)
    .input('userId', sql.Int, req.user!.userId)
    .query('UPDATE dbo.Documents SET IsArchived = 0, UpdatedById = @userId, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id');
  await auditRequest(req, 'DOCUMENT_RESTORED', 'Document', doc.id, { name: doc.name });
  res.status(204).end();
});


// ---------- Trash ----------

// Delete moves a document to the trash. It can be restored from there until it is deleted forever
// (by an administrator, or automatically after the trash retention period).
async function moveToTrash(req: Request, doc: DocumentRow): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, doc.id)
    .input('userId', sql.Int, req.user!.userId)
    .query('UPDATE dbo.Documents SET DeletedAt = SYSUTCDATETIME(), DeletedById = @userId WHERE Id = @id AND DeletedAt IS NULL');
  await auditRequest(req, 'DOCUMENT_DELETED', 'Document', doc.id, { name: doc.name }, doc.accountId);
}

documentsRouter.delete('/:id', async (req, res) => {
  assertCanEdit(req);
  requireAccountId(req);
  await moveToTrash(req, await loadDocument(req, idParam(req)));
  res.status(204).end();
});

// Loads a document that is in the trash.
async function loadTrashed(req: Request, id: number): Promise<DocumentRow> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .input('accountId', sql.Int, req.scope!.accountId)
    .query<DocumentRow>(`
      SELECT ${DOCUMENT_COLUMNS} ${DOCUMENT_JOINS}
      WHERE d.Id = @id AND d.DeletedAt IS NOT NULL AND (@accountId IS NULL OR d.AccountId = @accountId)
    `);
  const row = result.recordset[0];
  if (!row) throw new HttpError(404, 'This document is not in the trash.');
  return row;
}

async function undelete(req: Request, doc: DocumentRow): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, doc.id)
    .query('UPDATE dbo.Documents SET DeletedAt = NULL, DeletedById = NULL WHERE Id = @id');
  await auditRequest(req, 'DOCUMENT_UNDELETED', 'Document', doc.id, { name: doc.name }, doc.accountId);
}

documentsRouter.post('/:id/undelete', async (req, res) => {
  assertCanEdit(req);
  requireAccountId(req);
  await undelete(req, await loadTrashed(req, idParam(req)));
  res.status(204).end();
});

documentsRouter.delete('/:id/permanent', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const doc = await loadTrashed(req, idParam(req));
  await purgeDocuments(accountId, [doc.id]);
  await auditRequest(req, 'DOCUMENT_PURGED', 'Document', doc.id, { name: doc.name }, accountId);
  res.status(204).end();
});

documentsRouter.post('/trash/empty', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const pool = await getPool();
  const inTrash = await pool
    .request()
    .input('accountId', sql.Int, accountId)
    .query<{ id: number }>('SELECT Id AS id FROM dbo.Documents WHERE AccountId = @accountId AND DeletedAt IS NOT NULL');
  const removed = await purgeDocuments(accountId, inTrash.recordset.map((r) => r.id));
  await auditRequest(req, 'TRASH_EMPTIED', 'Document', 'trash', { removed }, accountId);
  res.json({ removed });
});

// One action on many selected documents. Each document is checked on its own, and the reply says how many worked.
documentsRouter.post('/bulk', async (req, res) => {
  const body = z
    .object({ action: z.enum(['delete', 'undelete', 'purge', 'archive']), ids: z.array(z.number().int().positive()).min(1).max(500) })
    .parse(req.body);
  if (body.action === 'purge') assertCanManage(req);
  else assertCanEdit(req);
  const accountId = requireAccountId(req);

  if (body.action === 'purge') {
    const removed = await purgeDocuments(accountId, body.ids);
    await auditRequest(req, 'DOCUMENT_PURGED', 'Document', 'bulk', { removed }, accountId);
    res.json({ done: removed, failed: body.ids.length - removed });
    return;
  }

  let done = 0;
  for (const id of body.ids) {
    try {
      if (body.action === 'undelete') await undelete(req, await loadTrashed(req, id));
      else {
        const doc = await loadDocument(req, id);
        if (body.action === 'delete') await moveToTrash(req, doc);
        else {
          const pool = await getPool();
          await pool.request().input('id', sql.Int, doc.id).input('userId', sql.Int, req.user!.userId).query('UPDATE dbo.Documents SET IsArchived = 1, UpdatedById = @userId, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id');
          await auditRequest(req, 'DOCUMENT_ARCHIVED', 'Document', doc.id, { name: doc.name });
        }
      }
      done += 1;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
    }
  }
  res.json({ done, failed: body.ids.length - done });
});
