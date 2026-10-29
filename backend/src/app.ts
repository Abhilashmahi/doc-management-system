import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { checkOrigin } from './middleware/origin-check.js';
import { resolveScope } from './middleware/scope.js';
import { accountsRouter } from './routes/accounts.js';
import { activityRouter, dashboardRouter, settingsRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { documentsRouter } from './routes/documents.js';
import { filesRouter } from './routes/files.js';
import { fontsRouter } from './routes/fonts.js';
import { writerRouter } from './routes/writer.js';
import { signupRouter } from './routes/signup.js';
import { googleRouter } from './routes/google.js';
import { healthRouter } from './routes/health.js';
import { mastersRouter } from './routes/masters.js';
import { publicShareRouter, shareRouter } from './routes/share.js';
import { templatesRouter } from './routes/templates.js';
import { toolsRouter } from './routes/tools.js';
import { profileRouter, usersRouter } from './routes/users.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  // Designs are saved as JSON, so the limit is higher than for plain forms. Files go through multipart uploads instead.
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());
  app.use(checkOrigin);

  app.use('/api/health', healthRouter);
  app.use('/api/auth/google', googleRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/auth', signupRouter);
  // Share links open without signing in; each one is a long secret that expires.
  app.use('/api/public/share', publicShareRouter);

  // Everything below needs a signed-in user, and works inside one office (see middleware/scope.ts).
  const secured = express.Router();
  secured.use(requireAuth, resolveScope);
  secured.use('/dashboard', dashboardRouter);
  secured.use('/documents', documentsRouter);
  secured.use('/templates', templatesRouter);
  secured.use('/files', filesRouter);
  secured.use('/fonts', fontsRouter);
  secured.use('/writer', writerRouter);
  secured.use('/tools', toolsRouter);
  secured.use('/share', shareRouter);
  secured.use('/users', usersRouter);
  secured.use('/profile', profileRouter);
  secured.use('/accounts', accountsRouter);
  secured.use('/settings', settingsRouter);
  secured.use('/activity', activityRouter);
  secured.use('/', mastersRouter);
  app.use('/api', secured);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });
  app.use(errorHandler);

  return app;
}
