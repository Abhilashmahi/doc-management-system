-- AI assistant conversations. Each user sees only their own.
-- ApiMessagesJson is the exact conversation sent to Claude (kept append-only, as the API requires).
-- DisplayJson is the simplified version the chat panel shows (text, actions taken, links).
IF OBJECT_ID(N'dbo.AiConversations', N'U') IS NULL
CREATE TABLE dbo.AiConversations (
  Id               INT IDENTITY(1,1) PRIMARY KEY,
  UserId           INT NOT NULL REFERENCES dbo.Users(Id),
  AccountId        INT NULL REFERENCES dbo.Accounts(Id),
  Title            NVARCHAR(200) NOT NULL,
  ApiMessagesJson  NVARCHAR(MAX) NOT NULL,
  DisplayJson      NVARCHAR(MAX) NOT NULL,
  PendingNote      NVARCHAR(MAX) NULL,      -- told to the AI with the next message, e.g. "the user confirmed the delete"
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_AiConversations_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedAt        DATETIME2 NOT NULL CONSTRAINT DF_AiConversations_UpdatedAt DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_AiConversations_User ON dbo.AiConversations (UserId, UpdatedAt DESC);
