import { env } from '../config/env.js';
import { buildMasterConfig, sql } from './pool.js';

// Database names cannot be passed as query parameters, so we allow only safe characters.
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

async function main(): Promise<void> {
  if (!SAFE_NAME.test(env.DB_NAME)) {
    throw new Error('DB_NAME may only contain letters, numbers and underscores, and must start with a letter.');
  }

  const pool = await new sql.ConnectionPool(buildMasterConfig()).connect();
  try {
    const exists = await pool
      .request()
      .input('name', sql.NVarChar(128), env.DB_NAME)
      .query<{ id: number }>('SELECT database_id AS id FROM sys.databases WHERE name = @name');

    if (exists.recordset.length > 0) {
      console.log(`Database "${env.DB_NAME}" already exists. Nothing to create.`);
      return;
    }

    // Only this one database is created. No other database is touched.
    await pool.request().batch(`CREATE DATABASE [${env.DB_NAME}];`);
    console.log(`Database "${env.DB_NAME}" created successfully.`);
  } finally {
    await pool.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Could not create the database. Reason:', message);
  console.error('Check the troubleshooting section in README.md (section "Database connection problems").');
  process.exit(1);
});
