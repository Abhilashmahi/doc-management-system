import { useEffect, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { fileUrl } from '../lib/api';

// ---------- Uploaded images ----------

// One shared cache, so an image used on many pages (or in the preview and the export) downloads once.
const imageCache = new Map<number, Promise<HTMLImageElement>>();
const loadedImages = new Map<number, HTMLImageElement>();

export function loadImage(fileId: number): Promise<HTMLImageElement> {
  let pending = imageCache.get(fileId);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        loadedImages.set(fileId, img);
        resolve(img);
      };
      img.onerror = () => {
        imageCache.delete(fileId); // allow a retry later
        reject(new Error(`Image ${fileId} could not be loaded.`));
      };
      img.src = fileUrl(fileId);
    });
    imageCache.set(fileId, pending);
  }
  return pending;
}

// Returns the image once it has loaded (undefined until then), and re-renders the caller when it arrives.
export function useStoredImage(fileId: number | null | undefined): HTMLImageElement | undefined {
  const [image, setImage] = useState<HTMLImageElement | undefined>(fileId ? loadedImages.get(fileId) : undefined);
  useEffect(() => {
    if (!fileId) {
      setImage(undefined);
      return;
    }
    let cancelled = false;
    loadImage(fileId)
      .then((img) => !cancelled && setImage(img))
      .catch(() => !cancelled && setImage(undefined));
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return image;
}

// ---------- Barcodes and QR codes ----------

export interface CodeImage {
  canvas: HTMLCanvasElement | null;
  error: string | null;
}

const codeCache = new Map<string, CodeImage>();

// Draws a Code 128 barcode or a QR code into an offscreen canvas. Both run synchronously, so previews and
// exports never wait for them. Results are cached by their inputs.
export function codeImage(kind: 'barcode' | 'qrcode', value: string, color: string, background: string, showText: boolean): CodeImage {
  const key = `${kind}|${value}|${color}|${background}|${showText}`;
  const cached = codeCache.get(key);
  if (cached) return cached;

  let result: CodeImage;
  if (!value) {
    result = { canvas: null, error: 'No value yet' };
  } else if (kind === 'barcode') {
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, value, {
        format: 'CODE128',
        lineColor: color || '#000000',
        background: background || '#ffffff',
        displayValue: showText,
        margin: 4,
        height: 80,
        width: 2,
        fontSize: 16,
      });
      result = { canvas, error: null };
    } catch {
      result = { canvas: null, error: 'Cannot encode this value as Code 128' };
    }
  } else {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
      const size = qr.modules.size;
      const scale = 8;
      const margin = 2;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = (size + margin * 2) * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = background || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color || '#000000';
      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          if (qr.modules.get(row, col)) ctx.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
        }
      }
      result = { canvas, error: null };
    } catch {
      result = { canvas: null, error: 'Value is too long for a QR code' };
    }
  }
  // Keep the cache small: designs re-render often while values are typed.
  if (codeCache.size > 300) codeCache.clear();
  codeCache.set(key, result);
  return result;
}
