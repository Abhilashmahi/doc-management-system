import sharp from 'sharp';
import { HttpError } from '../../utils/http-error.js';
import { imagesToPdf } from './pdf-writer.js';

// Image conversions with sharp (libvips). Animated GIF/WebP use their first frame.

// Very large images are refused instead of using all the server's memory (about 100 megapixels).
const MAX_PIXELS = 100_000_000;

function open(data: Buffer) {
  return sharp(data, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate(); // rotate() applies the camera's orientation
}

export async function convertImage(data: Buffer, to: 'png' | 'jpeg' | 'webp'): Promise<Buffer> {
  try {
    const image = open(data);
    if (to === 'png') return await image.png({ compressionLevel: 9 }).toBuffer();
    if (to === 'webp') return await image.webp({ quality: 90 }).toBuffer();
    // JPEG has no transparency, so transparent areas become white.
    return await image.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  } catch (error) {
    throw imageError(error);
  }
}

export async function imageToPdf(data: Buffer, title: string): Promise<Buffer> {
  try {
    const { data: jpeg, info } = await open(data).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
    return await imagesToPdf([{ data: jpeg, type: 'jpeg', width: info.width, height: info.height }], title);
  } catch (error) {
    throw imageError(error);
  }
}

function imageError(error: unknown): Error {
  if (error instanceof HttpError) return error;
  const message = error instanceof Error ? error.message : '';
  if (message.includes('pixel limit')) return new HttpError(400, 'The image is too large to convert (over 100 megapixels).');
  return new HttpError(400, 'The image could not be read. It may be damaged or in an unusual variant of its format.');
}
