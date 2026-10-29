import { env } from '../config/env.js';
import { closePool, getPool, sql } from './pool.js';

// Checks the connection, then proves that reads and writes work.
// The write uses a temporary table that disappears when the session ends, so no data is left behind.
async function main(): Promise<void> {
  console.log(`Connecting to SQL Server "${env.DB_SERVER}", database "${env.DB_NAME}" ...`);
  const pool = await getPool();

  const info = await pool.request().query<{ dbName: string; serverVersion: string; serverTime: Date }>(`
    SELECT DB_NAME() AS dbName,
           CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) AS serverVersion,
           SYSUTCDATETIME() AS serverTime
  `);
  const row = info.recordset[0];
  console.log(`Connected. Database: ${row.dbName}, SQL Server version: ${row.serverVersion}`);

  const probe = await pool
    .request()
    .input('value', sql.NVarChar(50), 'connection-probe')
    .batch<{ value: string }>(`
      CREATE TABLE #probe (Id INT IDENTITY(1,1) PRIMARY KEY, Value NVARCHAR(50) NOT NULL);
      INSERT INTO #probe (Value) VALUES (@value);
      SELECT Value AS value FROM #probe;
    `);
  const written = probe.recordset[0]?.value;
  if (written !== 'connection-probe') {
    throw new Error('Write/read check failed: the value read back does not match the value written.');
  }
  console.log('Read and write check passed.');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Connection check FAILED. Reason:', message);
    console.error('See "Database connection problems" in README.md.');
    process.exitCode = 1;
  })
  .finally(() => closePool());
