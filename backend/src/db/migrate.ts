import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { closePool, getPool, sql } from './pool.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Applies every migration file (in name order) that has not been applied yet.
// Each file runs inside one transaction, so a failed file changes nothing.
async function main(): Promise<void> {
  const pool = await getPool();

  await pool.request().batch(`
    IF OBJECT_ID(N'dbo.SchemaMigrations', N'U') IS NULL
    CREATE TABLE dbo.SchemaMigrations (
      Name NVARCHAR(200) NOT NULL PRIMARY KEY,
      AppliedAt DATETIME2 NOT NULL CONSTRAINT DF_SchemaMigrations_AppliedAt DEFAULT SYSUTCDATETIME()
    );
  `);

  const applied = await pool.request().query<{ Name: string }>('SELECT Name FROM dbo.SchemaMigrations');
  const appliedNames = new Set(applied.recordset.map((row) => row.Name));

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    if (appliedNames.has(file)) continue;

    const script = await readFile(path.join(migrationsDir, file), 'utf8');
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await transaction.request().batch(script);
      await transaction.request().input('name', sql.NVarChar(200), file).query(
        'INSERT INTO dbo.SchemaMigrations (Name) VALUES (@name)',
      );
      await transaction.commit();
      console.log(`Applied migration: ${file}`);
      count += 1;
    } catch (error) {
      await transaction.rollback();
      throw new Error(`Migration ${file} failed and was rolled back: ${(error as Error).message}`);
    }
  }

  console.log(count === 0 ? 'Database is already up to date.' : `Done. Applied ${count} migration(s).`);
}

main()
  .catch((error: unknown) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
