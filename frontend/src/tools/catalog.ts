// The list of PDF tools, in the spirit of iLovePDF: each has a colour, an icon, the files it takes,
// and the server endpoint that runs it (backend/src/routes/tools.ts).

export type ToolGroup = 'Organize PDF' | 'Optimize PDF' | 'Convert to PDF' | 'Convert from PDF' | 'Edit PDF';

export type ToolId =
  | 'merge'
  | 'split'
  | 'remove-pages'
  | 'organize'
  | 'rotate'
  | 'compress'
  | 'jpg-to-pdf'
  | 'word-to-pdf'
  | 'excel-to-pdf'
  | 'powerpoint-to-pdf'
  | 'text-to-pdf'
  | 'html-to-pdf'
  | 'pdf-to-jpg'
  | 'pdf-to-png'
  | 'pdf-to-word'
  | 'pdf-to-text'
  | 'page-numbers'
  | 'watermark'
  | 'pdf-to-template'
  | 'any-convert';

export interface Tool {
  id: ToolId;
  title: string;
  description: string;
  group: ToolGroup;
  color: string; // card accent
  icon: string; // SVG path on a 24px grid
  accept: string[]; // file extensions
  multiple: boolean;
  // Server endpoint: "run/<tool>" with fixed options, or a special flow.
  run: { endpoint: string; options?: Record<string, unknown> } | 'template';
  action: string; // big button text
  needsLibreOffice?: boolean;
  managersOnly?: boolean;
  pages?: 'organize' | 'split' | 'remove'; // show the page grid
}

const PDF = ['pdf'];
const IMAGES = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff'];

export const TOOLS: Tool[] = [
  { id: 'merge', title: 'Merge PDF', description: 'Combine several PDFs into one, in the order you want.', group: 'Organize PDF', color: '#e5322d', icon: 'M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M9 12h6M12 9l3 3-3 3', accept: PDF, multiple: true, run: { endpoint: 'run/merge' }, action: 'Merge PDF' },
  { id: 'split', title: 'Split PDF', description: 'Separate pages or page ranges into their own PDF files.', group: 'Organize PDF', color: '#e5322d', icon: 'M6 3v18M18 3v18M10 12h4M3 12h1M20 12h1', accept: PDF, multiple: false, run: { endpoint: 'run/split' }, action: 'Split PDF', pages: 'split' },
  { id: 'remove-pages', title: 'Remove pages', description: 'Delete the pages you do not need.', group: 'Organize PDF', color: '#e5322d', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM9 14h6', accept: PDF, multiple: false, run: { endpoint: 'run/organize' }, action: 'Remove pages', pages: 'remove' },
  { id: 'organize', title: 'Organize PDF', description: 'Sort, rotate and delete pages by dragging them into place.', group: 'Organize PDF', color: '#e5322d', icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', accept: PDF, multiple: false, run: { endpoint: 'run/organize' }, action: 'Organize PDF', pages: 'organize' },
  { id: 'rotate', title: 'Rotate PDF', description: 'Turn all pages, or only some, the right way up.', group: 'Organize PDF', color: '#7c3aed', icon: 'M21 2v6h-6M21 13a9 9 0 1 1-3-7.7L21 8', accept: PDF, multiple: false, run: { endpoint: 'run/rotate' }, action: 'Rotate PDF' },

  { id: 'compress', title: 'Compress PDF', description: 'Make a PDF smaller for e-mail and upload portals.', group: 'Optimize PDF', color: '#16a34a', icon: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7', accept: PDF, multiple: false, run: { endpoint: 'run/compress' }, action: 'Compress PDF' },

  { id: 'jpg-to-pdf', title: 'JPG to PDF', description: 'Turn photos and scans into a PDF, one image per page.', group: 'Convert to PDF', color: '#eab308', icon: 'M21 15l-5-5L5 21M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', accept: IMAGES, multiple: true, run: { endpoint: 'run/images-to-pdf' }, action: 'Convert to PDF' },
  { id: 'word-to-pdf', title: 'Word to PDF', description: 'Make DOCX, DOC, ODT and RTF files easy to view and print.', group: 'Convert to PDF', color: '#2563eb', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM8 12l1.5 6L12 13l2.5 5L16 12', accept: ['docx', 'doc', 'odt', 'rtf'], multiple: false, run: { endpoint: 'run/convert', options: { to: 'pdf' } }, action: 'Convert to PDF' },
  { id: 'excel-to-pdf', title: 'Excel to PDF', description: 'Turn spreadsheets and CSV files into tidy PDF tables.', group: 'Convert to PDF', color: '#16a34a', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM8 12l8 6M16 12l-8 6', accept: ['xlsx', 'xls', 'ods', 'csv'], multiple: false, run: { endpoint: 'run/convert', options: { to: 'pdf' } }, action: 'Convert to PDF' },
  { id: 'powerpoint-to-pdf', title: 'PowerPoint to PDF', description: 'Turn slide shows into PDF handouts.', group: 'Convert to PDF', color: '#ea580c', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM9 18v-6h3a2 2 0 0 1 0 4H9', accept: ['pptx', 'ppt', 'odp'], multiple: false, run: { endpoint: 'run/convert', options: { to: 'pdf' } }, action: 'Convert to PDF', needsLibreOffice: true },
  { id: 'text-to-pdf', title: 'Text to PDF', description: 'Turn plain text or Markdown into a clean PDF (Tamil supported).', group: 'Convert to PDF', color: '#475569', icon: 'M4 7V4h16v3M9 20h6M12 4v16', accept: ['txt', 'md'], multiple: false, run: { endpoint: 'run/convert', options: { to: 'pdf' } }, action: 'Convert to PDF' },
  { id: 'html-to-pdf', title: 'HTML to PDF', description: 'Save a web page file as a PDF.', group: 'Convert to PDF', color: '#0891b2', icon: 'M16 18l6-6-6-6M8 6l-6 6 6 6', accept: ['html', 'htm'], multiple: false, run: { endpoint: 'run/convert', options: { to: 'pdf' } }, action: 'Convert to PDF', needsLibreOffice: true },

  { id: 'pdf-to-jpg', title: 'PDF to JPG', description: 'Turn every page into a JPG picture.', group: 'Convert from PDF', color: '#eab308', icon: 'M21 15l-5-5L5 21M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', accept: PDF, multiple: false, run: { endpoint: 'run/pdf-to-images', options: { format: 'jpeg' } }, action: 'Convert to JPG' },
  { id: 'pdf-to-png', title: 'PDF to PNG', description: 'Sharp PNG pictures of every page.', group: 'Convert from PDF', color: '#ca8a04', icon: 'M21 15l-5-5L5 21M3 3h18v18H3z', accept: PDF, multiple: false, run: { endpoint: 'run/pdf-to-images', options: { format: 'png' } }, action: 'Convert to PNG' },
  { id: 'pdf-to-word', title: 'PDF to Word', description: 'Copy the text of a PDF into an editable Word file.', group: 'Convert from PDF', color: '#2563eb', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM8 12l1.5 6L12 13l2.5 5L16 12', accept: PDF, multiple: false, run: { endpoint: 'run/convert', options: { to: 'docx' } }, action: 'Convert to Word' },
  { id: 'pdf-to-text', title: 'PDF to Text', description: 'Pull out all the text of a PDF as a .txt file.', group: 'Convert from PDF', color: '#475569', icon: 'M4 6h16M4 12h16M4 18h10', accept: PDF, multiple: false, run: { endpoint: 'run/convert', options: { to: 'txt' } }, action: 'Extract text' },

  { id: 'page-numbers', title: 'Add page numbers', description: 'Number the pages, with the position and style you choose.', group: 'Edit PDF', color: '#db2777', icon: 'M7 20h10M12 4v12M9 7l3-3 3 3', accept: PDF, multiple: false, run: { endpoint: 'run/page-numbers' }, action: 'Add page numbers' },
  { id: 'watermark', title: 'Add watermark', description: 'Stamp text such as COPY or நகல் across the pages.', group: 'Edit PDF', color: '#7c3aed', icon: 'M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z', accept: PDF, multiple: false, run: { endpoint: 'run/watermark' }, action: 'Add watermark' },
  { id: 'pdf-to-template', title: 'PDF to editable template', description: 'Turn a PDF form into a template, then place fill-in fields on it in the designer.', group: 'Edit PDF', color: '#4f46e5', icon: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z', accept: PDF, multiple: false, run: 'template', action: 'Create template', managersOnly: true },
  { id: 'any-convert', title: 'Convert any file', description: 'Pick a file and see every format it can become.', group: 'Convert to PDF', color: '#0f766e', icon: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3', accept: [], multiple: false, run: { endpoint: 'run/convert' }, action: 'Convert' },
];

export const GROUPS: ToolGroup[] = ['Organize PDF', 'Optimize PDF', 'Convert to PDF', 'Convert from PDF', 'Edit PDF'];

export function findTool(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}
