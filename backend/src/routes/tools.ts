import { randomBytes } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { getPool, sql } from '../db/pool.js';
import { assertCanEdit, assertCanManage, requireAccountId } from '../middleware/scope.js';
import { auditRequest } from '../services/audit.js';
import { blankCanvas } from '../services/canvas.js';
import { conversionOptions, convert } from '../services/convert/index.js';
import { libreOfficePath } from '../services/convert/libreoffice.js';
import { zipFiles } from '../services/convert/office.js';
import { renderPdfPages } from '../services/convert/pdf-reader.js';
import { receiveUploads, storeGeneratedFile } from '../services/files.js';
import { BLOCKED_EXTENSIONS, extensionOf, formatOf, mimeForExtension } from '../services/formats.js';
import {
  addPageNumbers,
  addWatermark,
  compressPdf,
  imagesToPdf,
  loadPdf,
  mergePdfs,
  pickPages,
  rotatePdf,
  splitPdf,
  type NamedFile,
} from '../services/pdf-tools.js';
import { HttpError } from '../utils/http-error.js';
import { createFileDocument, folderSchema } from './documents.js';

// iLovePDF-style tools: upload files, set options, get one result to download or save into Documents.
// Uploaded inputs are processed in memory and never stored. Results wait here for 30 minutes.
export const toolsRouter = Router();

// ---------- Short-lived results ----------

interface Result {
  userId: number;
  name: string;
  data: Buffer;
  expires: number;
}

const RESULT_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_BYTES = 400 * 1024 * 1024;
const results = new Map<string, Result>();

function keepResult(userId: number, name: string, data: Buffer): string {
  const now = Date.now();
  for (const [key, r] of results) if (r.expires < now) results.delete(key);
  // Drop the oldest results when memory use gets high.
  let total = [...results.values()].reduce((sum, r) => sum + r.data.length, 0) + data.length;
  for (const [key, r] of results) {
    if (total <= MAX_CACHE_BYTES) break;
    total -= r.data.length;
    results.delete(key);
  }
  const token = randomBytes(18).toString('base64url');
  results.set(token, { userId, name, data, expires: now + RESULT_TTL_MS });
  return token;
}

function takeResult(req: Request): Result {
  const r = results.get(String(req.params.token));
  // Only the person who made a result can fetch it.
  if (!r || r.userId !== req.user!.userId || r.expires < Date.now()) {
    throw new HttpError(404, 'This result has expired. Run the tool again.');
  }
  return r;
}

// ---------- Input checks ----------

function checkFiles(files: Express.Multer.File[], accept: string[], label: string): NamedFile[] {
  return files.map((f) => {
    const ext = extensionOf(f.originalname);
    if (BLOCKED_EXTENSIONS.includes(ext)) throw new HttpError(400, `“${f.originalname}” is a program or script and is not accepted.`);
    if (!accept.includes(ext)) throw new HttpError(400, `“${f.originalname}” is not ${label}.`);
    if (!formatOf(ext)?.matches(f.buffer)) throw new HttpError(400, `“${f.originalname}” does not contain what its .${ext} extension says.`);
    return { name: f.originalname, data: f.buffer };
  });
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'document';
const IMAGES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff'];

const parseOptions = <T extends z.ZodType>(req: Request, schema: T): z.infer<T> => {
  let raw: unknown = {};
  try {
    raw = req.body?.options ? JSON.parse(String(req.body.options)) : {};
  } catch {
    throw new HttpError(400, 'The tool options are not valid.');
  }
  return schema.parse(raw);
};

// ---------- What is available ----------

// Lets the tools page mark tools that need LibreOffice, and list conversions for a chosen file.
toolsRouter.get('/capabilities', (_req, res) => {
  res.json({ libreoffice: libreOfficePath() !== null });
});

toolsRouter.get('/conversions', (req, res) => {
  const ext = z.string().regex(/^[a-z0-9]{1,10}$/).parse(String(req.query.ext ?? '').toLowerCase());
  res.json({ from: ext, options: conversionOptions(ext) });
});

// ---------- Run a tool ----------

const TOOLS = ['merge', 'split', 'organize', 'rotate', 'page-numbers', 'watermark', 'compress', 'images-to-pdf', 'pdf-to-images', 'convert'] as const;

toolsRouter.post('/run/:tool', async (req, res) => {
  const tool = String(req.params.tool) as (typeof TOOLS)[number];
  if (!TOOLS.includes(tool)) throw new HttpError(404, 'Unknown tool.');
  const files = await receiveUploads(req, res, 30);
  const started = Date.now();
  let output: NamedFile;
  let note: string | undefined;

  switch (tool) {
    case 'merge': {
      const pdfs = checkFiles(files, ['pdf'], 'a PDF');
      output = { name: `${baseName(pdfs[0].name)}-merged.pdf`, data: await mergePdfs(pdfs) };
      break;
    }
    case 'split': {
      const [pdf] = checkFiles(files.slice(0, 1), ['pdf'], 'a PDF');
      const opts = parseOptions(
        req,
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('each') }),
          z.object({ kind: z.literal('ranges'), ranges: z.string().max(500) }),
          z.object({ kind: z.literal('every'), size: z.number().int().min(1).max(1000) }),
        ]),
      );
      const parts = await splitPdf(pdf.data, opts, baseName(pdf.name));
      output = parts.length === 1 ? parts[0] : { name: `${baseName(pdf.name)}-split.zip`, data: await zipFiles(parts) };
      note = `${parts.length} PDF file${parts.length === 1 ? '' : 's'}${parts.length > 1 ? ', packed in a ZIP' : ''}.`;
      break;
    }
    case 'organize': {
      const [pdf] = checkFiles(files.slice(0, 1), ['pdf'], 'a PDF');
      const opts = parseOptions(req, z.object({ pages: z.array(z.object({ page: z.number().int().min(1), rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0) })).min(1).max(5000) }));
      output = { name: `${baseName(pdf.name)}-organized.pdf`, data: await pickPages(pdf.data, opts.pages) };
      break;
    }
    case 'rotate': {
      const [pdf] = checkFiles(files.slice(0, 1), ['pdf'], 'a PDF');
      const opts = parseOptions(req, z.object({ angle: z.union([z.literal(90), z.literal(180), z.literal(270)]), pages: z.string().max(500).default('') }));
      output = { name: `${baseName(pdf.name)}-rotated.pdf`, data: await rotatePdf(pdf.data, opts.angle, opts.pages) };
      break;
    }
    case 'page-numbers': {
      const [pdf] = checkFiles(files.slice(0, 1), ['pdf'], 'a PDF');
      const opts = parseOptions(
        req,
        z.object({
          position: z.enum(['bottom-center', 'bottom-right', 'bottom-left', 'top-center', 'top-right', 'top-left']).default('bottom-center'),
          start: z.number().int().min(0).max(100000).default(1),
          format: z.string().min(1).max(60).default('{n}'),
          size: z.number().min(6).max(48).default(11),
          skipFirst: z.boolean().default(false),
        }),
      );
      output = { name: `${baseName(pdf.name)}-numbered.pdf`, data: await addPageNumbers(pdf.data, opts) };
      break;
    }
    case 'watermark': {
      const [pdf] = checkFiles(files.slice(0, 1), ['pdf'], 'a PDF');
      const opts = parseOptions(
        req,
        z.object({
          text: z.string().trim().min(1, 'Enter the watermark text.').max(100),
          size: z.number().min(8).max(200).default(60),
          opacity: z.number().min(0.05).max(1).default(0.2),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#dc2626'),
          angle: z.number().min(-90).max(90).default(45),
          pages: z.string().max(500).default(''),
        }),
      );
      output = { name: `${baseName(pdf.name)}-watermarked.pdf`, data: await addWatermark(pdf.data, opts) };
      break;
    }
    case 'compress': {
      const [pdf] = checkFiles(files.slice(0, 1), ['pdf'], 'a PDF');
      const opts = parseOptions(req, z.object({ level: z.enum(['basic', 'strong']).default('basic') }));
      const result = await compressPdf(pdf.data, opts.level);
      output = { name: `${baseName(pdf.name)}-compressed.pdf`, data: result.data };
      const saved = Math.round((1 - result.data.length / pdf.data.length) * 100);
      note = `${result.note}${saved > 0 ? ` ${saved}% smaller.` : ''}`;
      break;
    }
    case 'images-to-pdf': {
      const images = checkFiles(files, IMAGES, 'an image (PNG, JPEG, WebP, GIF or TIFF)');
      const opts = parseOptions(
        req,
        z.object({
          pageSize: z.enum(['a4', 'letter', 'fit']).default('a4'),
          orientation: z.enum(['auto', 'portrait', 'landscape']).default('auto'),
          margin: z.number().min(0).max(72).default(0),
        }),
      );
      output = { name: `${baseName(images[0].name)}${images.length > 1 ? '-and-more' : ''}.pdf`, data: await imagesToPdf(images, opts) };
      break;
    }
    case 'pdf-to-images': {
      const [pdf] = checkFiles(files.slice(0, 1), ['pdf'], 'a PDF');
      const opts = parseOptions(req, z.object({ format: z.enum(['png', 'jpeg']).default('jpeg'), dpi: z.number().int().min(50).max(300).default(150) }));
      const ext = opts.format === 'png' ? 'png' : 'jpg';
      const pages = await renderPdfPages(pdf.data, opts.format, opts.dpi);
      output =
        pages.length === 1
          ? { name: `${baseName(pdf.name)}.${ext}`, data: pages[0].data }
          : { name: `${baseName(pdf.name)}-images.zip`, data: await zipFiles(pages.map((p, i) => ({ name: `${baseName(pdf.name)}-page-${i + 1}.${ext}`, data: p.data }))) };
      note = `${pages.length} image${pages.length === 1 ? '' : 's'}${pages.length > 1 ? ', packed in a ZIP' : ''}.`;
      break;
    }
    case 'convert': {
      // General format change, e.g. Word to PDF or PDF to Word. One file at a time.
      const file = files[0];
      const from = extensionOf(file.originalname);
      const opts = parseOptions(req, z.object({ to: z.string().min(2).max(10) }));
      checkFiles([file], [from], 'a supported file');
      const option = conversionOptions(from).find((o) => o.to === opts.to);
      const result = await convert(file.buffer, from, opts.to, baseName(file.originalname));
      output = { name: `${baseName(file.originalname)}.${result.ext}`, data: result.data };
      if (option?.quality === 'text-only') note = 'Only the text was kept; layout, tables and pictures are not included.';
      break;
    }
  }

  const token = keepResult(req.user!.userId, output.name, output.data);
  await auditRequest(req, 'TOOL_USED', 'Tool', tool, { files: files.length, ms: Date.now() - started, output: output.name });
  res.json({ token, name: output.name, sizeBytes: output.data.length, note });
});

// ---------- Fetch or keep a result ----------

toolsRouter.get('/results/:token', (req, res) => {
  const result = takeResult(req);
  res.attachment(result.name);
  res.setHeader('Content-Type', mimeForExtension(extensionOf(result.name)));
  res.setHeader('Cache-Control', 'no-store');
  res.send(result.data);
});

toolsRouter.post('/results/:token/save', async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const result = takeResult(req);
  const body = z.object({ folder: folderSchema, categoryId: z.number().int().positive().nullable().default(null) }).parse(req.body ?? {});
  const stored = await storeGeneratedFile(result.data, result.name, { accountId, userId: req.user!.userId });
  const id = await createFileDocument(req, accountId, stored.id, {
    name: baseName(result.name),
    categoryId: body.categoryId,
    folder: body.folder,
    note: 'Saved from PDF tools',
  });
  await auditRequest(req, 'DOCUMENT_UPLOADED', 'Document', id, { name: result.name, source: 'pdf-tools' });
  res.status(201).json({ id });
});

// ---------- PDF to editable template ----------

// Each PDF page becomes a template page with that page as its background picture; administrators then place
// fields, text and codes on top in the designer. The original PDF text is part of the picture, not editable text.
toolsRouter.post('/pdf-to-template', async (req, res) => {
  assertCanManage(req);
  const accountId = requireAccountId(req);
  const files = await receiveUploads(req, res, 1);
  const [pdf] = checkFiles(files, ['pdf'], 'a PDF');
  const source = await loadPdf(pdf.data);
  if (source.getPageCount() > 20) throw new HttpError(400, 'Templates can be made from PDFs with up to 20 pages.');
  const images = await renderPdfPages(pdf.data, 'png', 150);

  const canvas = blankCanvas();
  canvas.pages = [];
  for (let i = 0; i < images.length; i += 1) {
    const stored = await storeGeneratedFile(images[i].data, `${baseName(pdf.name)}-page-${i + 1}.png`, { accountId, userId: req.user!.userId });
    // Mark it as a design image so it shows in the designer's image library.
    const pool = await getPool();
    await pool.request().input('id', sql.Int, stored.id).query("UPDATE dbo.StoredFiles SET Purpose = N'asset' WHERE Id = @id");
    // Page size in screen pixels (96 DPI) from the 150-DPI picture.
    canvas.pages.push({
      id: `page-${i + 1}`,
      width: Math.round((images[i].width * 96) / 150),
      height: Math.round((images[i].height * 96) / 150),
      background: '#ffffff',
      backgroundFileId: stored.id,
      elements: [],
    });
  }

  const name = baseName(pdf.name).slice(0, 150);
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let templateId: number;
  try {
    const inserted = await transaction
      .request()
      .input('accountId', sql.Int, accountId)
      .input('name', sql.NVarChar(150), name.length >= 2 ? name : `PDF ${name}`)
      .input('description', sql.NVarChar(500), `Made from ${pdf.name}`.slice(0, 500))
      .input('userId', sql.Int, req.user!.userId)
      .query<{ id: number }>(`
        INSERT INTO dbo.Templates (AccountId, Name, Description, CurrentVersionNo, CreatedById)
        OUTPUT INSERTED.Id AS id VALUES (@accountId, @name, @description, 1, @userId)
      `);
    templateId = inserted.recordset[0].id;
    await transaction
      .request()
      .input('id', sql.Int, templateId)
      .input('canvas', sql.NVarChar(sql.MAX), JSON.stringify(canvas))
      .input('userId', sql.Int, req.user!.userId)
      .query(`INSERT INTO dbo.TemplateVersions (TemplateId, VersionNo, CanvasJson, FieldsJson, CreatedById) VALUES (@id, 1, @canvas, N'[]', @userId)`);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  await auditRequest(req, 'TEMPLATE_CREATED', 'Template', templateId, { name, from: 'pdf' });
  res.status(201).json({ templateId, pages: images.length });
});
