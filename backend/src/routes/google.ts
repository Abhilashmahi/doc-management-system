import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env, googleEnabled, isProduction } from '../config/env.js';
import { getPool, sql } from '../db/pool.js';
import { setSessionCookie } from '../middleware/auth.js';
import { createAccountWithAdmin } from '../services/accounts.js';
import { writeAudit } from '../services/audit.js';
import { createSession } from '../services/sessions.js';
import { isSelfSignupEnabled } from '../services/settings.js';
import { HttpError } from '../utils/http-error.js';

// Google sign-in and sign-up, using the OAuth "authorization code with PKCE" flow.
// Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env to turn it on (see README).
export const googleRouter = Router();

// A short-lived cookie remembers the attempt (state, PKCE verifier, mode) between the two Google redirects.
const OAUTH_COOKIE = 'esevai_google_oauth';
const OAUTH_COOKIE_PATH = '/api/auth/google';
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const startSchema = z.object({
  mode: z.enum(['signin', 'signup']),
  accountName: z.string().trim().max(150).optional(),
});

const oauthStateSchema = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  mode: z.enum(['signin', 'signup']),
  accountName: z.string().min(2).max(150).optional(),
});
type OAuthState = z.infer<typeof oauthStateSchema>;

interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

// A failure with a short reason code. The sign-in page turns the code into a message (see LandingPage.tsx).
class GoogleSignInError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

function googleCredentials(): GoogleCredentials | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

// Sends the browser back to the sign-in page with a reason code. Google's redirects are page visits, so JSON errors would be unreadable here.
function backToSignIn(res: Response, reason: string): void {
  res.redirect(`${env.FRONTEND_URL}/?authError=${encodeURIComponent(reason)}`);
}

function readOAuthCookie(raw: unknown): OAuthState | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = oauthStateSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Step 1: send the browser to Google. The random state and the PKCE challenge stop anyone else from finishing this sign-in.
googleRouter.get('/start', (req, res) => {
  if (!googleCredentials()) return backToSignIn(res, 'google_not_configured');

  const parsed = startSchema.safeParse(req.query);
  if (!parsed.success) return backToSignIn(res, 'google_failed');
  const { mode, accountName } = parsed.data;
  if (mode === 'signup' && (!accountName || accountName.length < 2)) return backToSignIn(res, 'google_office_name');

  const oauth: OAuthState = {
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    mode,
    accountName: mode === 'signup' ? accountName : undefined,
  };
  const challenge = createHash('sha256').update(oauth.verifier).digest('base64url');

  res.cookie(OAUTH_COOKIE, Buffer.from(JSON.stringify(oauth)).toString('base64url'), {
    httpOnly: true,
    // Lax (not strict) so the browser still sends this cookie when Google redirects back to us.
    sameSite: 'lax',
    secure: isProduction,
    path: OAUTH_COOKIE_PATH,
    maxAge: 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state: oauth.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  res.redirect(`${GOOGLE_AUTHORIZE_URL}?${params.toString()}`);
});

// Step 2: Google sends the browser back here with a one-time code. Check the state, read the verified profile, then sign in or create the account.
googleRouter.get('/callback', async (req: Request, res: Response) => {
  const raw = req.cookies?.[OAUTH_COOKIE];
  res.clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });

  const credentials = googleCredentials();
  if (!credentials) return backToSignIn(res, 'google_not_configured');
  if (typeof req.query.error === 'string') return backToSignIn(res, 'google_cancelled');

  const oauth = readOAuthCookie(raw);
  if (!oauth) return backToSignIn(res, 'google_expired');
  if (typeof req.query.code !== 'string' || req.query.state !== oauth.state) return backToSignIn(res, 'google_failed');

  try {
    const profile = await exchangeCodeForProfile(req.query.code, oauth.verifier, credentials);
    const { userId, accountId, isNewAccount } = await signInOrCreateAccount(profile, oauth);

    const ip = req.ip ?? null;
    const session = await createSession(userId, ip, req.get('user-agent') ?? null);
    setSessionCookie(res, session.token, session.expiresAt, 'lax');
    await writeAudit(
      isNewAccount
        ? { accountId, userId, action: 'ACCOUNT_CREATED', entityType: 'Account', entityId: String(accountId), ipAddress: ip }
        : { accountId, userId, action: 'LOGIN_SUCCESS', ipAddress: ip },
    );

    res.redirect(`${env.FRONTEND_URL}/`);
  } catch (error) {
    if (error instanceof GoogleSignInError) return backToSignIn(res, error.reason);
    if (error instanceof HttpError && error.status === 409) return backToSignIn(res, 'google_conflict');
    // Log the reason on the server only. Tokens and profile details are never logged.
    console.error('Google sign-in failed:', error instanceof Error ? error.message : error);
    backToSignIn(res, 'google_failed');
  }
});

// Swaps the one-time code for an access token, then reads the profile with it. Both calls go straight to Google over HTTPS.
async function exchangeCodeForProfile(code: string, verifier: string, credentials: GoogleCredentials): Promise<GoogleProfile> {
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Google token request failed with status ${tokenResponse.status}`);
  const tokens = (await tokenResponse.json()) as { access_token?: unknown };
  const accessToken = tokens.access_token;
  if (typeof accessToken !== 'string') throw new Error('Google token response had no access token');

  const infoResponse = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!infoResponse.ok) throw new Error(`Google profile request failed with status ${infoResponse.status}`);
  const info = (await infoResponse.json()) as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };
  const sub = info.sub;
  const email = info.email;
  if (typeof sub !== 'string' || typeof email !== 'string') throw new Error('Google profile had no id or email');
  if (info.email_verified !== true) throw new GoogleSignInError('google_email_unverified');

  const cleanEmail = email.trim().toLowerCase();
  const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim().slice(0, 150) : cleanEmail;
  return { sub, email: cleanEmail, name };
}

// Finds the user who owns this Google account. If none exists and the visitor chose "Create account", creates a new office account.
async function signInOrCreateAccount(
  profile: GoogleProfile,
  oauth: OAuthState,
): Promise<{ userId: number; accountId: number | null; isNewAccount: boolean }> {
  const pool = await getPool();
  const found = await pool
    .request()
    .input('sub', sql.NVarChar(255), profile.sub)
    .query<{ Id: number; AccountId: number | null; IsActive: boolean; AccountActive: boolean | null }>(`
      SELECT u.Id, u.AccountId, u.IsActive, a.IsActive AS AccountActive
      FROM dbo.Users u
      LEFT JOIN dbo.Accounts a ON a.Id = u.AccountId
      WHERE u.GoogleSubject = @sub
    `);
  const existing = found.recordset[0];
  if (existing) {
    if (!existing.IsActive || existing.AccountActive === false) throw new GoogleSignInError('google_deactivated');
    return { userId: existing.Id, accountId: existing.AccountId, isNewAccount: false };
  }

  if (oauth.mode === 'signin') throw new GoogleSignInError('google_no_account');
  if (!oauth.accountName) throw new GoogleSignInError('google_office_name');
  if (!(await isSelfSignupEnabled())) throw new GoogleSignInError('google_signup_disabled');

  // The Google address becomes the username and the email. Google has already confirmed that the address is real.
  const created = await createAccountWithAdmin({
    accountName: oauth.accountName,
    username: profile.email,
    email: profile.email,
    fullName: profile.name,
    passwordHash: null,
    googleSubject: profile.sub,
  });
  return { ...created, isNewAccount: true };
}
