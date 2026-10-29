import { getPool, sql } from '../db/pool.js';
import { HttpError } from '../utils/http-error.js';

export interface NewAccountInput {
  accountName: string;
  username: string;
  email: string | null;
  fullName: string;
  passwordHash: string | null;
  googleSubject: string | null;
}

// SQL Server error numbers 2627 and 2601 mean "duplicate value in a unique column".
export function isDuplicateKeyError(error: unknown): boolean {
  const number = (error as { number?: number }).number;
  return number === 2627 || number === 2601;
}

// Starter categories and fields for a new office. Administrators can rename, extend or deactivate them later.
const DEFAULT_CATEGORIES = [
  'Birth Certificate',
  'Death Certificate',
  'Community Certificate',
  'Income Certificate',
  'Residence Certificate',
  'Nativity Certificate',
  'Other Documents',
];

const DEFAULT_FIELDS: { key: string; label: string; type: string; validation: Record<string, unknown> | null }[] = [
  { key: 'FullName', label: 'Full Name', type: 'text', validation: { required: true, maxLength: 150 } },
  { key: 'Age', label: 'Age', type: 'number', validation: { min: 0, max: 150 } },
  { key: 'DateOfBirth', label: 'Date of Birth', type: 'date', validation: null },
  { key: 'Gender', label: 'Gender', type: 'select', validation: { options: ['Male', 'Female', 'Transgender'] } },
  { key: 'ParentName', label: 'Parent or Guardian Name', type: 'text', validation: { maxLength: 150 } },
  { key: 'Address', label: 'Address', type: 'multiline', validation: { maxLength: 500 } },
  { key: 'CertificateNumber', label: 'Certificate Number', type: 'text', validation: { maxLength: 50 } },
  { key: 'RegistrationNumber', label: 'Registration Number', type: 'text', validation: { maxLength: 50 } },
  { key: 'IssueDate', label: 'Issue Date', type: 'date', validation: null },
];

// Adds the starter categories and fields inside the caller's transaction.
export async function seedAccountDefaults(transaction: sql.Transaction, accountId: number): Promise<void> {
  for (const name of DEFAULT_CATEGORIES) {
    await transaction
      .request()
      .input('accountId', sql.Int, accountId)
      .input('name', sql.NVarChar(150), name)
      .query('INSERT INTO dbo.DocumentCategories (AccountId, Name) VALUES (@accountId, @name)');
  }
  for (const field of DEFAULT_FIELDS) {
    await transaction
      .request()
      .input('accountId', sql.Int, accountId)
      .input('key', sql.NVarChar(60), field.key)
      .input('label', sql.NVarChar(150), field.label)
      .input('type', sql.NVarChar(20), field.type)
      .input('validation', sql.NVarChar(sql.MAX), field.validation ? JSON.stringify(field.validation) : null)
      .query(`
        INSERT INTO dbo.FieldDefinitions (AccountId, FieldKey, Label, DataType, ValidationJson)
        VALUES (@accountId, @key, @label, @type, @validation)
      `);
  }
}

// Creates the organisation and its first Admin user in one transaction.
// If either insert fails, neither is saved.
export async function createAccountWithAdmin(input: NewAccountInput): Promise<{ accountId: number; userId: number }> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const account = await transaction
      .request()
      .input('name', sql.NVarChar(150), input.accountName)
      .query<{ id: number }>('INSERT INTO dbo.Accounts (Name) OUTPUT INSERTED.Id AS id VALUES (@name)');
    const accountId = account.recordset[0].id;

    const user = await transaction
      .request()
      .input('accountId', sql.Int, accountId)
      .input('username', sql.NVarChar(256), input.username)
      .input('email', sql.NVarChar(256), input.email)
      .input('fullName', sql.NVarChar(150), input.fullName)
      .input('hash', sql.NVarChar(512), input.passwordHash)
      .input('googleSubject', sql.NVarChar(255), input.googleSubject)
      .query<{ id: number }>(`
        INSERT INTO dbo.Users (AccountId, Username, Email, FullName, PasswordHash, GoogleSubject, Role)
        OUTPUT INSERTED.Id AS id
        VALUES (@accountId, @username, @email, @fullName, @hash, @googleSubject, N'Admin')
      `);

    await seedAccountDefaults(transaction, accountId);
    await transaction.commit();
    return { accountId, userId: user.recordset[0].id };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    if (isDuplicateKeyError(error)) {
      throw new HttpError(409, 'This username is already taken. Please choose another one.');
    }
    throw error;
  }
}
