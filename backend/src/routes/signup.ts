import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { googleEnabled } from '../config/env.js';
import { setSessionCookie } from '../middleware/auth.js';
import { createAccountWithAdmin } from '../services/accounts.js';
import { writeAudit } from '../services/audit.js';
import { hashPassword } from '../services/passwords.js';
import { createSession } from '../services/sessions.js';
import { getAppSettings, isSelfSignupEnabled } from '../services/settings.js';
import { HttpError } from '../utils/http-error.js';

export const signupRouter = Router();

// Limits account creation per IP address, so one computer cannot create accounts in bulk.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-up attempts from this network. Please try again later.' },
});

const signupSchema = z.object({
  accountName: z.string().trim().min(2, 'Enter your office or organisation name.').max(150),
  fullName: z.string().trim().min(2, 'Enter your full name.').max(150),
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters long.')
    .max(50, 'Username can be at most 50 characters long.')
    .regex(/^[A-Za-z0-9._-]+$/, 'Username can use only letters, numbers, dots, underscores and hyphens.'),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters long.')
    .max(256)
    .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
    .regex(/[0-9]/, 'Password must contain at least one number.'),
});

// Tells the frontend which sign-up and sign-in options to show.
signupRouter.get('/options', async (_req, res, next) => {
  try {
    const settings = await getAppSettings();
    res.json({ selfSignupEnabled: settings.allowSelfSignup, googleEnabled, appName: settings.appName, brandColor: settings.brandColor });
  } catch (error) {
    next(error);
  }
});

signupRouter.post('/signup', signupLimiter, async (req, res, next) => {
  try {
    if (!(await isSelfSignupEnabled())) {
      throw new HttpError(403, 'Creating new accounts is turned off. Please ask your administrator.');
    }

    const body = signupSchema.parse(req.body);
    const username = body.username.trim().toLowerCase();
    const ip = req.ip ?? null;

    // Hash before opening the transaction, because hashing is slow and should not hold database locks.
    const passwordHash = await hashPassword(body.password);
    const { accountId, userId } = await createAccountWithAdmin({
      accountName: body.accountName,
      username,
      email: null,
      fullName: body.fullName,
      passwordHash,
      googleSubject: null,
    });

    const session = await createSession(userId, ip, req.get('user-agent') ?? null);
    setSessionCookie(res, session.token, session.expiresAt);
    await writeAudit({ accountId, userId, action: 'ACCOUNT_CREATED', entityType: 'Account', entityId: String(accountId), ipAddress: ip });

    res.status(201).json({
      user: {
        id: userId,
        username,
        fullName: body.fullName,
        role: 'Admin',
        accountId,
        accountName: body.accountName,
      },
    });
  } catch (error) {
    next(error);
  }
});
