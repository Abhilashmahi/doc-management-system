import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';

// LibreOffice (free, from libreoffice.org) gives faithful Word / Excel / PowerPoint conversions.
// It is optional: when it is installed, the extra conversions switch on by themselves.

const CANDIDATES = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice',
  '/usr/lib/libreoffice/program/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
];

let cached: { path: string | null; at: number } | null = null;

// Looks for LibreOffice at most once a minute, so installing it while the app runs is picked up quickly.
export function libreOfficePath(): string | null {
  if (cached && Date.now() - cached.at < 60_000) return cached.path;
  const found = [env.SOFFICE_PATH, ...CANDIDATES].find((p): p is string => Boolean(p) && existsSync(p!)) ?? null;
  cached = { path: found, at: Date.now() };
  return found;
}

// LibreOffice's export filter names for each target type. No shell is used, so the names need no quotes.
const FILTERS: Record<string, string> = {
  pdf: 'pdf',
  docx: 'docx:MS Word 2007 XML',
  odt: 'odt',
  xlsx: 'xlsx:Calc MS Excel 2007 XML',
  ods: 'ods',
  csv: 'csv:Text - txt - csv (StarCalc):44,34,76,1', // comma, double quotes, UTF-8, first sheet
  pptx: 'pptx:Impress MS PowerPoint 2007 XML',
  txt: 'txt:Text',
  png: 'png',
};

const TIMEOUT_MS = 120_000;

// LibreOffice can only run one conversion at a time per profile, so requests wait their turn.
let queue: Promise<unknown> = Promise.resolve();

export function convertWithLibreOffice(data: Buffer, fromExt: string, toExt: string): Promise<Buffer> {
  const run = queue.then(() => doConvert(data, fromExt, toExt));
  queue = run.catch(() => undefined);
  return run;
}

async function doConvert(data: Buffer, fromExt: string, toExt: string): Promise<Buffer> {
  const soffice = libreOfficePath();
  if (!soffice) throw new HttpError(400, 'This conversion needs LibreOffice, which is not installed on the server.');
  const filter = FILTERS[toExt];
  if (!filter) throw new HttpError(400, `LibreOffice cannot produce .${toExt} files here.`);

  const work = await mkdtemp(path.join(os.tmpdir(), 'esevai-convert-'));
  try {
    // A fixed, harmless input name: the user's file name never reaches the command line.
    const input = path.join(work, `input.${fromExt}`);
    const outDir = path.join(work, 'out');
    await writeFile(input, data);
    const profile = pathToFileURL(path.join(os.tmpdir(), 'esevai-libreoffice-profile')).href;
    const args = ['--headless', '--norestore', '--nolockcheck', '--nodefault', `-env:UserInstallation=${profile}`, '--convert-to', filter, '--outdir', outDir, input];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(soffice, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + String(chunk)).slice(-2000);
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new HttpError(504, 'LibreOffice took too long to convert this file.'));
      }, TIMEOUT_MS);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else {
          console.error(`LibreOffice exited with code ${code}: ${stderr}`);
          reject(new HttpError(400, 'LibreOffice could not convert this file. It may be damaged or password-protected.'));
        }
      });
    });

    const produced = existsSync(outDir) ? await readdir(outDir) : [];
    const output = produced.find((f) => f.toLowerCase().endsWith(`.${toExt}`));
    if (!output) throw new HttpError(400, 'LibreOffice finished but produced no file. The file may be empty or damaged.');
    return await readFile(path.join(outDir, output));
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
