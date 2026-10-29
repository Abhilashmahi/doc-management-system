import { chromium, type Browser } from 'playwright-core';
import { readFontFile } from '../routes/fonts.js';
import { HttpError } from '../utils/http-error.js';

// Turns a Writer page (HTML) into a PDF with a browser already installed on the server (Edge or Chrome), so Tamil
// is shaped correctly and the text stays selectable. The page is loaded from a made-up address with every network
// request blocked, except the fonts added to the website, which are served from storage.

const HOST = 'writer.local';
const IDLE_MS = 2 * 60 * 1000;

let browser: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;

async function launch(): Promise<Browser> {
  const path = process.env.PDF_BROWSER_PATH;
  if (path) return chromium.launch({ executablePath: path });
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel });
    } catch {
      // Try the next browser.
    }
  }
  throw new HttpError(503, 'Making PDFs needs Microsoft Edge or Google Chrome on the server (or PDF_BROWSER_PATH in backend/.env). Use Print → "Save as PDF" instead.');
}

// The browser stays open while PDFs are being made and closes after two quiet minutes, to give back its memory.
async function getBrowser(): Promise<Browser> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const closing = browser;
    browser = null;
    void closing?.then((b) => b.close()).catch(() => undefined);
  }, IDLE_MS);
  browser ??= launch().catch((error) => {
    browser = null;
    throw error;
  });
  return browser;
}

export const PDF_FONT_ORIGIN = `http://${HOST}`;

export async function htmlToPdf(html: string): Promise<Buffer> {
  const context = await (await getBrowser()).newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.host !== HOST) return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      const font = /^\/api\/fonts\/(\d+)\/file$/.exec(url.pathname);
      if (font) {
        const file = await readFontFile(Number(font[1])).catch(() => null);
        return file ? route.fulfill({ contentType: file.contentType, body: file.data }) : route.abort();
      }
      return route.abort();
    });
    await page.goto(`${PDF_FONT_ORIGIN}/`, { waitUntil: 'networkidle', timeout: 30_000 });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await context.close();
  }
}
