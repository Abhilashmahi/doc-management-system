import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real app in Microsoft Edge (already installed on Windows, so no browser download is needed).
// Start the backend and frontend first (npm run dev in each folder), then run: npm run test:e2e
// Sign-in details come from environment variables; see e2e/document-flow.e2e.ts.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
});
