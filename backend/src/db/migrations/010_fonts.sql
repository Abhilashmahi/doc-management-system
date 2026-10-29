-- Fonts added to the website by an administrator (for example Bamini, Latha or a decorative Tamil font), so every
-- user's Writer can show and print them even when the font is not installed on their computer.
-- Encoding 'unicode' fonts hold real Tamil letters; 'bamini' fonts are old fonts that draw Tamil over English keys.
CREATE TABLE dbo.Fonts (
  Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  Family NVARCHAR(100) NOT NULL,
  FileName NVARCHAR(260) NOT NULL,
  Format VARCHAR(10) NOT NULL,
  Encoding VARCHAR(10) NOT NULL,
  StorageKey NVARCHAR(300) NOT NULL,
  SizeBytes INT NOT NULL,
  CreatedById INT NOT NULL REFERENCES dbo.Users(Id),
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_Fonts_Family ON dbo.Fonts(Family);
