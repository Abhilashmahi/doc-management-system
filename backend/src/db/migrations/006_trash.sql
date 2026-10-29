-- Trash: deleted documents keep their rows (DeletedAt) until they are restored or deleted forever.
-- DeletedById records who moved each document to the trash.

ALTER TABLE dbo.Documents ADD DeletedById INT NULL CONSTRAINT FK_Documents_DeletedBy REFERENCES dbo.Users(Id);
CREATE INDEX IX_Documents_Account_Deleted ON dbo.Documents (AccountId, DeletedAt);

IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE [Key] = N'trash_retention_days')
INSERT INTO dbo.AppSettings ([Key], [Value]) VALUES (N'trash_retention_days', N'30');
