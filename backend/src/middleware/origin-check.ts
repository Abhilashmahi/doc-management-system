import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

// CSRF protection: change requests (POST, PUT, PATCH, DELETE) must come from our frontend when the browser sends an Origin header.
// Combined with the SameSite=Strict session cookie, this blocks cross-site form attacks.
export function checkOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== env.CORS_ORIGIN) {
    // Say exactly what went wrong, so the fix is obvious (usually: open the app on the allowed address).
    return next(
      new HttpError(
        403,
        `Request blocked: the app is open at ${origin}, but the API only accepts requests from ${env.CORS_ORIGIN}. Open the app at ${env.CORS_ORIGIN} instead.`,
      ),
    );
  }
  next();
}
