import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { emailEnabled, publicUrl } from '../config/env.js';
import { getPool, sql } from '../db/pool.js';
import { assertCanEdit, idParam, requireAccountId } from '../middleware/scope.js';
import { auditRequest } from '../services/audit.js';
import { extensionOf, readStoredFile, sendStoredFile, storeGeneratedFile } from '../services/files.js';
import { emailSender, mailErrorMessage, sendMail } from '../services/mailer.js';
import { HttpError } from '../utils/http-error.js';
import { loadDocument, type DocumentRow } from './documents.js';

// Sharing a document outside the app: by e-mail with the file attached (Gmail or any SMTP account), and by
// secret download links that can be pasted into WhatsApp or anywhere else. WhatsApp itself is opened by the
// browser (see the frontend's ShareDialog); WhatsApp has no free way for a server to send files.

export const shareRouter = Router();
export const publicShareRouter = Router();

const MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024; // Gmail accepts up to 25 MB per message, encoding included.

// Designed documents have no stored file: the browser builds the PDF (exactly what Export makes) and sends it along.
const generatedUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } }).single('file');

function receiveOptionalFile(req: Request, res: Response): Promise<Express.Multer.File | undefined> {
  return new Promise((resolve, reject) => {
    generatedUpload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') reject(new HttpError(400, 'The file is larger than 24 MB, which is too big to share.'));
      else if (error) reject(error instanceof multer.MulterError ? new HttpError(400, error.message) : error);
      else resolve(req.file);
    });
  });
}

function looksLikePdfOrImage(data: Buffer): 'pdf' | 'png' | 'jpg' | null {
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  return null;
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 120) || 'document';
}

// The bytes to share: the document's current file, or the PDF the browser built for a designed document.
async function documentFile(doc: DocumentRow, upload: Express.Multer.File | undefined): Promise<{ data: Buffer; fileName: string }> {
  if (doc.fileId) {
    const file = await readStoredFile(doc.fileId, doc.accountId);
    const ext = doc.fileName ? extensionOf(doc.fileName) : extensionOf(file.name);
    return { data: file.data, fileName: ext ? `${safeName(doc.name)}.${ext}` : file.name };
  }
  if (!upload) throw new HttpError(400, 'This designed document needs its PDF. Reload the page and try again.');
  const kind = looksLikePdfOrImage(upload.buffer);
  if (!kind) throw new HttpError(400, 'Only a PDF, PNG or JPEG of the document can be shared.');
  return { data: upload.buffer, fileName: `${safeName(doc.name)}.${kind}` };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------- Signed-in routes ----------

shareRouter.get('/status', (_req, res) => {
  res.json({ emailEnabled, emailFrom: emailSender(), publicUrl, publicUrlIsLocal: /\/\/(localhost|127\.|\[::1\])/.test(publicUrl) });
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => `share-email-${req.user!.userId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'You have sent many e-mails in the last hour. Please wait a while.' },
});

const emailList = z
  .string()
  .trim()
  .min(1, 'Enter at least one e-mail address.')
  .transform((s) => s.split(/[,;\s]+/).filter(Boolean))
  .pipe(z.array(z.email('One of the e-mail addresses is not valid.')).min(1).max(10, 'Send to at most 10 people at once.'));

// Sends the document as an e-mail attachment.
shareRouter.post('/documents/:id/email', emailLimiter, async (req, res) => {
  assertCanEdit(req);
  requireAccountId(req);
  if (!emailEnabled) throw new HttpError(503, 'E-mail sending is not set up. An administrator must add SMTP_USER and SMTP_PASSWORD to backend/.env.');
  const doc = await loadDocument(req, idParam(req));
  const upload = await receiveOptionalFile(req, res);
  const body = z
    .object({
      to: emailList,
      subject: z.string().trim().min(1, 'Enter a subject.').max(200),
      message: z.string().max(5000).default(''),
    })
    .parse(req.body ?? {});
  const file = await documentFile(doc, upload);
  if (file.data.length > MAX_ATTACHMENT_BYTES) throw new HttpError(400, 'The file is larger than 24 MB, which Gmail does not accept. Use a share link instead.');

  // Replies go to the person who shared, when their account has an e-mail address.
  const pool = await getPool();
  const me = await pool.request().input('id', sql.Int, req.user!.userId).query<{ email: string | null }>('SELECT Email AS email FROM dbo.Users WHERE Id = @id');

  try {
    await sendMail({
      to: body.to,
      subject: body.subject,
      text: `${body.message.trim()}\n\n— Sent by ${req.user!.fullName} from the e-Sevai Document Manager.`.trim(),
      replyTo: me.recordset[0]?.email ?? undefined,
      attachment: file,
    });
  } catch (error) {
    console.error('E-mail send failed:', (error as { code?: string; responseCode?: number }).code ?? '', (error as Error).message);
    throw new HttpError(502, mailErrorMessage(error));
  }
  await auditRequest(req, 'DOCUMENT_SHARED', 'Document', doc.id, { channel: 'email', to: body.to, file: file.fileName }, doc.accountId);
  res.json({ sent: true, to: body.to });
});

const linkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => `share-link-${req.user!.userId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'You have made many share links in the last hour. Please wait a while.' },
});

// Makes a secret download link. The link itself is shown once; only its hash is stored.
shareRouter.post('/documents/:id/links', linkLimiter, async (req, res) => {
  assertCanEdit(req);
  const accountId = requireAccountId(req);
  const doc = await loadDocument(req, idParam(req));
  const upload = await receiveOptionalFile(req, res);
  const { days } = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) }).parse(req.body ?? {});

  // A designed document's PDF is stored, so the link keeps giving the version that was shared.
  let fileId = doc.fileId;
  if (!fileId) {
    const file = await documentFile(doc, upload);
    fileId = (await storeGeneratedFile(file.data, file.fileName, { accountId, userId: req.user!.userId })).id;
  }

  const token = randomBytes(24).toString('base64url');
  const pool = await getPool();
  const result = await pool
    .request()
    .input('accountId', sql.Int, doc.accountId)
    .input('documentId', sql.Int, doc.id)
    .input('fileId', sql.Int, fileId)
    .input('hash', sql.Char(64), hashToken(token))
    .input('userId', sql.Int, req.user!.userId)
    .input('days', sql.Int, days)
    .query<{ id: number; expiresAt: Date }>(`
      INSERT INTO dbo.ShareLinks (AccountId, DocumentId, FileId, TokenHash, CreatedById, ExpiresAt)
      OUTPUT INSERTED.Id AS id, INSERTED.ExpiresAt AS expiresAt
      VALUES (@accountId, @documentId, @fileId, @hash, @userId, DATEADD(DAY, @days, SYSUTCDATETIME()))
    `);
  const link = result.recordset[0];
  await auditRequest(req, 'DOCUMENT_SHARED', 'Document', doc.id, { channel: 'link', days, linkId: link.id }, doc.accountId);
  res.status(201).json({ id: link.id, url: `${publicUrl}/api/public/share/${token}`, expiresAt: link.expiresAt });
});

shareRouter.get('/documents/:id/links', async (req, res) => {
  const doc = await loadDocument(req, idParam(req));
  const pool = await getPool();
  const result = await pool
    .request()
    .input('documentId', sql.Int, doc.id)
    .query(`
      SELECT l.Id AS id, l.CreatedAt AS createdAt, l.ExpiresAt AS expiresAt, l.DownloadCount AS downloadCount,
             l.LastDownloadedAt AS lastDownloadedAt, u.FullName AS createdByName
      FROM dbo.ShareLinks l JOIN dbo.Users u ON u.Id = l.CreatedById
      WHERE l.DocumentId = @documentId AND l.RevokedAt IS NULL AND l.ExpiresAt > SYSUTCDATETIME()
      ORDER BY l.CreatedAt DESC
    `);
  res.json({ links: result.recordset });
});

// Turns a link off at once.
shareRouter.delete('/links/:id', async (req, res) => {
  assertCanEdit(req);
  const pool = await getPool();
  const found = await pool
    .request()
    .input('id', sql.Int, idParam(req))
    .input('accountId', sql.Int, req.scope!.accountId)
    .query<{ documentId: number; accountId: number }>(
      'SELECT DocumentId AS documentId, AccountId AS accountId FROM dbo.ShareLinks WHERE Id = @id AND RevokedAt IS NULL AND (@accountId IS NULL OR AccountId = @accountId)',
    );
  const link = found.recordset[0];
  if (!link) throw new HttpError(404, 'Share link not found.');
  await pool.request().input('id', sql.Int, idParam(req)).query('UPDATE dbo.ShareLinks SET RevokedAt = SYSUTCDATETIME() WHERE Id = @id');
  await auditRequest(req, 'SHARE_LINK_REVOKED', 'Document', link.documentId, { linkId: idParam(req) }, link.accountId);
  res.status(204).end();
});

// Records a share the browser did by itself (WhatsApp, Gmail compose, the device's share menu), for the activity log.
shareRouter.post('/documents/:id/record', async (req, res) => {
  const doc = await loadDocument(req, idParam(req));
  const { channel } = z.object({ channel: z.enum(['whatsapp', 'gmail', 'device']) }).parse(req.body);
  await auditRequest(req, 'DOCUMENT_SHARED', 'Document', doc.id, { channel }, doc.accountId);
  res.status(204).end();
});

// ---------- Public download (no sign-in) ----------

const downloadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: 'Too many downloads. Please wait a minute.' });

publicShareRouter.get('/:token', downloadLimiter, async (req, res) => {
  const token = String(req.params.token);
  const pool = await getPool();
  const found = token.length > 20 && token.length < 100
    ? await pool
        .request()
        .input('hash', sql.Char(64), hashToken(token))
        .query<{ id: number; fileId: number; accountId: number; name: string; fileName: string | null }>(`
          SELECT l.Id AS id, l.FileId AS fileId, l.AccountId AS accountId, d.Name AS name, f.OriginalName AS fileName
          FROM dbo.ShareLinks l
          JOIN dbo.Documents d ON d.Id = l.DocumentId
          JOIN dbo.StoredFiles f ON f.Id = l.FileId
          WHERE l.TokenHash = @hash AND l.RevokedAt IS NULL AND l.ExpiresAt > SYSUTCDATETIME() AND d.DeletedAt IS NULL
        `)
    : null;
  const link = found?.recordset[0];
  if (!link) {
    res.status(404).type('text/plain; charset=utf-8').send('This share link has expired or was turned off. Ask the sender for a new one.');
    return;
  }
  await pool.request().input('id', sql.Int, link.id).query('UPDATE dbo.ShareLinks SET DownloadCount = DownloadCount + 1, LastDownloadedAt = SYSUTCDATETIME() WHERE Id = @id');
  const ext = link.fileName ? extensionOf(link.fileName) : '';
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  await sendStoredFile(res, link.fileId, link.accountId, { downloadName: ext ? `${safeName(link.name)}.${ext}` : undefined });
});
