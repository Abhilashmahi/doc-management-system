// Page size and margins, in points (72 points = 1 inch). The width and height are of the upright page;
// `landscape` turns it.
export interface PageSetup {
  width: number;
  height: number;
  landscape: boolean;
  margins: { top: number; right: number; bottom: number; left: number };
}

export const PAGE_SIZES: { label: string; width: number; height: number }[] = [
  { label: 'A4 (21 × 29.7 cm)', width: 595.3, height: 841.9 },
  { label: 'A5 (14.8 × 21 cm)', width: 419.5, height: 595.3 },
  { label: 'A3 (29.7 × 42 cm)', width: 841.9, height: 1190.6 },
  { label: 'Letter (8.5 × 11 in)', width: 612, height: 792 },
  { label: 'Legal (8.5 × 14 in)', width: 612, height: 1008 },
];

export const MARGIN_PRESETS: { label: string; margins: PageSetup['margins'] }[] = [
  { label: 'Normal (2.54 cm)', margins: { top: 72, right: 72, bottom: 72, left: 72 } },
  { label: 'Narrow (1.27 cm)', margins: { top: 36, right: 36, bottom: 36, left: 36 } },
  { label: 'Moderate', margins: { top: 72, right: 54, bottom: 72, left: 54 } },
  { label: 'Wide', margins: { top: 72, right: 144, bottom: 72, left: 144 } },
];

export const DEFAULT_PAGE: PageSetup = { width: 595.3, height: 841.9, landscape: false, margins: { top: 72, right: 72, bottom: 72, left: 72 } };

export function pageBox(page: PageSetup): { width: number; height: number } {
  return page.landscape ? { width: page.height, height: page.width } : { width: page.width, height: page.height };
}
