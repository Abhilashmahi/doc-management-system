import sql from 'mssql';
import { env } from '../config/env.js';

// SQL Server Express named instances look like "ABHILASH\SQLEXPRESS".
// The driver wants the host and the instance name as two separate settings.
function parseServer(raw: string): { server: string; instanceName?: string } {
  const [host, instanceName] = raw.split('\\');
  return instanceName ? { server: host, instanceName } : { server: host };
}

function buildConfig(database: string): sql.config {
  const { server, instanceName } = parseServer(env.DB_SERVER);
  return {
    server,
    // With DB_PORT set, the instance name is left out, because the driver would otherwise ask SQL Server Browser for the port.
    ...(env.DB_PORT ? { port: env.DB_PORT } : {}),
    database,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: {
      instanceName: env.DB_PORT ? undefined : instanceName,
      encrypt: env.DB_ENCRYPT,
      trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE,
      enableArithAbort: true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 30000,
  };
}

let appPool: sql.ConnectionPool | null = null;

// Returns the shared connection pool for the application database.
// Throws the real driver error if SQL Server cannot be reached. It never falls back to another database.
export async function getPool(): Promise<sql.ConnectionPool> {
  if (appPool?.connected) return appPool;
  appPool = await new sql.ConnectionPool(buildConfig(env.DB_NAME)).connect();
  return appPool;
}

// Used by the create-database and migration scripts, which connect to the "master" database first.
export function buildMasterConfig(): sql.config {
  return buildConfig('master');
}

export async function closePool(): Promise<void> {
  if (appPool) {
    await appPool.close();
    appPool = null;
  }
}

export { sql };
