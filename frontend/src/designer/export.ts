import { createElement, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type Konva from 'konva';
import { PDFDocument } from 'pdf-lib';
import { loadImage } from './assets';
import { PageView } from './PageView';
import type { CanvasDocument } from './types';

export type ExportFormat = 'pdf' | 'png' | 'jpeg';

// Pixels per CSS pixel in the exported images. 2 gives about 192 DPI, which prints sharply on A4.
const PIXEL_RATIO = 2;

// Draws every page off screen and returns one image (data URL) per page.
async function renderPages(canvas: CanvasDocument, values: Record<string, string> | null, mimeType: string): Promise<string[]> {
  // Load every uploaded image first, so the pages are complete when they are drawn.
  const fileIds = new Set<number>();
  for (const page of canvas.pages) {
    if (page.backgroundFileId) fileIds.add(page.backgroundFileId);
    for (const el of page.elements) if (el.type === 'image') fileIds.add(el.fileId);
  }
  await Promise.all([...fileIds].map((id) => loadImage(id).catch(() => undefined)));

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    return await new Promise<string[]>((resolve, reject) => {
      function Pages() {
        const stages = useRef<(Konva.Stage | null)[]>([]);
        useEffect(() => {
          try {
            resolve(
              stages.current.map((stage) =>
                // A white backdrop matters for JPEG, which has no transparency.
                stage!.toDataURL({ pixelRatio: PIXEL_RATIO, mimeType, quality: 0.92 }),
              ),
            );
          } catch (error) {
            reject(error);
          }
        }, []);
        return createElement(
          'div',
          null,
          canvas.pages.map((page, i) =>
            createElement(PageView, {
              key: page.id,
              page,
              values,
              width: page.width,
              stageRef: (s: Konva.Stage | null) => {
                stages.current[i] = s;
              },
            }),
          ),
        );
      }
      root.render(createElement(Pages));
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 120) || 'document';
}

// Builds the export in the browser and downloads it.
// PDF: one PDF page per design page, at the design's real size (96 px = 1 inch = 72 pt).
// PNG / JPEG: one image per page.
// Note: the PDF holds a high-resolution picture of each page, so its text cannot be selected or searched.
export async function exportDesign(canvas: CanvasDocument, values: Record<string, string> | null, format: ExportFormat, name: string): Promise<void> {
  const base = safeFileName(name);
  if (format === 'pdf') {
    triggerDownload(await buildDesignPdf(canvas, values, name), `${base}.pdf`);
    return;
  }

  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const images = await renderPages(canvas, values, mimeType);

  const ext = format === 'jpeg' ? 'jpg' : 'png';
  images.forEach((dataUrl, i) => {
    const suffix = images.length > 1 ? `-page-${i + 1}` : '';
    triggerDownload(new Blob([dataUrlToBytes(dataUrl) as BlobPart], { type: mimeType }), `${base}${suffix}.${ext}`);
  });
}

// The same PDF that Export makes, returned instead of downloaded (used for sharing).
export async function buildDesignPdf(canvas: CanvasDocument, values: Record<string, string> | null, name: string): Promise<Blob> {
  const images = await renderPages(canvas, values, 'image/png');
  const pdf = await PDFDocument.create();
  pdf.setTitle(name);
  pdf.setCreator('e-Sevai Document Manager');
  for (let i = 0; i < images.length; i += 1) {
    const page = canvas.pages[i];
    const png = await pdf.embedPng(dataUrlToBytes(images[i]));
    const pdfPage = pdf.addPage([page.width * 0.75, page.height * 0.75]);
    pdfPage.drawImage(png, { x: 0, y: 0, width: page.width * 0.75, height: page.height * 0.75 });
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
