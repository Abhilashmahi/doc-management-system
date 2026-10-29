import { expect, test } from '@playwright/test';

// The main journey: an office Admin designs a template with a field, publishes it, fills in a document,
// sees the value in the preview, and exports a PDF. Then it archives what it created.
//
// Set these before running (use an office Admin, not the Master Admin, so no office has to be picked):
//   $env:E2E_USERNAME = "your.admin"; $env:E2E_PASSWORD = "..."
// The test creates a template and a document named "E2E ..." in that office and archives them at the end.

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;

test.skip(!username || !password, 'Set E2E_USERNAME and E2E_PASSWORD to run the end-to-end tests.');

test('design a template, fill in a document and export it', async ({ page }) => {
  const stamp = Date.now();
  const templateName = `E2E template ${stamp}`;
  const documentName = `E2E document ${stamp}`;

  await page.goto('/login');
  await page.fill('#signin-username', username!);
  await page.fill('#signin-password', password!);
  await page.click('button[type=submit]');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  // Create a template and place the Full Name field on it
  await page.goto('/templates?create=1');
  await page.getByLabel('Template name').fill(templateName);
  await page.getByRole('button', { name: 'Create and open designer' }).click();
  await page.waitForURL(/\/templates\/\d+\/design$/);
  await page.getByRole('button', { name: /^Fields$/ }).click();
  await page.getByRole('button', { name: /Full Name/ }).first().click();
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByText(/Saved at/)).toBeVisible();
  const templateId = page.url().match(/templates\/(\d+)/)![1];

  // Publish it
  await page.goto('/templates');
  const card = page.locator('div', { hasText: templateName }).filter({ has: page.getByRole('button', { name: 'Publish' }) }).last();
  await card.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Template published.')).toBeVisible();

  // Fill in a document from it
  await page.goto(`/documents/new?templateId=${templateId}`);
  await page.getByLabel('Document name').fill(documentName);
  await page.getByLabel(/^Full Name/).fill('Priya Lakshmi');
  await page.getByRole('button', { name: 'Save document' }).click();
  await page.waitForURL(/\/documents\/\d+$/);
  await expect(page.getByRole('heading', { name: documentName })).toBeVisible();
  await expect(page.getByText('Priya Lakshmi').first()).toBeVisible();

  // Export a PDF
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export PDF/ }).click()]);
  expect(download.suggestedFilename()).toBe(`${documentName}.pdf`);

  // Clean up: archive the document and the template
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('This document is archived')).toBeVisible();
  await page.goto('/templates');
  const card2 = page.locator('div', { hasText: templateName }).filter({ has: page.getByRole('button', { name: 'Archive' }) }).last();
  await card2.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
});
