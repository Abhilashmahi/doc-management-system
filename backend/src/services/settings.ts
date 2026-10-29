import { getPool, sql } from '../db/pool.js';

// Reads one value from the AppSettings table. Returns null when the setting does not exist.
export async function getSetting(key: string): Promise<string | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('key', sql.NVarChar(100), key)
    .query<{ value: string }>('SELECT [Value] AS value FROM dbo.AppSettings WHERE [Key] = @key');
  return result.recordset[0]?.value ?? null;
}

export async function isSelfSignupEnabled(): Promise<boolean> {
  return (await getSetting('allow_self_signup')) === 'true';
}

export interface AppSettings {
  appName: string;
  brandColor: string;
  allowSelfSignup: boolean;
  allowedFileTypes: string[];
  maxUploadMb: number;
  defaultExportFormat: 'pdf' | 'png' | 'jpeg';
  auditRetentionDays: number;
}

// All settings in one object, with safe fallbacks when a row is missing.
export async function getAppSettings(): Promise<AppSettings> {
  const pool = await getPool();
  const rows = await pool.request().query<{ key: string; value: string }>('SELECT [Key] AS [key], [Value] AS value FROM dbo.AppSettings');
  const map = new Map(rows.recordset.map((row) => [row.key, row.value]));
  const exportFormat = map.get('default_export_format');
  return {
    appName: map.get('app_name') ?? 'e-Sevai Document Manager',
    brandColor: map.get('brand_color') ?? '#4f46e5',
    allowSelfSignup: map.get('allow_self_signup') === 'true',
    allowedFileTypes: (map.get('allowed_file_types') ?? 'pdf,png,jpg,jpeg')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
    maxUploadMb: Number(map.get('max_upload_mb') ?? 20) || 20,
    defaultExportFormat: exportFormat === 'png' || exportFormat === 'jpeg' ? exportFormat : 'pdf',
    auditRetentionDays: Number(map.get('audit_retention_days') ?? 365) || 365,
  };
}

const SETTING_KEYS: Record<keyof AppSettings, string> = {
  appName: 'app_name',
  brandColor: 'brand_color',
  allowSelfSignup: 'allow_self_signup',
  allowedFileTypes: 'allowed_file_types',
  maxUploadMb: 'max_upload_mb',
  defaultExportFormat: 'default_export_format',
  auditRetentionDays: 'audit_retention_days',
};

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const [field, key] of Object.entries(SETTING_KEYS) as [keyof AppSettings, string][]) {
      const raw = settings[field];
      const value = Array.isArray(raw) ? raw.join(',') : String(raw);
      await transaction
        .request()
        .input('key', sql.NVarChar(100), key)
        .input('value', sql.NVarChar(sql.MAX), value)
        .query(`
          MERGE dbo.AppSettings AS t
          USING (SELECT @key AS [Key]) AS s ON t.[Key] = s.[Key]
          WHEN MATCHED THEN UPDATE SET [Value] = @value, UpdatedAt = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT ([Key], [Value]) VALUES (@key, @value);
        `);
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}
