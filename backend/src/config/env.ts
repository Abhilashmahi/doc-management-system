import 'dotenv/config';
import { z } from 'zod';

// Every setting comes from the environment (.env file locally).
// Nothing secret is hardcoded in source code.
// Accepts only the text 'true' or 'false' from .env and turns it into a real boolean.
const booleanFromString = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DB_SERVER: z.string().min(1, 'DB_SERVER is required, e.g. ABHILASH\\SQLEXPRESS'),
  // Optional. Connects straight to this TCP port instead of asking the SQL Server Browser service for it.
  DB_PORT: z.coerce.number().int().positive().optional(),
  DB_NAME: z.string().min(1).default('ESevaiDocumentManager'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required (set it in backend/.env)'),
  DB_ENCRYPT: booleanFromString('true'),
  DB_TRUST_SERVER_CERTIFICATE: booleanFromString('false'),

  // Folder for uploaded files when the local storage provider is used. Relative paths start from the backend folder.
  STORAGE_DIR: z.string().min(1).default('storage'),
  // Optional. Full path to LibreOffice's soffice.exe, if it is installed somewhere unusual.
  SOFFICE_PATH: z.string().optional(),

  SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // Google sign-in is optional. It turns on only when both the client ID and the client secret are set.
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:5173/api/auth/google/callback'),

  // Sharing. PUBLIC_URL is the address other people use to open the app (share links start with it).
  PUBLIC_URL: z.string().optional(),
  // E-mail sending (optional). For Gmail: SMTP_USER is the Gmail address and SMTP_PASSWORD a 16-letter App Password.
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_NAME: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Print the variable names and problems only. Never print values, because they may be secrets.
  const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  console.error('Configuration error. Check backend/.env (copy backend/.env.example first):');
  console.error(problems.join('\n'));
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const emailEnabled = Boolean(parsed.data.SMTP_USER && parsed.data.SMTP_PASSWORD);
export const publicUrl = (parsed.data.PUBLIC_URL || parsed.data.FRONTEND_URL).replace(/\/+$/, '');
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
