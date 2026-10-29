import { getPool, sql } from '../db/pool.js';
import { getSetting } from './settings.js';
import { storage } from './storage.js';

// Deleting forever: removes documents, their versions, and the stored files nothing else uses any more.
// Copies made with "Duplicate" share the same stored file, so a file is only removed when no other
// document or version still points at it. Images used in designs (purpose "asset") are never removed here.
export async function purgeDocuments(accountId: number | null, documentIds: number[]): Promise<number> {
  if (documentIds.length === 0) return 0;
  const pool = await getPool();
  const ids = documentIds.join(',');
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let keys: string[] = [];
  let removed = 0;
  try {
    // Only documents that are really in the trash (and in this office) can be purged.
    const chosen = await transaction
      .request()
      .input('ids', sql.NVarChar(sql.MAX), ids)
      .input('accountId', sql.Int, accountId)
      .query<{ id: number }>(`
        SELECT Id AS id FROM dbo.Documents
        WHERE DeletedAt IS NOT NULL AND (@accountId IS NULL OR AccountId = @accountId)
          AND Id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
      `);
    const valid = chosen.recordset.map((r) => r.id).join(',');
    if (!valid) {
      await transaction.commit();
      return 0;
    }

    const result = await transaction
      .request()
      .input('ids', sql.NVarChar(sql.MAX), valid)
      .query<{ storageKey: string }>(`
        DECLARE @docs TABLE (Id INT PRIMARY KEY);
        INSERT INTO @docs SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@ids, ',');

        DECLARE @files TABLE (Id INT PRIMARY KEY);
        INSERT INTO @files
          SELECT FileId FROM dbo.Documents WHERE Id IN (SELECT Id FROM @docs) AND FileId IS NOT NULL
          UNION
          SELECT FileId FROM dbo.DocumentVersions WHERE DocumentId IN (SELECT Id FROM @docs) AND FileId IS NOT NULL
          UNION
          SELECT FileId FROM dbo.ShareLinks WHERE DocumentId IN (SELECT Id FROM @docs);

        DELETE FROM dbo.ShareLinks WHERE DocumentId IN (SELECT Id FROM @docs);
        DELETE FROM dbo.DocumentVersions WHERE DocumentId IN (SELECT Id FROM @docs);
        DELETE FROM dbo.Documents WHERE Id IN (SELECT Id FROM @docs);

        -- Files still used by another document or version stay.
        DECLARE @gone TABLE (Id INT PRIMARY KEY);
        INSERT INTO @gone
          SELECT f.Id FROM @files f JOIN dbo.StoredFiles s ON s.Id = f.Id
          WHERE s.Purpose = N'document'
            AND NOT EXISTS (SELECT 1 FROM dbo.Documents d WHERE d.FileId = f.Id)
            AND NOT EXISTS (SELECT 1 FROM dbo.DocumentVersions v WHERE v.FileId = f.Id)
            AND NOT EXISTS (SELECT 1 FROM dbo.ShareLinks l WHERE l.FileId = f.Id);

        SELECT StorageKey AS storageKey FROM dbo.StoredFiles WHERE Id IN (SELECT Id FROM @gone);
        DELETE FROM dbo.StoredFiles WHERE Id IN (SELECT Id FROM @gone);
      `);
    keys = result.recordset.map((r) => r.storageKey);
    removed = valid.split(',').length;
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  // The file bytes are removed only after the database change is saved, so a failure never loses a file that is still listed.
  for (const key of keys) await storage.remove(key).catch(() => undefined);
  return removed;
}

// Documents left in the trash longer than the retention period are deleted forever.
export async function purgeExpiredTrash(): Promise<number> {
  const days = Number((await getSetting('trash_retention_days')) ?? 30) || 30;
  const pool = await getPool();
  const expired = await pool
    .request()
    .input('days', sql.Int, days)
    .query<{ id: number }>('SELECT Id AS id FROM dbo.Documents WHERE DeletedAt < DATEADD(DAY, -@days, SYSUTCDATETIME())');
  return purgeDocuments(null, expired.recordset.map((r) => r.id));
}
