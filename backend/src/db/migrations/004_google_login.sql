-- Google sign-in. A Google account has no password, so PasswordHash may be empty.
-- GoogleSubject is the stable Google user ID ("sub"), which is kept unique.

ALTER TABLE dbo.Users ADD GoogleSubject NVARCHAR(255) NULL;
ALTER TABLE dbo.Users ALTER COLUMN PasswordHash NVARCHAR(512) NULL;
EXEC (N'CREATE UNIQUE INDEX UX_Users_GoogleSubject ON dbo.Users (GoogleSubject) WHERE GoogleSubject IS NOT NULL;');
