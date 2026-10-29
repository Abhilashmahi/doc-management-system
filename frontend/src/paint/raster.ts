// Pixel helpers for the Paint tool.

export function makeCanvas(width: number, height: number, background?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  if (background) {
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

export function hexToRgba(hex: string, alpha = 1): [number, number, number, number] {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Math.round(alpha * 255)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// Paint-bucket fill: fills the area of similar colour around (x, y). `tolerance` is 0–255 per channel.
// The fill colour is blended over the old pixels when opacity is below 1.
export function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, hex: string, opacity: number, tolerance = 32): void {
  const { width, height } = ctx.canvas;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;
  const start = (y * width + x) * 4;
  const target = [d[start], d[start + 1], d[start + 2], d[start + 3]];
  const [fr, fg, fb] = hexToRgba(hex);
  const a = Math.max(0, Math.min(1, opacity));
  if (a === 1 && target[0] === fr && target[1] === fg && target[2] === fb && target[3] === 255) return;

  const matches = (i: number) =>
    Math.abs(d[i] - target[0]) <= tolerance &&
    Math.abs(d[i + 1] - target[1]) <= tolerance &&
    Math.abs(d[i + 2] - target[2]) <= tolerance &&
    Math.abs(d[i + 3] - target[3]) <= tolerance;
  const seen = new Uint8Array(width * height);
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop()!;
    let px = stack.pop()!;
    // walk left to the start of this run, then fill rightwards, queuing the rows above and below
    while (px > 0 && !seen[py * width + px - 1] && matches((py * width + px - 1) * 4)) px -= 1;
    let up = false;
    let down = false;
    for (; px < width; px += 1) {
      const k = py * width + px;
      if (seen[k] || !matches(k * 4)) break;
      seen[k] = 1;
      const i = k * 4;
      d[i] = Math.round(fr * a + d[i] * (1 - a));
      d[i + 1] = Math.round(fg * a + d[i + 1] * (1 - a));
      d[i + 2] = Math.round(fb * a + d[i + 2] * (1 - a));
      d[i + 3] = Math.round(255 * a + d[i + 3] * (1 - a));
      if (py > 0) {
        const above = k - width;
        const ok = !seen[above] && matches(above * 4);
        if (ok && !up) stack.push(px, py - 1);
        up = ok;
      }
      if (py < height - 1) {
        const below = k + width;
        const ok = !seen[below] && matches(below * 4);
        if (ok && !down) stack.push(px, py + 1);
        down = ok;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

// Every integer point on the line from (x0, y0) to (x1, y1): used by the pencil and eraser for crisp strokes.
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  let [x, y] = [Math.round(x0), Math.round(y0)];
  const [ex, ey] = [Math.round(x1), Math.round(y1)];
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x, y]);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

export type Turn = 'right' | 'left' | 'half' | 'flipH' | 'flipV';

// Rotates or flips a whole picture and returns the new canvas.
export function turnCanvas(source: HTMLCanvasElement, turn: Turn): HTMLCanvasElement {
  const sideways = turn === 'right' || turn === 'left';
  const out = makeCanvas(sideways ? source.height : source.width, sideways ? source.width : source.height);
  const ctx = out.getContext('2d')!;
  if (turn === 'right') {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (turn === 'left') {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  } else if (turn === 'half') {
    ctx.translate(out.width, out.height);
    ctx.rotate(Math.PI);
  } else if (turn === 'flipH') {
    ctx.translate(out.width, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, out.height);
    ctx.scale(1, -1);
  }
  ctx.drawImage(source, 0, 0);
  return out;
}

// Stretches the picture to a new size (Resize).
export function scaleCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const out = makeCanvas(width, height);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

// Changes the drawing area without stretching: content stays at the top-left, new space is filled with `background`.
export function resizeArea(source: HTMLCanvasElement, width: number, height: number, background: string): HTMLCanvasElement {
  const out = makeCanvas(width, height, background);
  out.getContext('2d')!.drawImage(source, 0, 0);
  return out;
}

export function cropCanvas(source: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const out = makeCanvas(w, h);
  out.getContext('2d')!.drawImage(source, x, y, w, h, 0, 0, w, h);
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  // JPEG has no transparency, so transparent pixels become white instead of black.
  let source = canvas;
  if (type === 'image/jpeg') {
    source = makeCanvas(canvas.width, canvas.height, '#ffffff');
    source.getContext('2d')!.drawImage(canvas, 0, 0);
  }
  return new Promise((resolve, reject) => source.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be saved.'))), type, 0.92));
}

export function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This file is not a picture the browser can open (use PNG, JPEG, GIF, BMP or WebP).'));
    };
    img.src = url;
  });
}
