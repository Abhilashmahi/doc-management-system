import { createHash, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import multer from 'multer';
import { getPool, sql } from '../db/pool.js';
import { HttpError } from '../utils/http-error.js';
import { ANY_TYPE, BLOCKED_EXTENSIONS, KNOWN_EXTENSIONS, extensionOf, formatOf, inlineContentType, mimeForExtension } from './formats.js';
import { getAppSettings } from './settings.js';
import { storage } from './storage.js';

export { extensionOf, mimeForExtension };

// File types an administrator can switch on in Settings, plus "*" for any other (non-blocked) type.
export const SUPPORTED_EXTENSIONS = [...KNOWN_EXTENSIONS, ANY_TYPE];
const ASSET_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

// Reads one multipart file field named "file" into memory, within the configured size limit.
export async function receiveUpload(req: Request, res: Response): Promise<Express.Multer.File> {
  const settings = await getAppSettings();
  const maxBytes = settings.maxUploadMb * 1024 * 1024;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } }).single('file');
  await new Promise<void>((resolve, reject) => {
    upload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        reject(new HttpError(413, `The file is larger than the ${settings.maxUploadMb} MB limit.`));
      } else if (error) {
        reject(error instanceof multer.MulterError ? new HttpError(400, error.message) : error);
      } else {
        resolve();
      }
    });
  });
  if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
  return req.file;
}

// Reads several files from the multipart field "files" (used by the PDF tools).
export async function receiveUploads(req: Request, res: Response, maxFiles: number): Promise<Express.Multer.File[]> {
  const settings = await getAppSettings();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: settings.maxUploadMb * 1024 * 1024, files: maxFiles } }).array('files', maxFiles);
  await new Promise<void>((resolve, reject) => {
    upload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') reject(new HttpError(413, `Each file can be at most ${settings.maxUploadMb} MB.`));
        else if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') reject(new HttpError(400, `Choose at most ${maxFiles} files at a time.`));
        else reject(new HttpError(400, error.message));
      } else if (error) reject(error);
      else resolve();
    });
  });
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw new HttpError(400, 'Choose at least one file.');
  for (const f of files) f.originalname = Buffer.from(f.originalname, 'latin1').toString('utf8');
  return files;
}

export interface StoredFile {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

function cleanFileName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 260);
}

// Validates an uploaded file's type against the settings and its real content, then stores it.
export async function storeFile(
  file: Express.Multer.File,
  options: { accountId: number; userId: number; purpose: 'document' | 'asset' },
): Promise<StoredFile> {
  // Browsers send the name as Latin-1 bytes; turn it back into readable UTF-8 text.
  const originalName = cleanFileName(Buffer.from(file.originalname, 'latin1').toString('utf8'));
  const ext = extensionOf(originalName);
  const settings = await getAppSettings();

  if (BLOCKED_EXTENSIONS.includes(ext)) {
    throw new HttpError(400, `.${ext} files are programs or scripts, and they are never accepted for safety.`);
  }
  if (options.purpose === 'asset') {
    if (!ASSET_EXTENSIONS.includes(ext)) throw new HttpError(400, `Designs can use these image types: ${ASSET_EXTENSIONS.join(', ')}.`);
  } else {
    const anyAllowed = settings.allowedFileTypes.includes(ANY_TYPE);
    const listed = settings.allowedFileTypes.includes(ext);
    if (!listed && !(anyAllowed && ext)) {
      const allowed = settings.allowedFileTypes.filter((t) => t !== ANY_TYPE).join(', ');
      throw new HttpError(400, `This file type is not allowed. Allowed types: ${allowed}${anyAllowed ? ', and any other type with an extension' : ''}.`);
    }
  }
  if (file.size === 0) throw new HttpError(400, 'The file is empty.');
  // Known types must really be that type, so a renamed program cannot be uploaded as "photo.png".
  const format = formatOf(ext);
  if (format && !format.matches(file.buffer)) {
    throw new HttpError(400, `The file content does not match its .${ext} extension.`);
  }

  return saveBytes(file.buffer, originalName, { ...options, ext });
}

// Stores bytes the server produced itself (for example a converted file). The type is already known to be right.
export async function storeGeneratedFile(
  data: Buffer,
  fileName: string,
  options: { accountId: number; userId: number },
): Promise<StoredFile> {
  const name = cleanFileName(fileName);
  return saveBytes(data, name, { ...options, purpose: 'document', ext: extensionOf(name) });
}

async function saveBytes(
  data: Buffer,
  originalName: string,
  options: { accountId: number; userId: number; purpose: 'document' | 'asset'; ext: string },
): Promise<StoredFile> {
  const pool = await getPool();
  const usage = await pool
    .request()
    .input('accountId', sql.Int, options.accountId)
    .query<{ used: number; limit: number }>(`
      SELECT CAST(ISNULL((SELECT SUM(SizeBytes) FROM dbo.StoredFiles WHERE AccountId = @accountId), 0) AS BIGINT) AS used,
             StorageLimitBytes AS limit
      FROM dbo.Accounts WHERE Id = @accountId
    `);
  const { used, limit } = usage.recordset[0];
  if (Number(used) + data.length > Number(limit)) {
    throw new HttpError(413, 'This office has reached its storage limit. Ask an administrator to raise it.');
  }

  const now = new Date();
  // Unknown types are stored without an extension, so the stored name can never be opened as a program on the server.
  const suffix = formatOf(options.ext) ? `.${options.ext}` : '.bin';
  const key = `${options.accountId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${suffix}`;
  const sha256 = createHash('sha256').update(data).digest('hex');
  await storage.put(key, data);

  try {
    const inserted = await pool
      .request()
      .input('accountId', sql.Int, options.accountId)
      .input('purpose', sql.NVarChar(20), options.purpose)
      .input('key', sql.NVarChar(400), key)
      .input('name', sql.NVarChar(260), originalName)
      .input('mime', sql.NVarChar(150), mimeForExtension(options.ext))
      .input('size', sql.BigInt, data.length)
      .input('sha', sql.Char(64), sha256)
      .input('userId', sql.Int, options.userId)
      .query<{ id: number }>(`
        INSERT INTO dbo.StoredFiles (AccountId, Purpose, StorageKey, OriginalName, MimeType, SizeBytes, Sha256, CreatedById)
        OUTPUT INSERTED.Id AS id
        VALUES (@accountId, @purpose, @key, @name, @mime, @size, @sha, @userId)
      `);
    return { id: inserted.recordset[0].id, originalName, mimeType: mimeForExtension(options.ext), sizeBytes: data.length };
  } catch (error) {
    // Do not leave orphan bytes on disk when the database insert fails.
    await storage.remove(key).catch(() => undefined);
    throw error;
  }
}

interface FileRow {
  StorageKey: string;
  OriginalName: string;
  MimeType: string;
  SizeBytes: number;
}

async function findFile(fileId: number, accountId: number | null): Promise<FileRow> {
  const pool = await getPool();
  const found = await pool
    .request()
    .input('id', sql.Int, fileId)
    .input('accountId', sql.Int, accountId)
    .query<FileRow>(`
      SELECT StorageKey, OriginalName, MimeType, SizeBytes FROM dbo.StoredFiles
      WHERE Id = @id AND (@accountId IS NULL OR AccountId = @accountId)
    `);
  const row = found.recordset[0];
  if (!row) throw new HttpError(404, 'File not found.');
  return row;
}

// Reads a stored file fully into memory (used by conversions). accountId keeps offices apart.
export async function readStoredFile(fileId: number, accountId: number | null): Promise<{ data: Buffer; name: string; sizeBytes: number }> {
  const row = await findFile(fileId, accountId);
  let stream;
  try {
    stream = await storage.open(row.StorageKey);
  } catch {
    throw new HttpError(410, 'The file is missing from storage. Ask an administrator to check the storage folder.');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { data: Buffer.concat(chunks), name: row.OriginalName, sizeBytes: Number(row.SizeBytes) };
}

// Streams a stored file to the browser. accountId is checked here, so one office can never read another office's files.
export async function sendStoredFile(
  res: Response,
  fileId: number,
  accountId: number | null,
  options: { inline?: boolean; downloadName?: string } = {},
): Promise<void> {
  const row = await findFile(fileId, accountId);

  let stream;
  try {
    stream = await storage.open(row.StorageKey);
  } catch {
    throw new HttpError(410, 'The file is missing from storage. Ask an administrator to check the storage folder.');
  }

  // Only types that are safe to display are shown inline; text-like files are sent as plain text.
  // Everything else (including HTML and SVG, which can contain scripts) is always downloaded.
  const inlineType = options.inline ? inlineContentType(extensionOf(row.OriginalName)) : null;
  if (inlineType) {
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Type', inlineType);
  } else {
    // res.attachment also guesses a Content-Type, so the stored type is set after it.
    res.attachment(options.downloadName ?? row.OriginalName);
    res.setHeader('Content-Type', formatOf(extensionOf(row.OriginalName)) ? row.MimeType : 'application/octet-stream');
  }
  res.setHeader('Content-Length', String(row.SizeBytes));
  res.setHeader('Cache-Control', 'private, max-age=300');
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
