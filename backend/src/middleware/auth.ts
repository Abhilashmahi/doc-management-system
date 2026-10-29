import type { NextFunction, Request, Response } from 'express';
import { isProduction } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { findSessionUser, type SessionUser } from '../services/sessions.js';

export const SESSION_COOKIE = 'esevai_session';

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

// Sets the session cookie after a successful sign-in.
// Google sign-in uses 'lax', because browsers drop 'strict' cookies that arrive right after a redirect from another site.
export function setSessionCookie(res: Response, token: string, expiresAt: Date, sameSite: 'strict' | 'lax' = 'strict'): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite,
    secure: isProduction,
    path: '/',
    expires: expiresAt,
  });
}

// Reads the session cookie and loads the user from the database. Role information sent by the frontend is never trusted.
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      throw new HttpError(401, 'Please sign in to continue.');
    }
    const user = await findSessionUser(token);
    if (!user) {
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

// Use after requireAuth. Allows only the listed roles.
export function requireRole(...roles: SessionUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new HttpError(403, 'You do not have permission to do this.'));
      return;
    }
    next();
  };
}
