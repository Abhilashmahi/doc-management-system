import { createApp } from './app.js';
import { env } from './config/env.js';
import { getPool, sql } from './db/pool.js';
import { getAppSettings } from './services/settings.js';
import { purgeExpiredTrash } from './services/trash.js';

const app = createApp();

// Express 5 passes a start-up error (for example "port already in use") to this callback.
app.listen(env.PORT, (error?: Error) => {
  if (error) {
    const busy = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
    console.error(busy ? `Port ${env.PORT} is already in use. Is the backend already running in another window?` : `The API could not start: ${error.message}`);
    process.exit(1);
  }
  console.log(`e-Sevai API running at http://localhost:${env.PORT}`);
  console.log(`Health check: http://localhost:${env.PORT}/api/health`);
});

// Applies the retention settings: old activity entries are removed, and documents left in the trash too long are deleted forever.
// Runs a minute after start-up and then once a day. A failure is logged and retried the next day.
async function applyRetention(): Promise<void> {
  try {
    const { auditRetentionDays } = await getAppSettings();
    const pool = await getPool();
    const result = await pool
      .request()
      .input('days', sql.Int, auditRetentionDays)
      .query('DELETE FROM dbo.AuditLogs WHERE CreatedAt < DATEADD(DAY, -@days, SYSUTCDATETIME())');
    if (result.rowsAffected[0] > 0) console.log(`Audit retention: removed ${result.rowsAffected[0]} entries older than ${auditRetentionDays} days.`);
    const purged = await purgeExpiredTrash();
    if (purged > 0) console.log(`Trash: deleted ${purged} documents forever after the retention period.`);
  } catch (error) {
    console.error('Retention clean-up failed:', error instanceof Error ? error.message : error);
  }
}

setTimeout(() => void applyRetention(), 60_000).unref();
setInterval(() => void applyRetention(), 24 * 60 * 60 * 1000).unref();
