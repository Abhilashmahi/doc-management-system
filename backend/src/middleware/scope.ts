import type { NextFunction, Request, Response } from 'express';
import { getPool, sql } from '../db/pool.js';
import type { SessionUser } from '../services/sessions.js';
import { HttpError } from '../utils/http-error.js';

// Which office (account) a request works on.
// Normal users always work on their own office. The Master Admin has no office of their own, so the frontend
// sends the chosen office in the X-Account-Id header. Without it, the Master Admin sees every office (read only).
export interface Scope {
  accountId: number | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    scope?: Scope;
  }
}

// Use after requireAuth.
export async function resolveScope(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    if (user.role !== 'MasterAdmin') {
      if (user.accountId === null) throw new HttpError(403, 'Your user is not linked to an office.');
      req.scope = { accountId: user.accountId };
      return next();
    }

    const raw = req.get('x-account-id');
    if (!raw) {
      req.scope = { accountId: null };
      return next();
    }
    const accountId = Number(raw);
    if (!Number.isInteger(accountId) || accountId <= 0) throw new HttpError(400, 'The selected office is not valid.');
    const pool = await getPool();
    const found = await pool.request().input('id', sql.Int, accountId).query('SELECT 1 AS ok FROM dbo.Accounts WHERE Id = @id');
    if (found.recordset.length === 0) throw new HttpError(400, 'The selected office no longer exists. Choose another one.');
    req.scope = { accountId };
    next();
  } catch (error) {
    next(error);
  }
}

// Changes need one specific office. The Master Admin must pick one in the top bar first.
export function requireAccountId(req: Request): number {
  const accountId = req.scope?.accountId ?? null;
  if (accountId === null) throw new HttpError(400, 'Choose an office in the top bar first.');
  return accountId;
}

const MANAGERS: SessionUser['role'][] = ['MasterAdmin', 'Admin'];
const EDITORS: SessionUser['role'][] = ['MasterAdmin', 'Admin', 'Editor'];

export function canManage(user: SessionUser): boolean {
  return MANAGERS.includes(user.role);
}

export function canEdit(user: SessionUser): boolean {
  return EDITORS.includes(user.role);
}

export function assertCanManage(req: Request): void {
  if (!canManage(req.user!)) throw new HttpError(403, 'Only administrators can do this.');
}

export function assertCanEdit(req: Request): void {
  if (!canEdit(req.user!)) throw new HttpError(403, 'Viewers cannot make changes. Ask an administrator for Editor access.');
}

// Parses a numeric route id such as /documents/:id and rejects anything else.
export function idParam(req: Request, name = 'id'): number {
  const value = Number(req.params[name]);
  if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, 'Invalid id.');
  return value;
}
