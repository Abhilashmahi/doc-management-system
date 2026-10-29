// The shapes of the Paint tool. Most are polygons given as points inside a 1×1 box; the box is stretched to
// whatever the person drags out. A few (oval, rounded rectangle, heart) are drawn with curves.

export type ShapeKind =
  | 'line'
  | 'oval'
  | 'rect'
  | 'roundRect'
  | 'triangle'
  | 'rightTriangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'arrowRight'
  | 'arrowLeft'
  | 'arrowUp'
  | 'arrowDown'
  | 'star4'
  | 'star5'
  | 'star6'
  | 'callout'
  | 'heart'
  | 'lightning';

type Pt = [number, number];

function regular(sides: number): Pt[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)] as Pt;
  });
}

function star(points: number, inner: number): Pt[] {
  return Array.from({ length: points * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? 0.5 : 0.5 * inner;
    return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)] as Pt;
  });
}

const arrowRight: Pt[] = [[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]];

const POLYGONS: Partial<Record<ShapeKind, Pt[]>> = {
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  rightTriangle: [[0, 0], [1, 1], [0, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  pentagon: regular(5),
  hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  arrowRight,
  arrowLeft: arrowRight.map(([x, y]) => [1 - x, y]),
  arrowUp: arrowRight.map(([x, y]) => [y, 1 - x]),
  arrowDown: arrowRight.map(([x, y]) => [y, x]),
  star4: star(4, 0.38),
  star5: star(5, 0.4),
  star6: star(6, 0.55),
  callout: [[0, 0], [1, 0], [1, 0.72], [0.42, 0.72], [0.2, 1], [0.26, 0.72], [0, 0.72]],
  lightning: [[0.58, 0], [0.18, 0.56], [0.45, 0.56], [0.3, 1], [0.84, 0.38], [0.56, 0.38], [0.74, 0]],
};

export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'line', label: 'Line' },
  { kind: 'oval', label: 'Oval' },
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'roundRect', label: 'Rounded rectangle' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'rightTriangle', label: 'Right triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'arrowRight', label: 'Right arrow' },
  { kind: 'arrowLeft', label: 'Left arrow' },
  { kind: 'arrowUp', label: 'Up arrow' },
  { kind: 'arrowDown', label: 'Down arrow' },
  { kind: 'star4', label: '4-point star' },
  { kind: 'star5', label: '5-point star' },
  { kind: 'star6', label: '6-point star' },
  { kind: 'callout', label: 'Speech bubble' },
  { kind: 'heart', label: 'Heart' },
  { kind: 'lightning', label: 'Lightning' },
];

// Builds the shape's outline as the current path of ctx, inside the box (x, y, w, h). w and h are positive.
export function shapePath(ctx: CanvasRenderingContext2D | Path2D, kind: Exclude<ShapeKind, 'line'>, x: number, y: number, w: number, h: number): void {
  const p = ctx as CanvasRenderingContext2D;
  if (kind === 'oval') {
    p.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, Math.PI * 2);
    return;
  }
  if (kind === 'rect') {
    p.rect(x, y, w, h);
    return;
  }
  if (kind === 'roundRect') {
    p.roundRect(x, y, w, h, Math.min(w, h) * 0.18);
    return;
  }
  if (kind === 'heart') {
    const X = (u: number) => x + u * w;
    const Y = (v: number) => y + v * h;
    p.moveTo(X(0.5), Y(0.28));
    p.bezierCurveTo(X(0.5), Y(0.05), X(0.08), Y(-0.05), X(0.02), Y(0.3));
    p.bezierCurveTo(X(-0.03), Y(0.6), X(0.35), Y(0.78), X(0.5), Y(1));
    p.bezierCurveTo(X(0.65), Y(0.78), X(1.03), Y(0.6), X(0.98), Y(0.3));
    p.bezierCurveTo(X(0.92), Y(-0.05), X(0.5), Y(0.05), X(0.5), Y(0.28));
    p.closePath();
    return;
  }
  const points = POLYGONS[kind]!;
  points.forEach(([u, v], i) => (i === 0 ? p.moveTo(x + u * w, y + v * h) : p.lineTo(x + u * w, y + v * h)));
  p.closePath();
}

// Small icon of the shape for the toolbar (24×24 box, 3px margin).
export function shapeIconPath(kind: ShapeKind): string {
  if (kind === 'line') return 'M4 20L20 4';
  if (kind === 'oval') return 'M12 5a9 7 0 1 0 0.01 0z';
  if (kind === 'rect') return 'M4 6h16v12H4z';
  if (kind === 'roundRect') return 'M7 6h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z';
  if (kind === 'heart') return 'M12 8c0-3-5-4-7-1s1 7 7 11c6-4 9-8 7-11s-7-2-7 1z';
  const points = POLYGONS[kind]!;
  return points.map(([u, v], i) => `${i === 0 ? 'M' : 'L'}${(3 + u * 18).toFixed(1)} ${(3 + v * 18).toFixed(1)}`).join('') + 'Z';
}
