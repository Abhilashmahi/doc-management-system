-- Core schema for the e-Sevai Document Manager.
-- Every business table carries AccountId so that all queries can be limited to one account.

IF OBJECT_ID(N'dbo.Accounts', N'U') IS NULL
CREATE TABLE dbo.Accounts (
  Id              INT IDENTITY(1,1) PRIMARY KEY,
  Name            NVARCHAR(150) NOT NULL,
  IsActive        BIT NOT NULL CONSTRAINT DF_Accounts_IsActive DEFAULT 1,
  StorageLimitBytes BIGINT NOT NULL CONSTRAINT DF_Accounts_StorageLimit DEFAULT 1073741824, -- 1 GB
  CreatedAt       DATETIME2 NOT NULL CONSTRAINT DF_Accounts_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2 NOT NULL CONSTRAINT DF_Accounts_UpdatedAt DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
CREATE TABLE dbo.Users (
  Id                INT IDENTITY(1,1) PRIMARY KEY,
  AccountId         INT NULL REFERENCES dbo.Accounts(Id),   -- NULL only for the platform Master Admin
  Email             NVARCHAR(256) NOT NULL,
  FullName          NVARCHAR(150) NOT NULL,
  PasswordHash      NVARCHAR(512) NOT NULL,                  -- Argon2id hash, never the raw password
  Role              NVARCHAR(20) NOT NULL,                   -- MasterAdmin | Admin | Editor | Viewer
  IsActive          BIT NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT 1,
  FailedLoginCount  INT NOT NULL CONSTRAINT DF_Users_FailedLogin DEFAULT 0,
  LockedUntil       DATETIME2 NULL,
  LastLoginAt       DATETIME2 NULL,
  CreatedAt         DATETIME2 NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedAt         DATETIME2 NOT NULL CONSTRAINT DF_Users_UpdatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_Users_Email UNIQUE (Email),
  CONSTRAINT CK_Users_Role CHECK (Role IN (N'MasterAdmin', N'Admin', N'Editor', N'Viewer'))
);

IF OBJECT_ID(N'dbo.Sessions', N'U') IS NULL
CREATE TABLE dbo.Sessions (
  Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY CONSTRAINT DF_Sessions_Id DEFAULT NEWID(),
  UserId      INT NOT NULL REFERENCES dbo.Users(Id),
  TokenHash   CHAR(64) NOT NULL,                             -- SHA-256 of the cookie token, never the token itself
  IpAddress   NVARCHAR(64) NULL,
  UserAgent   NVARCHAR(300) NULL,
  CreatedAt   DATETIME2 NOT NULL CONSTRAINT DF_Sessions_CreatedAt DEFAULT SYSUTCDATETIME(),
  ExpiresAt   DATETIME2 NOT NULL,
  RevokedAt   DATETIME2 NULL,
  CONSTRAINT UQ_Sessions_TokenHash UNIQUE (TokenHash)
);
CREATE INDEX IX_Sessions_UserId ON dbo.Sessions (UserId);

IF OBJECT_ID(N'dbo.AuditLogs', N'U') IS NULL
CREATE TABLE dbo.AuditLogs (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  AccountId   INT NULL,
  UserId      INT NULL,
  Action      NVARCHAR(100) NOT NULL,                        -- e.g. LOGIN_SUCCESS, USER_CREATED
  EntityType  NVARCHAR(60) NULL,
  EntityId    NVARCHAR(60) NULL,
  Details     NVARCHAR(MAX) NULL,                            -- JSON text, must never contain passwords
  IpAddress   NVARCHAR(64) NULL,
  CreatedAt   DATETIME2 NOT NULL CONSTRAINT DF_AuditLogs_CreatedAt DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_AuditLogs_Account_Created ON dbo.AuditLogs (AccountId, CreatedAt);

IF OBJECT_ID(N'dbo.AppSettings', N'U') IS NULL
CREATE TABLE dbo.AppSettings (
  [Key]     NVARCHAR(100) NOT NULL PRIMARY KEY,
  [Value]   NVARCHAR(MAX) NOT NULL,
  UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_AppSettings_UpdatedAt DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.DocumentCategories', N'U') IS NULL
CREATE TABLE dbo.DocumentCategories (
  Id          INT IDENTITY(1,1) PRIMARY KEY,
  AccountId   INT NOT NULL REFERENCES dbo.Accounts(Id),
  Name        NVARCHAR(150) NOT NULL,
  Description NVARCHAR(500) NULL,
  IsActive    BIT NOT NULL CONSTRAINT DF_Categories_IsActive DEFAULT 1,
  CreatedAt   DATETIME2 NOT NULL CONSTRAINT DF_Categories_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_Categories_Account_Name UNIQUE (AccountId, Name)
);

-- Field definitions are reusable. Templates refer to them by Id, so fields are never hardcoded per template.
IF OBJECT_ID(N'dbo.FieldDefinitions', N'U') IS NULL
CREATE TABLE dbo.FieldDefinitions (
  Id              INT IDENTITY(1,1) PRIMARY KEY,
  AccountId       INT NOT NULL REFERENCES dbo.Accounts(Id),
  FieldKey        NVARCHAR(60) NOT NULL,                     -- stable unique identifier, e.g. FullName
  Label           NVARCHAR(150) NOT NULL,
  DataType        NVARCHAR(20) NOT NULL,                     -- text | number | date | select | multiline
  ValidationJson  NVARCHAR(MAX) NULL,                        -- rules: minLength, maxLength, min, max, pattern
  IsVisible       BIT NOT NULL CONSTRAINT DF_Fields_IsVisible DEFAULT 1,
  IsActive        BIT NOT NULL CONSTRAINT DF_Fields_IsActive DEFAULT 1,
  CreatedAt       DATETIME2 NOT NULL CONSTRAINT DF_Fields_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_Fields_Account_Key UNIQUE (AccountId, FieldKey),
  CONSTRAINT CK_Fields_DataType CHECK (DataType IN (N'text', N'number', N'date', N'select', N'multiline'))
);

IF OBJECT_ID(N'dbo.Templates', N'U') IS NULL
CREATE TABLE dbo.Templates (
  Id                INT IDENTITY(1,1) PRIMARY KEY,
  AccountId         INT NOT NULL REFERENCES dbo.Accounts(Id),
  CategoryId        INT NULL REFERENCES dbo.DocumentCategories(Id),
  Name              NVARCHAR(150) NOT NULL,
  Status            NVARCHAR(20) NOT NULL CONSTRAINT DF_Templates_Status DEFAULT N'Draft', -- Draft | Published | Archived
  CurrentVersionNo  INT NOT NULL CONSTRAINT DF_Templates_CurrentVersion DEFAULT 0,
  CreatedById       INT NOT NULL REFERENCES dbo.Users(Id),
  CreatedAt         DATETIME2 NOT NULL CONSTRAINT DF_Templates_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedAt         DATETIME2 NOT NULL CONSTRAINT DF_Templates_UpdatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_Templates_Status CHECK (Status IN (N'Draft', N'Published', N'Archived'))
);

-- Every save of a template creates a new row here. Old versions are kept for history.
IF OBJECT_ID(N'dbo.TemplateVersions', N'U') IS NULL
CREATE TABLE dbo.TemplateVersions (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  TemplateId    INT NOT NULL REFERENCES dbo.Templates(Id),
  VersionNo     INT NOT NULL,
  SchemaVersion INT NOT NULL CONSTRAINT DF_TemplateVersions_Schema DEFAULT 1,
  CanvasJson    NVARCHAR(MAX) NOT NULL,                      -- validated, versioned canvas document JSON
  CreatedById   INT NOT NULL REFERENCES dbo.Users(Id),
  CreatedAt     DATETIME2 NOT NULL CONSTRAINT DF_TemplateVersions_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_TemplateVersions UNIQUE (TemplateId, VersionNo)
);

IF OBJECT_ID(N'dbo.Documents', N'U') IS NULL
CREATE TABLE dbo.Documents (
  Id                  INT IDENTITY(1,1) PRIMARY KEY,
  AccountId           INT NOT NULL REFERENCES dbo.Accounts(Id),
  CategoryId          INT NULL REFERENCES dbo.DocumentCategories(Id),
  TemplateId          INT NULL REFERENCES dbo.Templates(Id),
  TemplateVersionNo   INT NULL,                              -- which template version this document was built from
  Name                NVARCHAR(200) NOT NULL,
  Status              NVARCHAR(20) NOT NULL CONSTRAINT DF_Documents_Status DEFAULT N'Draft', -- Draft | Final | Archived
  SourceType          NVARCHAR(20) NOT NULL,                 -- template | upload
  FolderPath          NVARCHAR(400) NOT NULL CONSTRAINT DF_Documents_Folder DEFAULT N'/',
  DataJson            NVARCHAR(MAX) NULL,                    -- filled-in field values, keyed by FieldKey
  CurrentVersionNo    INT NOT NULL CONSTRAINT DF_Documents_CurrentVersion DEFAULT 1,
  IsArchived          BIT NOT NULL CONSTRAINT DF_Documents_IsArchived DEFAULT 0,
  CreatedById         INT NOT NULL REFERENCES dbo.Users(Id),
  UpdatedById         INT NULL REFERENCES dbo.Users(Id),
  CreatedAt           DATETIME2 NOT NULL CONSTRAINT DF_Documents_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedAt           DATETIME2 NOT NULL CONSTRAINT DF_Documents_UpdatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_Documents_Status CHECK (Status IN (N'Draft', N'Final', N'Archived')),
  CONSTRAINT CK_Documents_SourceType CHECK (SourceType IN (N'template', N'upload'))
);
CREATE INDEX IX_Documents_Account_Category ON dbo.Documents (AccountId, CategoryId) INCLUDE (Name, Status, CreatedAt);

-- Document history. Original uploaded files are never overwritten; each edit adds a new version row.
IF OBJECT_ID(N'dbo.DocumentVersions', N'U') IS NULL
CREATE TABLE dbo.DocumentVersions (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  DocumentId    INT NOT NULL REFERENCES dbo.Documents(Id),
  VersionNo     INT NOT NULL,
  DataJson      NVARCHAR(MAX) NULL,
  CanvasJson    NVARCHAR(MAX) NULL,
  StorageKey    NVARCHAR(400) NULL,                          -- file location in the storage provider (for uploads)
  CreatedById   INT NOT NULL REFERENCES dbo.Users(Id),
  CreatedAt     DATETIME2 NOT NULL CONSTRAINT DF_DocumentVersions_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_DocumentVersions UNIQUE (DocumentId, VersionNo)
);
