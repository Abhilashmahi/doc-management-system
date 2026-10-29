// Page thumbnails in the browser with PDF.js, loaded only when a tool page needs it (it is large).
import type { PDFDocumentProxy } from 'pdfjs-dist';

let lib: Promise<typeof import('pdfjs-dist')> | null = null;

export function loadLib() {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return lib;
}

const documents = new WeakMap<File, Promise<PDFDocumentProxy>>();

// Opens a PDF chosen by the user. The same File is opened only once.
export function openPdf(file: File): Promise<PDFDocumentProxy> {
  let pending = documents.get(file);
  if (!pending) {
    pending = loadLib().then(async (pdfjs) => pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise);
    documents.set(file, pending);
  }
  return pending;
}

// Draws one page into a small picture, `width` pixels wide.
export async function renderThumbnail(file: File, pageNumber: number, width = 160): Promise<string> {
  const doc = await openPdf(file);
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (width * window.devicePixelRatio) / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.8);
}
