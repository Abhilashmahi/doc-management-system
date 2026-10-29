import { z } from 'zod';
import { hashPassword } from '../services/passwords.js';
import { closePool, getPool, sql } from './pool.js';

// Creates the first Master Admin account. Values come from backend/.env (ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME).
// If ADMIN_USERNAME is not set, the admin signs in with ADMIN_EMAIL instead.
// It does nothing if a Master Admin already exists, so it is safe to run twice.
const seedSchema = z.object({
  ADMIN_USERNAME: z.string().trim().min(1).max(256).optional(),
  ADMIN_EMAIL: z.email('ADMIN_EMAIL must be a valid email address.'),
  ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD must be at least 12 characters long.'),
  ADMIN_NAME: z.string().min(2).default('Master Administrator'),
});

async function main(): Promise<void> {
  const input = seedSchema.parse({
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || undefined,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_NAME: process.env.ADMIN_NAME,
  });
  const username = (input.ADMIN_USERNAME ?? input.ADMIN_EMAIL).toLowerCase();

  const pool = await getPool();
  const existing = await pool.request().query<{ total: number }>(
    "SELECT COUNT(*) AS total FROM dbo.Users WHERE Role = N'MasterAdmin'",
  );
  if (existing.recordset[0].total > 0) {
    console.log('A Master Admin already exists. Nothing was changed.');
    return;
  }

  const passwordHash = await hashPassword(input.ADMIN_PASSWORD);
  await pool
    .request()
    .input('username', sql.NVarChar(256), username)
    .input('email', sql.NVarChar(256), input.ADMIN_EMAIL.trim().toLowerCase())
    .input('fullName', sql.NVarChar(150), input.ADMIN_NAME)
    .input('hash', sql.NVarChar(512), passwordHash)
    .query(`
      INSERT INTO dbo.Users (AccountId, Username, Email, FullName, PasswordHash, Role)
      VALUES (NULL, @username, @email, @fullName, @hash, N'MasterAdmin')
    `);
  console.log(`Master Admin created with username "${username}". You can now sign in.`);
}

main()
  .catch((error: unknown) => {
    // Only the validation message or the driver reason is printed. The password is never printed.
    console.error('Could not create the Master Admin. Reason:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
