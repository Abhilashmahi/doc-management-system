-- Share links: a secret link that lets someone without an account download one document's file until it expires.
-- Only a SHA-256 hash of the secret is stored, so the database alone cannot be used to open shared files.
CREATE TABLE dbo.ShareLinks (
  Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  AccountId INT NOT NULL REFERENCES dbo.Accounts(Id),
  DocumentId INT NOT NULL REFERENCES dbo.Documents(Id),
  FileId INT NOT NULL REFERENCES dbo.StoredFiles(Id),
  TokenHash CHAR(64) NOT NULL,
  CreatedById INT NOT NULL REFERENCES dbo.Users(Id),
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  ExpiresAt DATETIME2 NOT NULL,
  RevokedAt DATETIME2 NULL,
  DownloadCount INT NOT NULL DEFAULT 0,
  LastDownloadedAt DATETIME2 NULL
);
CREATE UNIQUE INDEX UX_ShareLinks_TokenHash ON dbo.ShareLinks(TokenHash);
CREATE INDEX IX_ShareLinks_Document ON dbo.ShareLinks(DocumentId);
