import { Router, type Request } from 'express';
import { z } from 'zod';
import { getPool, sql } from '../db/pool.js';
import { assertCanManage, canManage, idParam, requireAccountId } from '../middleware/scope.js';
import { auditRequest } from '../services/audit.js';
import { blankCanvas, canvasSchema, referencedFileIds, templateFieldsSchema, type CanvasDocument, type TemplateFields } from '../services/canvas.js';
import { HttpError } from '../utils/http-error.js';

// Templates: a design plus the fields people fill in. Every save makes a new version; old versions are kept,
// and documents remember which version they were made from.
export const templatesRouter = Router();

// Checks that the category, images and fields used by a template all belong to the same office.
export async function checkReferences(
  accountId: number,
  refs: { categoryId?: number | null; canvas?: CanvasDocument; fields?: TemplateFields },
): Promise<void> {
  const pool = await getPool();
  if (refs.categoryId) {
    const found = await pool
      .request()
      .input('id', sql.Int, refs.categoryId)
      .input('accountId', sql.Int, accountId)
      .query('SELECT 1 AS ok FROM dbo.DocumentCategories WHERE Id = @id AND AccountId = @accountId');
    if (found.recordset.length === 0) throw new HttpError(400, 'The chosen category does not exist.');
  }
  if (refs.canvas) {
    const fileIds = referencedFileIds(refs.canvas);
    if (fileIds.length > 0) {
      const found = await pool
        .request()
        .input('accountId', sql.Int, accountId)
        .input('ids', sql.NVarChar(sql.MAX), fileIds.join(','))
        .query<{ total: number }>(`
          SELECT COUNT(*) AS total FROM dbo.StoredFiles
          WHERE AccountId = @accountId AND Id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
        `);
      if (found.recordset[0].total !== fileIds.length) throw new HttpError(400, 'The design uses an image that does not exist.');
    }
  }
  const keys = new Set<string>(refs.fields?.map((f) => f.fieldKey) ?? []);
  for (const page of refs.canvas?.pages ?? []) {
    for (const el of page.elements) {
      if (el.type === 'field') keys.add(el.fieldKey);
      if ((el.type === 'barcode' || el.type === 'qrcode') && el.fieldKey) keys.add(el.fieldKey);
    }
  }
  if (keys.size > 0) {
    const found = await pool
      .request()
      .input('accountId', sql.Int, accountId)
      .input('keys', sql.NVarChar(sql.MAX), [...keys].join(','))
      .query<{ fieldKey: string }>(`
        SELECT FieldKey AS fieldKey FROM dbo.FieldDefinitions
        WHERE AccountId = @accountId AND FieldKey IN (SELECT value FROM STRING_SPLIT(@keys, ','))
      `);
    const existing = new Set(found.recordset.map((r) => r.fieldKey));
    const missing = [...keys].filter((k) => !existing.has(k));
    if (missing.length > 0) throw new HttpError(400, `These fields do not exist in the Field Master: ${missing.join(', ')}.`);
  }
}

// Makes sure every field placed on the canvas has an entry in the fields list, and drops entries for fields no longer used.
export function syncTemplateFields(canvas: CanvasDocument, fields: TemplateFields): TemplateFields {
  const used: string[] = [];
  for (const page of canvas.pages) {
    for (const el of page.elements) {
      const key = el.type === 'field' ? el.fieldKey : (el.type === 'barcode' || el.type === 'qrcode') && el.fieldKey ? el.fieldKey : null;
      if (key && !used.includes(key)) used.push(key);
    }
  }
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
  return used.map((key) => byKey.get(key) ?? { fieldKey: key, required: false, defaultValue: '' });
}

interface TemplateRow {
  id: number;
  accountId: number;
  categoryId: number | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  status: 'Draft' | 'Published' | 'Archived';
  currentVersionNo: number;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string;
  documentCount: number;
}

const TEMPLATE_COLUMNS = `
  t.Id AS id, t.AccountId AS accountId, t.CategoryId AS categoryId, c.Name AS categoryName, t.Name AS name,
  t.Description AS description, t.Status AS status, t.CurrentVersionNo AS currentVersionNo,
  t.CreatedAt AS createdAt, t.UpdatedAt AS updatedAt, u.FullName AS createdByName,
  (SELECT COUNT(*) FROM dbo.Documents d WHERE d.TemplateId = t.Id AND d.DeletedAt IS NULL) AS documentCount
`;

async function loadTemplate(req: Request, id: number): Promise<TemplateRow> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .input('accountId', sql.Int, req.scope!.accountId)
    .query<TemplateRow>(`
      SELECT ${TEMPLATE_COLUMNS}
      FROM dbo.Templates t
      LEFT JOIN dbo.DocumentCategories c ON c.Id = t.CategoryId
      JOIN dbo.Users u ON u.Id = t.CreatedById
      WHERE t.Id = @id AND (@accountId IS NULL OR t.AccountId = @accountId)
    `);
  const row = result.recordset[0];
  // Editors and viewers only see published templates.
  if (!row || (!canManage(req.user!) && row.status !== 'Published')) throw new HttpError(404, 'Template not found.');
  return row;
}

export async function loadTemplateVersion(templateId: number, versionNo: number) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, templateId)
    .input('no', sql.Int, versionNo)
    .query<{ canvasJson: string; fieldsJson: string | null; versionNo: number; createdAt: Date; createdByName: string }>(`
      SELECT v.CanvasJson AS canvasJson, v.FieldsJson AS fieldsJson, v.VersionNo AS versionNo, v.CreatedAt AS createdAt,
             u.FullName AS createdByName
      FROM dbo.TemplateVersions v JOIN dbo.Users u ON u.Id = v.CreatedById
      WHERE v.TemplateId = @id AND v.VersionNo = @no
    `);
  const row = result.recordset[0];
  if (!row) throw new HttpError(404, 'Template version not found.');
  return {
    versionNo: row.versionNo,
    createdAt: row.createdAt,
    createdByName: row.createdByName,
    canvas: JSON.parse(row.canvasJson) as CanvasDocument,
    fields: (row.fieldsJson ? JSON.parse(row.fieldsJson) : []) as TemplateFields,
  };
}

templatesRouter.get('/', async (req, res) => {
  const query = z
    .object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(['Draft', 'Published', 'Archived']).optional(),
      categoryId: z.coerce.number().int().positive().optional(),
    })
    .parse(req.query);
  const status = canManage(req.user!) ? (query.status ?? null) : 'Published';
  const pool = await getPool();
  const result = await pool
    .request()
    .input('accountId', sql.Int, req.scope!.accountId)
    .input('q', sql.NVarChar(102), query.q ? `%${query.q}%` : null)
    .input('status', sql.NVarChar(20), status)
    .input('categoryId', sql.Int, query.categoryId ?? null)
    .query<TemplateRow>(`
      SELECT ${TEMPLATE_COLUMNS}
      FROM dbo.Templates t
      LEFT JOIN dbo.DocumentCategories c ON c.Id = t.CategoryId
      JOIN dbo.Users u ON u.Id = t.CreatedById
      WHERE (@accountId IS NULL OR t.AccountId = @accountId)
        AND (@q IS NULL OR t.Name LIKE @q)
        AND (@status IS NULL OR t.Status = @status)
        AND (@categoryId IS NULL OR t.CategoryId = @categoryId)
      ORDER BY t.UpdatedAt DESC
    `);
  res.json({ templates: result.recordset });
});

const metaSchema = z.object({
  name: z.string().trim().min(2, 'Enter a template name.').max(150),
  categoryId: z.number().int().positive().nullable().default(null),
  description: z.string().trim().max(500).optional().default(''),
});

templatesRouter.post('/', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const body = metaSchema
    .extend({ canvas: canvasSchema.optional(), fields: templateFieldsSchema.optional() })
    .parse(req.body);
  const canvas = body.canvas ?? blankCanvas();
  const fields = syncTemplateFields(canvas, body.fields ?? []);
  await checkReferences(accountId, { categoryId: body.categoryId, canvas, fields });

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let id: number;
  try {
    const inserted = await transaction
      .request()
      .input('accountId', sql.Int, accountId)
      .input('categoryId', sql.Int, body.categoryId)
      .input('name', sql.NVarChar(150), body.name)
      .input('description', sql.NVarChar(500), body.description || null)
      .input('userId', sql.Int, req.user!.userId)
      .query<{ id: number }>(`
        INSERT INTO dbo.Templates (AccountId, CategoryId, Name, Description, CurrentVersionNo, CreatedById)
        OUTPUT INSERTED.Id AS id
        VALUES (@accountId, @categoryId, @name, @description, 1, @userId)
      `);
    id = inserted.recordset[0].id;
    await transaction
      .request()
      .input('id', sql.Int, id)
      .input('canvas', sql.NVarChar(sql.MAX), JSON.stringify(canvas))
      .input('fields', sql.NVarChar(sql.MAX), JSON.stringify(fields))
      .input('userId', sql.Int, req.user!.userId)
      .query(`
        INSERT INTO dbo.TemplateVersions (TemplateId, VersionNo, CanvasJson, FieldsJson, CreatedById)
        VALUES (@id, 1, @canvas, @fields, @userId)
      `);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  await auditRequest(req, 'TEMPLATE_CREATED', 'Template', id, { name: body.name });
  res.status(201).json({ id });
});

templatesRouter.get('/:id', async (req, res) => {
  const template = await loadTemplate(req, idParam(req));
  const version = await loadTemplateVersion(template.id, template.currentVersionNo);
  const pool = await getPool();
  const versions = await pool
    .request()
    .input('id', sql.Int, template.id)
    .query(`
      SELECT v.VersionNo AS versionNo, v.CreatedAt AS createdAt, u.FullName AS createdByName
      FROM dbo.TemplateVersions v JOIN dbo.Users u ON u.Id = v.CreatedById
      WHERE v.TemplateId = @id ORDER BY v.VersionNo DESC
    `);
  res.json({ template, canvas: version.canvas, fields: version.fields, versions: versions.recordset });
});

templatesRouter.get('/:id/versions/:no', async (req, res) => {
  const template = await loadTemplate(req, idParam(req));
  res.json(await loadTemplateVersion(template.id, idParam(req, 'no')));
});

templatesRouter.put('/:id', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const template = await loadTemplate(req, idParam(req));
  const body = metaSchema.parse(req.body);
  await checkReferences(accountId, { categoryId: body.categoryId });
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, template.id)
    .input('categoryId', sql.Int, body.categoryId)
    .input('name', sql.NVarChar(150), body.name)
    .input('description', sql.NVarChar(500), body.description || null)
    .query(`
      UPDATE dbo.Templates SET Name = @name, CategoryId = @categoryId, Description = @description, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @id
    `);
  await auditRequest(req, 'TEMPLATE_UPDATED', 'Template', template.id, { name: body.name });
  res.status(204).end();
});

// Saves the design as a new version. baseVersionNo must match the current version, so two people editing
// the same template at once cannot silently overwrite each other's work.
templatesRouter.post('/:id/versions', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const template = await loadTemplate(req, idParam(req));
  const body = z
    .object({ canvas: canvasSchema, fields: templateFieldsSchema.default([]), baseVersionNo: z.number().int().min(0) })
    .parse(req.body);
  if (template.status === 'Archived') throw new HttpError(409, 'This template is archived. Restore it to draft before editing.');
  if (body.baseVersionNo !== template.currentVersionNo) {
    throw new HttpError(409, `Someone saved version ${template.currentVersionNo} of this template after you opened it. Reload to see their changes.`);
  }
  const fields = syncTemplateFields(body.canvas, body.fields);
  await checkReferences(accountId, { canvas: body.canvas, fields });

  const versionNo = template.currentVersionNo + 1;
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // The WHERE clause repeats the version check inside the transaction, closing the race between two saves.
    const updated = await transaction
      .request()
      .input('id', sql.Int, template.id)
      .input('base', sql.Int, body.baseVersionNo)
      .input('next', sql.Int, versionNo)
      .query('UPDATE dbo.Templates SET CurrentVersionNo = @next, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND CurrentVersionNo = @base');
    if (updated.rowsAffected[0] === 0) throw new HttpError(409, 'Someone else saved this template at the same moment. Reload and try again.');
    await transaction
      .request()
      .input('id', sql.Int, template.id)
      .input('no', sql.Int, versionNo)
      .input('canvas', sql.NVarChar(sql.MAX), JSON.stringify(body.canvas))
      .input('fields', sql.NVarChar(sql.MAX), JSON.stringify(fields))
      .input('userId', sql.Int, req.user!.userId)
      .query(`
        INSERT INTO dbo.TemplateVersions (TemplateId, VersionNo, CanvasJson, FieldsJson, CreatedById)
        VALUES (@id, @no, @canvas, @fields, @userId)
      `);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  await auditRequest(req, 'TEMPLATE_VERSION_SAVED', 'Template', template.id, { versionNo });
  res.status(201).json({ versionNo, fields });
});

templatesRouter.post('/:id/status', async (req, res) => {
  assertCanManage(req);
  requireAccountId(req);
  const template = await loadTemplate(req, idParam(req));
  const { status } = z.object({ status: z.enum(['Draft', 'Published', 'Archived']) }).parse(req.body);
  if (status === 'Published') {
    const version = await loadTemplateVersion(template.id, template.currentVersionNo);
    if (version.canvas.pages.every((p) => p.elements.length === 0 && !p.backgroundFileId)) {
      throw new HttpError(400, 'The template is empty. Add some content in the designer before publishing.');
    }
  }
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, template.id)
    .input('status', sql.NVarChar(20), status)
    .query('UPDATE dbo.Templates SET Status = @status, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id');
  await auditRequest(req, `TEMPLATE_${status.toUpperCase()}`, 'Template', template.id);
  res.status(204).end();
});

templatesRouter.post('/:id/duplicate', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const template = await loadTemplate(req, idParam(req));
  const version = await loadTemplateVersion(template.id, template.currentVersionNo);
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let id: number;
  try {
    const inserted = await transaction
      .request()
      .input('accountId', sql.Int, accountId)
      .input('categoryId', sql.Int, template.categoryId)
      .input('name', sql.NVarChar(150), `Copy of ${template.name}`.slice(0, 150))
      .input('description', sql.NVarChar(500), template.description)
      .input('userId', sql.Int, req.user!.userId)
      .query<{ id: number }>(`
        INSERT INTO dbo.Templates (AccountId, CategoryId, Name, Description, CurrentVersionNo, CreatedById)
        OUTPUT INSERTED.Id AS id VALUES (@accountId, @categoryId, @name, @description, 1, @userId)
      `);
    id = inserted.recordset[0].id;
    await transaction
      .request()
      .input('id', sql.Int, id)
      .input('canvas', sql.NVarChar(sql.MAX), JSON.stringify(version.canvas))
      .input('fields', sql.NVarChar(sql.MAX), JSON.stringify(version.fields))
      .input('userId', sql.Int, req.user!.userId)
      .query(`
        INSERT INTO dbo.TemplateVersions (TemplateId, VersionNo, CanvasJson, FieldsJson, CreatedById)
        VALUES (@id, 1, @canvas, @fields, @userId)
      `);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  await auditRequest(req, 'TEMPLATE_DUPLICATED', 'Template', id, { from: template.id });
  res.status(201).json({ id });
});
