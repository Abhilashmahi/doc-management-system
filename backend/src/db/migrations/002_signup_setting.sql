-- Turns on self-service account creation. Administrators can switch it off later by setting the value to 'false'.

IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE [Key] = N'allow_self_signup')
INSERT INTO dbo.AppSettings ([Key], [Value]) VALUES (N'allow_self_signup', N'true');
