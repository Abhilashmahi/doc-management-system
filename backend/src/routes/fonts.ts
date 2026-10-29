import { randomUUID } from 'node:crypto';
import fontkit from '@pdf-lib/fontkit';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { getPool, sql } from '../db/pool.js';
import { assertCanManage, idParam } from '../middleware/scope.js';
import { auditRequest } from '../services/audit.js';
import { storage } from '../services/storage.js';
import { HttpError } from '../utils/http-error.js';

// Fonts added to the website (Bamini, Latha, decorative Tamil fonts ...). Everyone signed in can list and load
// them; administrators add and remove them. They are shared by all offices, like fonts installed on a computer.

export const fontsRouter = Router();

const MAX_FONT_BYTES = 20 * 1024 * 1024;
const FORMATS = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' } as const;
type Format = keyof typeof FORMATS;

const fontUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FONT_BYTES, files: 1 } }).single('file');

function receiveFont(req: Request, res: Response): Promise<Express.Multer.File> {
  return new Promise((resolve, reject) => {
    fontUpload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') reject(new HttpError(413, 'Font files can be at most 20 MB.'));
      else if (error) reject(error instanceof multer.MulterError ? new HttpError(400, error.message) : error);
      else if (!req.file) reject(new HttpError(400, 'Choose a font file (.ttf, .otf, .woff or .woff2).'));
      else resolve(req.file);
    });
  });
}

// The real type of a font file, from its first bytes (the name can be wrong).
function formatOf(data: Buffer): Format | 'ttc' | null {
  const tag = data.subarray(0, 4);
  if (tag.equals(Buffer.from([0, 1, 0, 0])) || tag.toString('latin1') === 'true') return 'ttf';
  if (tag.toString('latin1') === 'OTTO') return 'otf';
  if (tag.toString('latin1') === 'wOFF') return 'woff';
  if (tag.toString('latin1') === 'wOF2') return 'woff2';
  if (tag.toString('latin1') === 'ttcf') return 'ttc';
  return null;
}

interface FontRow {
  id: number;
  family: string;
  fileName: string;
  format: Format;
  encoding: 'unicode' | 'bamini';
  sizeBytes: number;
  createdAt: Date;
}

fontsRouter.get('/', async (_req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .query<FontRow>('SELECT Id AS id, Family AS family, FileName AS fileName, Format AS format, Encoding AS encoding, SizeBytes AS sizeBytes, CreatedAt AS createdAt FROM dbo.Fonts ORDER BY Family');
  res.json({ fonts: result.recordset.map((f) => ({ ...f, url: `/api/fonts/${f.id}/file` })) });
});

fontsRouter.get('/:id/file', async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, idParam(req))
    .query<{ StorageKey: string; Format: Format }>('SELECT StorageKey, Format FROM dbo.Fonts WHERE Id = @id');
  const row = result.recordset[0];
  if (!row) throw new HttpError(404, 'Font not found.');
  let stream;
  try {
    stream = await storage.open(row.StorageKey);
  } catch {
    throw new HttpError(410, 'The font file is missing from storage.');
  }
  res.setHeader('Content-Type', FORMATS[row.Format]);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  stream.pipe(res);
});

fontsRouter.post('/', async (req, res) => {
  assertCanManage(req);
  const file = await receiveFont(req, res);
  const options = z
    .object({ family: z.string().trim().max(100).optional(), encoding: z.enum(['auto', 'unicode', 'bamini']).default('auto') })
    .parse(req.body ?? {});

  const format = formatOf(file.buffer);
  if (format === 'ttc') throw new HttpError(400, 'This is a font collection (.ttc). Browsers cannot use those; add the single .ttf file instead.');
  if (!format) throw new HttpError(400, 'This is not a font file. Add a .ttf, .otf, .woff or .woff2 file.');

  // Read the font's own name and whether it holds real Tamil letters.
  let family = options.family ?? '';
  let hasTamil = false;
  let hasLatin = true;
  try {
    const font = fontkit.create(file.buffer) as unknown as { familyName?: string; characterSet?: number[] };
    family ||= font.familyName ?? '';
    const chars = font.characterSet ?? [];
    hasTamil = chars.some((c) => c >= 0x0b80 && c <= 0x0bff);
    hasLatin = chars.some((c) => c >= 0x41 && c <= 0x7a);
  } catch {
    if (format !== 'woff2') throw new HttpError(400, 'This font file could not be read. It may be damaged.');
  }
  family = family.replace(/["'\\;{}<>]/g, '').trim();
  if (!family) family = file.originalname.replace(/\.[^.]+$/, '').replace(/["'\\;{}<>]/g, '').trim();
  if (!family) throw new HttpError(400, 'Give the font a name.');
  // English fonts and old Bamini-style Tamil fonts look the same from inside (no Tamil letters), so the person adding
  // the font says which it is. A font that holds real Tamil letters is always a Unicode font.
  const encoding = hasTamil || !hasLatin || options.encoding !== 'bamini' ? 'unicode' : 'bamini';

  const pool = await getPool();
  const exists = await pool.request().input('family', sql.NVarChar(100), family).query('SELECT 1 FROM dbo.Fonts WHERE Family = @family');
  if (exists.recordset.length > 0) throw new HttpError(409, `A font named "${family}" has already been added.`);

  const key = `fonts/${randomUUID()}.${format}`;
  await storage.put(key, file.buffer);
  const inserted = await pool
    .request()
    .input('family', sql.NVarChar(100), family)
    .input('fileName', sql.NVarChar(260), file.originalname.slice(0, 260))
    .input('format', sql.VarChar(10), format)
    .input('encoding', sql.VarChar(10), encoding)
    .input('key', sql.NVarChar(300), key)
    .input('size', sql.Int, file.size)
    .input('userId', sql.Int, req.user!.userId)
    .query<{ id: number }>(
      `INSERT INTO dbo.Fonts (Family, FileName, Format, Encoding, StorageKey, SizeBytes, CreatedById)
       OUTPUT INSERTED.Id AS id VALUES (@family, @fileName, @format, @encoding, @key, @size, @userId)`,
    );
  const id = inserted.recordset[0].id;
  await auditRequest(req, 'FONT_ADDED', 'Font', id, { family, encoding });
  res.status(201).json({ id, family, encoding, format, url: `/api/fonts/${id}/file` });
});

fontsRouter.delete('/:id', async (req, res) => {
  assertCanManage(req);
  const id = idParam(req);
  const pool = await getPool();
  const result = await pool.request().input('id', sql.Int, id).query<{ StorageKey: string; Family: string }>('DELETE FROM dbo.Fonts OUTPUT DELETED.StorageKey, DELETED.Family WHERE Id = @id');
  const row = result.recordset[0];
  if (!row) throw new HttpError(404, 'Font not found.');
  await storage.remove(row.StorageKey);
  await auditRequest(req, 'FONT_REMOVED', 'Font', id, { family: row.Family });
  res.status(204).end();
});

// A font file from storage, for the server's own PDF maker (services/html-pdf.ts).
export async function readFontFile(id: number): Promise<{ data: Buffer; contentType: string }> {
  const pool = await getPool();
  const result = await pool.request().input('id', sql.Int, id).query<{ StorageKey: string; Format: Format }>('SELECT StorageKey, Format FROM dbo.Fonts WHERE Id = @id');
  const row = result.recordset[0];
  if (!row) throw new HttpError(404, 'Font not found.');
  const chunks: Buffer[] = [];
  for await (const chunk of await storage.open(row.StorageKey)) chunks.push(chunk as Buffer);
  return { data: Buffer.concat(chunks), contentType: FORMATS[row.Format] };
}
