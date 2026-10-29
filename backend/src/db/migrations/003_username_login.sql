-- Users sign in with a username. Email becomes optional (it can be added later, e.g. for password reset).
-- Existing users keep working: their username is set to their current email address.
-- Statements that use the new column run as dynamic SQL, because SQL Server checks column names when a batch is compiled.

ALTER TABLE dbo.Users ADD Username NVARCHAR(256) NULL;

EXEC (N'UPDATE dbo.Users SET Username = LOWER(Email) WHERE Username IS NULL;');
EXEC (N'ALTER TABLE dbo.Users ALTER COLUMN Username NVARCHAR(256) NOT NULL;');
EXEC (N'ALTER TABLE dbo.Users ADD CONSTRAINT UQ_Users_Username UNIQUE (Username);');

ALTER TABLE dbo.Users DROP CONSTRAINT UQ_Users_Email;
ALTER TABLE dbo.Users ALTER COLUMN Email NVARCHAR(256) NULL;
EXEC (N'CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users (Email) WHERE Email IS NOT NULL;');
