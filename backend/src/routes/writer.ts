import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { auditRequest } from '../services/audit.js';
import { htmlToPdf } from '../services/html-pdf.js';
import { HttpError } from '../utils/http-error.js';

// The Writer's "Download as PDF": the browser sends the finished page (HTML, pictures included) and gets a PDF back.
// Nothing is stored.

export const writerRouter = Router();

const MAX_HTML_BYTES = 40 * 1024 * 1024;
const htmlUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_HTML_BYTES, files: 1 } }).single('html');

function receiveHtml(req: Request, res: Response): Promise<string> {
  return new Promise((resolve, reject) => {
    htmlUpload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') reject(new HttpError(413, 'This document is too large to turn into a PDF (more than 40 MB, usually because of big pictures).'));
      else if (error) reject(error instanceof multer.MulterError ? new HttpError(400, error.message) : error);
      else if (!req.file) reject(new HttpError(400, 'The page to turn into a PDF is missing.'));
      else resolve(req.file.buffer.toString('utf8'));
    });
  });
}

writerRouter.post('/pdf', async (req, res) => {
  const html = await receiveHtml(req, res);
  const pdf = await htmlToPdf(html);
  const title = String(req.body?.title ?? 'Document').slice(0, 150);
  await auditRequest(req, 'WRITER_PDF_MADE', 'Writer', 'pdf', { title, bytes: pdf.length });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="document.pdf"');
  res.send(pdf);
});
