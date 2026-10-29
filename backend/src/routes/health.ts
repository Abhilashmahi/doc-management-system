import { Router } from 'express';
import { getPool } from '../db/pool.js';

export const healthRouter = Router();

// Simple check: is the API up, and can it reach SQL Server?
healthRouter.get('/', async (_req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    // The real reason is logged on the server. Driver details are not sent to the browser.
    console.error('Health check: database is not reachable. See README troubleshooting.');
    res.status(503).json({ status: 'degraded', database: 'unreachable' });
  }
});
