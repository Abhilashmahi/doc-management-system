import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/http-error.js';

// Turns every error into a JSON reply. Stack traces and database details are logged on the server only,
// never sent to the browser, so SQL text or connection strings cannot leak.
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Some fields are invalid. Please check the form.',
      details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }
  console.error(`[${req.method} ${req.path}] Unexpected error:`, error instanceof Error ? error.stack : error);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
}
