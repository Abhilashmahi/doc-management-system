import { Router } from 'express';
import { z } from 'zod';
import { getPool, sql } from '../db/pool.js';
import { assertCanManage, idParam, requireAccountId } from '../middleware/scope.js';
import { isDuplicateKeyError } from '../services/accounts.js';
import { auditRequest } from '../services/audit.js';
import { HttpError } from '../utils/http-error.js';

// Document categories and field definitions. Everyone in an office can read them; only administrators can change them.
// Express 5 passes errors from async handlers to the error handler, so these handlers need no try/catch.
export const mastersRouter = Router();

// ---------- Categories ----------

const categorySchema = z.object({
  name: z.string().trim().min(2, 'Enter a category name.').max(150),
  description: z.string().trim().max(500).optional().default(''),
});

mastersRouter.get('/categories', async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('accountId', sql.Int, req.scope!.accountId)
    .input('all', sql.Bit, req.query.includeInactive === 'true')
    .query(`
      SELECT c.Id AS id, c.AccountId AS accountId, c.Name AS name, c.Description AS description, c.IsActive AS isActive,
             c.CreatedAt AS createdAt,
             (SELECT COUNT(*) FROM dbo.Documents d WHERE d.CategoryId = c.Id AND d.DeletedAt IS NULL) AS documentCount,
             (SELECT COUNT(*) FROM dbo.Templates t WHERE t.CategoryId = c.Id) AS templateCount
      FROM dbo.DocumentCategories c
      WHERE (@accountId IS NULL OR c.AccountId = @accountId) AND (@all = 1 OR c.IsActive = 1)
      ORDER BY c.Name
    `);
  res.json({ categories: result.recordset });
});

mastersRouter.post('/categories', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const body = categorySchema.parse(req.body);
  const pool = await getPool();
  try {
    const inserted = await pool
      .request()
      .input('accountId', sql.Int, accountId)
      .input('name', sql.NVarChar(150), body.name)
      .input('description', sql.NVarChar(500), body.description || null)
      .query<{ id: number }>(`
        INSERT INTO dbo.DocumentCategories (AccountId, Name, Description) OUTPUT INSERTED.Id AS id
        VALUES (@accountId, @name, @description)
      `);
    const id = inserted.recordset[0].id;
    await auditRequest(req, 'CATEGORY_CREATED', 'Category', id, { name: body.name });
    res.status(201).json({ id });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new HttpError(409, 'A category with this name already exists.');
    throw error;
  }
});

mastersRouter.put('/categories/:id', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const id = idParam(req);
  const body = categorySchema.extend({ isActive: z.boolean() }).parse(req.body);
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .input('accountId', sql.Int, accountId)
      .input('name', sql.NVarChar(150), body.name)
      .input('description', sql.NVarChar(500), body.description || null)
      .input('active', sql.Bit, body.isActive)
      .query(`
        UPDATE dbo.DocumentCategories SET Name = @name, Description = @description, IsActive = @active
        WHERE Id = @id AND AccountId = @accountId
      `);
    if (result.rowsAffected[0] === 0) throw new HttpError(404, 'Category not found.');
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new HttpError(409, 'A category with this name already exists.');
    throw error;
  }
  await auditRequest(req, 'CATEGORY_UPDATED', 'Category', id, { name: body.name, isActive: body.isActive });
  res.status(204).end();
});

// ---------- Field definitions ----------

const fieldTypes = ['text', 'number', 'date', 'select', 'multiline'] as const;

export const validationRulesSchema = z
  .object({
    required: z.boolean().optional(),
    minLength: z.number().int().min(0).max(10000).optional(),
    maxLength: z.number().int().min(1).max(10000).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    pattern: z
      .string()
      .max(200)
      .refine((p) => {
        try {
          new RegExp(p);
          return true;
        } catch {
          return false;
        }
      }, 'The pattern is not a valid regular expression.')
      .optional(),
    patternMessage: z.string().max(200).optional(),
    options: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  })
  .strict();

const fieldSchema = z
  .object({
    fieldKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/, 'Field ID must start with a letter and use only letters, numbers and underscores (no spaces).'),
    label: z.string().trim().min(1, 'Enter a label.').max(150),
    dataType: z.enum(fieldTypes),
    validation: validationRulesSchema.default({}),
    defaultValue: z.string().max(500).optional().default(''),
    isVisible: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .refine((f) => f.dataType !== 'select' || (f.validation.options?.length ?? 0) > 0, {
    message: 'A drop-down field needs at least one option.',
    path: ['validation', 'options'],
  });

interface FieldRow {
  id: number;
  accountId: number;
  fieldKey: string;
  label: string;
  dataType: string;
  validationJson: string | null;
  defaultValue: string | null;
  isVisible: boolean;
  isActive: boolean;
}

function toField(row: FieldRow) {
  const { validationJson, ...rest } = row;
  return { ...rest, defaultValue: row.defaultValue ?? '', validation: validationJson ? JSON.parse(validationJson) : {} };
}

export async function loadFields(accountId: number | null, includeInactive = false) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('accountId', sql.Int, accountId)
    .input('all', sql.Bit, includeInactive)
    .query<FieldRow>(`
      SELECT Id AS id, AccountId AS accountId, FieldKey AS fieldKey, Label AS label, DataType AS dataType,
             ValidationJson AS validationJson, DefaultValue AS defaultValue, IsVisible AS isVisible, IsActive AS isActive
      FROM dbo.FieldDefinitions
      WHERE (@accountId IS NULL OR AccountId = @accountId) AND (@all = 1 OR IsActive = 1)
      ORDER BY Label
    `);
  return result.recordset.map(toField);
}

mastersRouter.get('/fields', async (req, res) => {
  res.json({ fields: await loadFields(req.scope!.accountId, req.query.includeInactive === 'true') });
});

mastersRouter.post('/fields', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const body = fieldSchema.parse(req.body);
  const pool = await getPool();
  try {
    const inserted = await pool
      .request()
      .input('accountId', sql.Int, accountId)
      .input('key', sql.NVarChar(60), body.fieldKey)
      .input('label', sql.NVarChar(150), body.label)
      .input('type', sql.NVarChar(20), body.dataType)
      .input('validation', sql.NVarChar(sql.MAX), JSON.stringify(body.validation))
      .input('default', sql.NVarChar(500), body.defaultValue || null)
      .input('visible', sql.Bit, body.isVisible)
      .input('active', sql.Bit, body.isActive)
      .query<{ id: number }>(`
        INSERT INTO dbo.FieldDefinitions (AccountId, FieldKey, Label, DataType, ValidationJson, DefaultValue, IsVisible, IsActive)
        OUTPUT INSERTED.Id AS id
        VALUES (@accountId, @key, @label, @type, @validation, @default, @visible, @active)
      `);
    const id = inserted.recordset[0].id;
    await auditRequest(req, 'FIELD_CREATED', 'Field', id, { fieldKey: body.fieldKey });
    res.status(201).json({ id });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new HttpError(409, 'A field with this Field ID already exists.');
    throw error;
  }
});

// The Field ID cannot change after creation, because templates and saved documents refer to it.
mastersRouter.put('/fields/:id', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const id = idParam(req);
  const body = fieldSchema.parse(req.body);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .input('accountId', sql.Int, accountId)
    .input('key', sql.NVarChar(60), body.fieldKey)
    .input('label', sql.NVarChar(150), body.label)
    .input('type', sql.NVarChar(20), body.dataType)
    .input('validation', sql.NVarChar(sql.MAX), JSON.stringify(body.validation))
    .input('default', sql.NVarChar(500), body.defaultValue || null)
    .input('visible', sql.Bit, body.isVisible)
    .input('active', sql.Bit, body.isActive)
    .query(`
      UPDATE dbo.FieldDefinitions
      SET Label = @label, DataType = @type, ValidationJson = @validation, DefaultValue = @default,
          IsVisible = @visible, IsActive = @active
      WHERE Id = @id AND AccountId = @accountId AND FieldKey = @key
    `);
  if (result.rowsAffected[0] === 0) throw new HttpError(404, 'Field not found, or its Field ID was changed. Field IDs cannot be changed.');
  await auditRequest(req, 'FIELD_UPDATED', 'Field', id, { fieldKey: body.fieldKey });
  res.status(204).end();
});
