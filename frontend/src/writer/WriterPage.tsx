import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import type { Mark, Node as PmNode } from '@tiptap/pm/model';
import { useSession } from '../app/session';
import { Button, Checkbox, Modal, TextField, useToast } from '../components/kit';
import { ApiError, errorMessage, http } from '../lib/api';
import { baminiToUnicode, looksLikeBamini } from '../lib/bamini';
import { navigate, useSearchParams } from '../lib/router';
import { ThemeToggle } from '../lib/theme';
import type { DocumentDetail } from '../lib/types';
import { toDocx } from './docx';
import { PageBreak, ParagraphFormat, SizedImage, toPt } from './extensions';
import { importFile, textToHtml } from './importers';
import { DEFAULT_PAGE, MARGIN_PRESETS, PAGE_SIZES, pageBox, type PageSetup } from './page';
import { TAMIL_FONT, fixPastedHtml, fixPastedText, isBaminiFont } from './tamil';
import { TAMIL_MODES, TamilKeyboard, type TamilMode } from './tamilKeyboard';
import { FontPicker } from './FontPicker';
import { dropPosition } from './dropdown';
import { fontFaceCss, loadWebFonts, type WebFont } from './fonts';

// Fonts added to the website are fetched from this address by the server's PDF maker (backend services/html-pdf.ts).
const PDF_FONT_ORIGIN = 'http://writer.local';
import { unicodeToBamini } from '../lib/bamini';

// A word processor in the style of WPS Writer / Microsoft Word. It opens .docx, PDF, text and HTML files, fixes
// Tamil typed with the old Bamini font (so copied text is real Tamil, not "mDg;Geh;"), and saves .docx files into
// Documents. Printing uses the browser's print window, which can also save a PDF.

const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const DEFAULT_SIZE = 12;
const LINE_SPACINGS = ['1', '1.15', '1.5', '2', '2.5', '3'];
const PX = 4 / 3; // CSS pixels per point
const THEME_COLORS = ['#000000', '#ffffff', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];
const STANDARD_COLORS = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
const SYMBOLS = ['₹', '©', '®', '™', '°', '±', '×', '÷', '…', '•', '§', '¶', '←', '→', '↑', '↓', '✓', '✔', '✗', '★', '☐', '☑', '½', '¼', '¾', '≤', '≥', '≠', 'ஶ்ரீ', 'ௐ', '௹', '௳', '௴', '௵', '௶', '௷', '௸', '௺'];

const ICONS: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  paste: 'M9 3h6v3H9zM8 4.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-2',
  cut: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  painter: 'M4 3h13v5H4zM17 5.5h3v6h-8v3M10.5 14.5h3V21h-3z',
  clear: 'M4 7V4h16v3M9 20h6M12 4v16M4 18 20 6',
  bullets: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  numbers: 'M10 6h10M10 12h10M10 18h10M4 4h1.5v5M3.5 14h3l-3 5h3',
  indent: 'M3 5h18M11 10h10M11 14h10M3 19h18M3 9l3.5 3L3 15',
  outdent: 'M3 5h18M11 10h10M11 14h10M3 19h18M7 9l-3.5 3L7 15',
  left: 'M3 6h18M3 10h12M3 14h18M3 18h12',
  center: 'M3 6h18M6 10h12M3 14h18M6 18h12',
  right: 'M3 6h18M9 10h12M3 14h18M9 18h12',
  justify: 'M3 6h18M3 10h18M3 14h18M3 18h18',
  spacing: 'M11 6h10M11 12h10M11 18h10M5 4v16M2.5 6.5 5 4l2.5 2.5M2.5 17.5 5 20l2.5-2.5',
  find: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  table: 'M3 4h18v16H3zM3 10h18M3 15h18M9 4v16M15 4v16',
  image: 'M3 5h18v14H3zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 16l-5-5L5 19',
  pageBreak: 'M5 3v5h14V3M5 21v-5h14v5M2 12h3M8 12h3M14 12h3M20 12h2',
  hr: 'M3 12h18M7 8h10M7 16h10',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  date: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
  page: 'M6 2h9l5 5v15H6zM14 2v6h6',
  portrait: 'M6 3h12v18H6z',
  landscape: 'M3 6h18v12H3z',
  margins: 'M4 3h16v18H4zM8 3v18M16 3v18M4 7h16M4 17h16',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7M8 21v-7h8v7',
  open: 'M3 6h6l2 2h10v11H3z',
  newDoc: 'M6 2h9l5 5v15H6zM14 2v6h6M12 11v6M9 14h6',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  count: 'M4 6h16M4 12h10M4 18h7',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M8 11h6M11 8v6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M8 11h6',
  fit: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6',
  selectAll: 'M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4M8 9h8M8 12h8M8 15h5',
  rowAbove: 'M3 10h18v10H3zM3 15h18M12 2v6M9 5h6',
  rowBelow: 'M3 4h18v10H3zM3 9h18M12 16v6M9 19h6',
  colLeft: 'M10 3h11v18H10zM15.5 3v18M2 12h6M5 9v6',
  colRight: 'M3 3h11v18H3zM8.5 3v18M16 12h6M19 9v6',
  delete: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  merge: 'M3 4h18v16H3zM8 12h8M13 9l3 3-3 3M11 9l-3 3 3 3',
  close: 'M6 6l12 12M18 6 6 18',
};

function Svg({ name, className = 'h-[18px] w-[18px]' }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

type Tab = 'home' | 'insert' | 'layout' | 'review' | 'view';

interface OpenDoc {
  id: number;
  name: string;
  versionNo: number;
  isDocx: boolean;
}

// ---------- Text helpers ----------

// Replaces the text of the selection (or of the whole document) one piece at a time, keeping its formatting.
function mapText(editor: Editor, convert: (text: string, block: PmNode) => string | null, fixMarks?: (marks: readonly Mark[]) => readonly Mark[], whole = false): number {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const [a, b] = whole || empty ? [0, state.doc.content.size] : [from, to];
  const edits: { from: number; to: number; text: string; marks: readonly Mark[] }[] = [];
  state.doc.nodesBetween(a, b, (node, pos, parent) => {
    if (!node.isText || !node.text || !parent) return;
    const s = Math.max(a, pos);
    const e = Math.min(b, pos + node.nodeSize);
    const text = node.text.slice(s - pos, e - pos);
    const next = convert(text, parent);
    if (next !== null && next !== text) edits.push({ from: s, to: e, text: next, marks: fixMarks ? fixMarks(node.marks) : node.marks });
  });
  if (edits.length === 0) return 0;
  const tr = state.tr;
  for (const edit of edits.reverse()) tr.replaceWith(edit.from, edit.to, state.schema.text(edit.text, edit.marks));
  editor.view.dispatch(tr);
  return edits.length;
}

// Every place the search text appears, as document positions.
function findAll(doc: PmNode, query: string, matchCase: boolean): { from: number; to: number }[] {
  const results: { from: number; to: number }[] = [];
  if (!query) return results;
  const needle = matchCase ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i += 1) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        map.push(pos + 1 + offset);
        text += '￼';
      }
    });
    const hay = matchCase ? text : text.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) results.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
    return false;
  });
  return results;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Document';

// The look of the page, shared by the editor and the print window.
const CONTENT_CSS = `
  .writer-content { font-family: "${TAMIL_FONT}", Calibri, "Noto Sans Tamil", sans-serif; font-size: ${DEFAULT_SIZE}pt; line-height: 1.5; color: #000; outline: none; word-wrap: break-word; }
  .writer-content p { margin: 0; }
  .writer-content p:empty::after { content: "\\00a0"; }
  .writer-content h1 { font-size: 20pt; font-weight: 700; margin: 12pt 0 6pt; }
  .writer-content h2 { font-size: 16pt; font-weight: 700; margin: 10pt 0 4pt; }
  .writer-content h3 { font-size: 13pt; font-weight: 700; margin: 8pt 0 4pt; }
  .writer-content ul, .writer-content ol { padding-left: 28pt; margin: 0; }
  .writer-content ul { list-style: disc; } .writer-content ol { list-style: decimal; }
  .writer-content ul ul { list-style: circle; } .writer-content ol ol { list-style: lower-alpha; }
  .writer-content blockquote { border-left: 3px solid #cbd5e1; margin: 6pt 0; padding-left: 12pt; color: #334155; }
  .writer-content hr { border: none; border-top: 1px solid #94a3b8; margin: 8pt 0; }
  .writer-content a { color: #1d4ed8; text-decoration: underline; }
  .writer-content table { border-collapse: collapse; width: 100%; margin: 6pt 0; table-layout: fixed; }
  .writer-content td, .writer-content th { border: 1px solid #000; padding: 3pt 5pt; vertical-align: top; }
  .writer-content th { background: #f1f5f9; font-weight: 700; text-align: left; }
  .writer-content img { max-width: 100%; height: auto; display: inline-block; }
  .writer-content .page-break { height: 0; border-top: 1px dashed #94a3b8; margin: 10pt 0; position: relative; }
`;

// ---------- The page ----------

export function WriterPage() {
  const session = useSession();
  const toast = useToast();
  const params = useSearchParams();
  const canSave = session.canEdit && Boolean(session.accountId);

  const [tab, setTab] = useState<Tab>('home');
  const [fileMenu, setFileMenu] = useState(false);
  const [title, setTitle] = useState('Untitled document');
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);
  const [page, setPage] = useState<PageSetup>(DEFAULT_PAGE);
  const [zoom, setZoom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<null | 'save' | 'count' | 'margins'>(null);
  const [findOpen, setFindOpen] = useState<false | 'find' | 'replace'>(false);
  const [autoFix, setAutoFix] = useState(true);
  const [spellcheck, setSpellcheck] = useState(false);
  const [painter, setPainter] = useState<readonly Mark[] | null>(null);
  const [breaks, setBreaks] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [fontColor, setFontColor] = useState('#c00000');
  const [highlightColor, setHighlightColor] = useState('#ffff00');
  const [tamilMode, setTamilModeState] = useState<TamilMode>(() => {
    try {
      return (localStorage.getItem('writer-tamil-mode') as TamilMode | null) ?? 'off';
    } catch {
      return 'off';
    }
  });
  const [lettersOpen, setLettersOpen] = useState(false);
  const [webFonts, setWebFonts] = useState<WebFont[]>([]);
  const tamilModeRef = useRef(tamilMode);
  tamilModeRef.current = tamilMode;
  const lastTamilMode = useRef<TamilMode>(tamilMode === 'off' ? 'phonetic' : tamilMode);
  const autoFixRef = useRef(autoFix);
  autoFixRef.current = autoFix;
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextStyleKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Subscript,
      Superscript,
      TableKit.configure({ table: { resizable: true } }),
      SizedImage,
      ParagraphFormat,
      PageBreak,
      CharacterCount,
      TamilKeyboard.configure({ getMode: () => tamilModeRef.current }),
      Placeholder.configure({ placeholder: 'Start typing, or paste text here. Tamil typed in the old Bamini font is fixed automatically.' }),
    ],
    content: '<p></p>',
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'writer-content', spellcheck: 'false' },
      transformPastedHTML: (html) => (autoFixRef.current ? fixPastedHtml(html) : html),
      transformPastedText: (text) => (autoFixRef.current ? fixPastedText(text) : text),
    },
    onUpdate: () => setDirty(true),
  });

  useEffect(() => {
    editor?.view.dom.setAttribute('spellcheck', String(spellcheck));
  }, [editor, spellcheck]);

  function setTamilMode(mode: TamilMode) {
    setTamilModeState(mode);
    if (mode !== 'off') lastTamilMode.current = mode;
    try {
      localStorage.setItem('writer-tamil-mode', mode);
    } catch {
      // Remembering the choice is only a convenience.
    }
    editor?.commands.focus();
  }

  useEffect(() => {
    void loadWebFonts().then(setWebFonts);
  }, []);

  // ---------- Opening ----------

  const loadContent = useCallback(
    (html: string, nextPage: PageSetup) => {
      if (!editor) return;
      editor.commands.setContent(html || '<p></p>', { emitUpdate: false });
      editor.commands.focus('start');
      setPage(nextPage);
      setDirty(false);
    },
    [editor],
  );

  const openDocument = useCallback(
    async (id: number) => {
      setBusy('Opening the document…');
      try {
        const detail = await http.get<DocumentDetail>(`/documents/${id}`);
        const doc = detail.document;
        if (doc.sourceType !== 'upload' || !doc.fileName) throw new Error('Only uploaded files can be opened in the Writer. Designed documents open in the designer.');
        const res = await fetch(`/api/documents/${id}/file?inline=1`, { credentials: 'include' });
        if (!res.ok) throw new Error('The file could not be loaded.');
        const result = await importFile(doc.fileName, await res.arrayBuffer());
        loadContent(result.html, result.page);
        const isDocx = /\.docx$/i.test(doc.fileName);
        setOpenDoc({ id: doc.id, name: doc.name, versionNo: doc.currentVersionNo, isDocx });
        setTitle(doc.name);
        if (result.bamini) toast('Old Bamini Tamil was changed to Unicode Tamil, so it can now be edited and copied.');
        if (!isDocx) toast('This file opens as a new Word document. Save keeps the original and adds the .docx as a new document.');
      } catch (e) {
        toast(e instanceof ApiError || !(e instanceof Error) ? errorMessage(e) : e.message, 'error');
      } finally {
        setBusy(null);
      }
    },
    [loadContent, toast],
  );

  useEffect(() => {
    const id = Number(params.get('doc'));
    if (editor && id > 0) void openDocument(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  async function openFromComputer(file: File) {
    if (!confirmDiscard()) return;
    setBusy('Opening the file…');
    try {
      const result = await importFile(file.name, await file.arrayBuffer());
      loadContent(result.html, result.page);
      setOpenDoc(null);
      setTitle(file.name.replace(/\.[^.]+$/, ''));
      window.history.replaceState(null, '', '/writer');
      if (result.bamini) toast('Old Bamini Tamil was changed to Unicode Tamil, so it can now be edited and copied.');
    } catch (e) {
      toast(e instanceof Error ? e.message : errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  function confirmDiscard() {
    return !dirty || window.confirm('You have changes that are not saved. Continue without saving them?');
  }

  function newDocument() {
    if (!confirmDiscard()) return;
    loadContent('<p></p>', DEFAULT_PAGE);
    setOpenDoc(null);
    setTitle('Untitled document');
    window.history.replaceState(null, '', '/writer');
  }

  // ---------- Saving ----------

  async function makeDocx() {
    return toDocx(editor!.getJSON(), page, title);
  }

  async function save() {
    if (!editor) return;
    if (!canSave) {
      toast(session.accountId ? 'Your role cannot save documents. Use File → Download instead.' : 'Choose an office in the top bar first, or use File → Download.', 'error');
      return;
    }
    if (!openDoc?.isDocx) {
      setDialog('save');
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append('file', await makeDocx(), `${safeName(openDoc.name)}.docx`);
      form.append('baseVersionNo', String(openDoc.versionNo));
      const result = await http.upload<{ versionNo: number }>(`/documents/${openDoc.id}/file`, form);
      setOpenDoc({ ...openDoc, versionNo: result.versionNo });
      setDirty(false);
      toast(`Saved as version ${result.versionNo}. Earlier versions are kept.`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  // A real PDF made by the server, without the print window (and without needing a printer).
  async function makePdf(): Promise<Blob> {
    const form = new FormData();
    form.append('title', title);
    form.append('html', new Blob([printableHtml(editor!.getHTML(), page, title, webFonts, PDF_FONT_ORIGIN)], { type: 'text/html' }), 'page.html');
    const res = await fetch('/api/writer/pdf', { method: 'POST', body: form, credentials: 'include' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `The PDF could not be made (error ${res.status}).`);
    }
    return res.blob();
  }

  async function saveAsNew(name: string, folder: string, format: 'docx' | 'pdf') {
    setSaving(true);
    try {
      const form = new FormData();
      if (format === 'pdf') {
        form.append('file', await makePdf(), `${safeName(name)}.pdf`);
        form.append('name', name);
        form.append('folder', folder);
        await http.upload<{ id: number }>('/documents/upload', form);
        setDialog(null);
        toast('Saved to Documents as a PDF. You can keep editing here.');
        return;
      }
      form.append('file', await makeDocx(), `${safeName(name)}.docx`);
      form.append('name', name);
      form.append('folder', folder);
      const result = await http.upload<{ id: number }>('/documents/upload', form);
      setOpenDoc({ id: result.id, name, versionNo: 1, isDocx: true });
      setTitle(name);
      setDirty(false);
      setDialog(null);
      window.history.replaceState(null, '', `/writer?doc=${result.id}`);
      toast('Saved to Documents as a Word file.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function downloadAs(kind: 'docx' | 'pdf' | 'html' | 'txt') {
    if (!editor) return;
    setFileMenu(false);
    const name = safeName(title);
    if (kind === 'docx') {
      setBusy('Making the Word file…');
      try {
        download(await makeDocx(), `${name}.docx`);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'The Word file could not be made.', 'error');
      } finally {
        setBusy(null);
      }
    } else if (kind === 'pdf') {
      setBusy('Making the PDF…');
      try {
        download(await makePdf(), `${name}.pdf`);
      } catch (e) {
        toast(e instanceof Error ? e.message : errorMessage(e), 'error');
      } finally {
        setBusy(null);
      }
    } else if (kind === 'html') {
      download(new Blob([printableHtml(editor.getHTML(), page, title, webFonts)], { type: 'text/html' }), `${name}.html`);
    } else {
      download(new Blob([editor.getText({ blockSeparator: '\r\n' })], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
    }
  }

  function print() {
    if (!editor) return;
    setFileMenu(false);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(printableHtml(editor.getHTML(), page, title, webFonts));
    doc.close();
    const go = () => {
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      setTimeout(() => frame.remove(), 1000);
    };
    // Wait for pictures before printing.
    const images = Array.from(doc.images);
    Promise.all([doc.fonts.ready, ...images.map((i) => (i.complete ? null : new Promise((ok) => ((i.onload = ok), (i.onerror = ok)))))]).then(() => setTimeout(go, 50));
  }

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Keyboard shortcuts for the whole page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt+T switches between English and the last Tamil keyboard.
      if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setTamilMode(tamilModeRef.current === 'off' ? lastTamilMode.current : 'off');
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void save();
      } else if (key === 'p') {
        e.preventDefault();
        print();
      } else if (key === 'f') {
        e.preventDefault();
        setFindOpen('find');
      } else if (key === 'h') {
        e.preventDefault();
        setFindOpen('replace');
      } else if (key === 'o') {
        e.preventDefault();
        fileInput.current?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- Page guides: where each printed page starts ----------

  const box = pageBox(page);
  const contentHeightPx = (box.height - page.margins.top - page.margins.bottom) * PX;

  const measure = useCallback(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const found: number[] = [];
    let start = 0;
    for (const child of Array.from(dom.children) as HTMLElement[]) {
      const top = child.offsetTop;
      const bottom = top + child.offsetHeight;
      if (child.classList.contains('page-break')) {
        start = bottom;
        found.push(bottom);
      } else if (bottom - start > contentHeightPx && top > start) {
        start = top;
        found.push(top);
      }
    }
    setBreaks((old) => (old.length === found.length && old.every((v, i) => Math.abs(v - found[i]) < 1) ? old : found));
    const sel = editor.view.domAtPos(editor.state.selection.from).node;
    const el = (sel.nodeType === 1 ? sel : sel.parentElement) as HTMLElement | null;
    const y = el ? el.getBoundingClientRect().top - dom.getBoundingClientRect().top : 0;
    setCurrentPage(found.filter((b) => b * zoom <= y + 1).length + 1);
  }, [editor, contentHeightPx, zoom]);

  useLayoutEffect(() => {
    measure();
  });

  // ---------- Format painter ----------

  function pickFormat() {
    if (!editor) return;
    if (painter) {
      setPainter(null);
      return;
    }
    const { $from } = editor.state.selection;
    setPainter(editor.state.storedMarks ?? $from.marks());
  }

  function applyPainter() {
    if (!editor || !painter) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const tr = editor.state.tr;
    tr.removeMark(from, to);
    for (const mark of painter) tr.addMark(from, to, mark);
    editor.view.dispatch(tr);
    setPainter(null);
  }

  // ---------- Tamil ----------

  function fixTamil(whole: boolean) {
    if (!editor) return;
    const selected = !whole && !editor.state.selection.empty;
    const fixMarks = (marks: readonly Mark[]) =>
      marks.map((m) => (m.type.name === 'textStyle' && isBaminiFont(m.attrs.fontFamily) ? m.type.create({ ...m.attrs, fontFamily: TAMIL_FONT }) : m));
    // A chosen selection is always converted; for the whole document only paragraphs that read as Bamini are.
    const count = mapText(editor, (text, block) => (selected || looksLikeBamini(block.textContent) ? baminiToUnicode(text) : null), fixMarks, whole);
    toast(count > 0 ? 'Changed to Unicode Tamil.' : selected ? 'Nothing to change in the selected text.' : 'No Bamini text was found. Select the text and try again to change it anyway.');
  }

  function changeCase(kind: 'upper' | 'lower' | 'title') {
    if (!editor) return;
    mapText(editor, (text) => (kind === 'upper' ? text.toUpperCase() : kind === 'lower' ? text.toLowerCase() : text.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, s, c) => s + c.toUpperCase())));
  }

  // ---------- Clipboard ----------

  async function pasteFromClipboard(plain: boolean) {
    if (!editor) return;
    try {
      if (!plain && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('text/html')) {
            const html = await (await item.getType('text/html')).text();
            editor.chain().focus().insertContent(autoFix ? fixPastedHtml(html) : html).run();
            return;
          }
          const imageType = item.types.find((t) => t.startsWith('image/'));
          if (imageType) {
            const src = await blobToDataUrl(await item.getType(imageType));
            editor.chain().focus().setImage({ src }).run();
            return;
          }
        }
      }
      const text = await navigator.clipboard.readText();
      editor.chain().focus().insertContent(textToHtml(autoFix ? fixPastedText(text) : text)).run();
    } catch {
      toast('The browser did not allow reading the clipboard. Press Ctrl+V in the page instead.', 'error');
    }
  }

  function clipboardCommand(command: 'cut' | 'copy') {
    editor?.commands.focus();
    if (!document.execCommand(command)) toast(`Press Ctrl+${command === 'cut' ? 'X' : 'C'} instead.`, 'error');
  }

  async function insertImage(file: File) {
    if (!editor) return;
    if (file.size > 10 * 1024 * 1024) {
      toast('Pictures must be smaller than 10 MB.', 'error');
      return;
    }
    editor.chain().focus().setImage({ src: await blobToDataUrl(file) }).run();
  }

  if (!editor) return null;

  const textStyle = editor.getAttributes('textStyle');
  const currentFont = typeof textStyle.fontFamily === 'string' ? textStyle.fontFamily.split(',')[0].replace(/["']/g, '').trim() : '';
  const currentSize = toPt(textStyle.fontSize) ?? (editor.isActive('heading', { level: 1 }) ? 20 : editor.isActive('heading', { level: 2 }) ? 16 : editor.isActive('heading', { level: 3 }) ? 13 : DEFAULT_SIZE);
  const blockAttrs = editor.isActive('heading') ? editor.getAttributes('heading') : editor.getAttributes('paragraph');
  const inTable = editor.isActive('table');
  const onImage = editor.isActive('image');
  const words = editor.storage.characterCount.words() as number;
  const chars = editor.storage.characterCount.characters() as number;
  const pages = breaks.length + 1;
  const sheetWidthPx = box.width * PX;

  function setSize(size: number) {
    editor!.chain().focus().setFontSize(`${size}pt`).run();
  }
  function stepSize(dir: 1 | -1) {
    const next = dir > 0 ? SIZES.find((s) => s > currentSize) ?? currentSize + 4 : [...SIZES].reverse().find((s) => s < currentSize) ?? Math.max(1, currentSize - 1);
    setSize(next);
  }
  function fitWidth() {
    const width = workspace.current?.clientWidth ?? 1000;
    setZoom(Math.max(0.3, Math.min(3, Math.round(((width - 64) / sheetWidthPx) * 20) / 20)));
  }

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-800">
      <style>{CONTENT_CSS}{WRITER_CHROME_CSS}</style>

      {/* Title bar */}
      <header className="flex items-center gap-2 bg-gradient-to-r from-blue-700 to-indigo-700 px-3 py-1.5 text-white">
        <button
          type="button"
          onClick={() => confirmDiscard() && (setDirty(false), navigate(openDoc ? `/documents/${openDoc.id}` : '/'))}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-white/15"
          title="Back"
        >
          <Svg name="back" /> Back
        </button>
        <span className="flex h-7 w-7 items-center justify-center rounded bg-white text-sm font-bold text-blue-700">W</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Document name"
          className="w-64 min-w-0 rounded-md bg-transparent px-2 py-1 text-sm font-medium outline-none hover:bg-white/10 focus:bg-white/20"
        />
        <span className="text-xs text-white/75">{saving ? 'Saving…' : dirty ? 'Not saved' : openDoc ? `Saved · version ${openDoc.versionNo}` : ''}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} className="rounded p-1.5 hover:bg-white/15 disabled:opacity-40" title="Undo (Ctrl+Z)">
            <Svg name="undo" />
          </button>
          <button type="button" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} className="rounded p-1.5 hover:bg-white/15 disabled:opacity-40" title="Redo (Ctrl+Y)">
            <Svg name="redo" />
          </button>
          <button type="button" onClick={() => void save()} className="flex items-center gap-1.5 rounded-md bg-white px-3 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-50" title="Save (Ctrl+S)">
            <Svg name="save" className="h-4 w-4" /> Save
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Ribbon tabs */}
      <nav className="relative flex items-end gap-1 border-b border-slate-200 bg-surface px-3 pt-1" aria-label="Ribbon">
        <button type="button" onClick={() => setFileMenu((v) => !v)} className={`rounded-t-md px-4 py-1.5 text-sm font-medium ${fileMenu ? 'bg-blue-700 text-white' : 'text-blue-700 hover:bg-blue-50'}`}>
          File
        </button>
        {(
          [
            ['home', 'Home'],
            ['insert', 'Insert'],
            ['layout', 'Page Layout'],
            ['review', 'Review'],
            ['view', 'View'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setFileMenu(false);
            }}
            className={`border-b-2 px-4 py-1.5 text-sm ${tab === id ? 'border-blue-600 font-semibold text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
          >
            {label}
          </button>
        ))}
        {inTable && (
          <button type="button" onClick={() => setTab('insert')} className="ml-2 rounded-t-md bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800">
            Table tools
          </button>
        )}
        {fileMenu && (
          <FileMenu
            onClose={() => setFileMenu(false)}
            items={[
              { icon: 'newDoc', label: 'New', onClick: newDocument },
              { icon: 'open', label: 'Open from computer…', hint: 'Ctrl+O', onClick: () => fileInput.current?.click() },
              { icon: 'save', label: 'Save', hint: 'Ctrl+S', onClick: () => void save() },
              { icon: 'save', label: 'Save as new document (Word or PDF)…', onClick: () => (canSave ? setDialog('save') : void save()) },
              { icon: 'download', label: 'Download as Word (.docx)', onClick: () => void downloadAs('docx') },
              { icon: 'download', label: 'Download as PDF', onClick: () => void downloadAs('pdf') },
              { icon: 'download', label: 'Download as web page (.html)', onClick: () => void downloadAs('html') },
              { icon: 'download', label: 'Download as text (.txt)', onClick: () => void downloadAs('txt') },
              { icon: 'print', label: 'Print…', hint: 'Ctrl+P', onClick: print },
            ]}
          />
        )}
      </nav>

      {/* Ribbon */}
      <div className="flex min-h-[92px] items-stretch overflow-x-auto border-b border-slate-200 bg-surface px-2 py-1.5 shadow-sm">
        {tab === 'home' && (
          <>
            <Group label="Clipboard">
              <Big icon="paste" label="Paste" onClick={() => void pasteFromClipboard(false)} title="Paste (Ctrl+V). Bamini Tamil is fixed automatically." />
              <div className="flex flex-col gap-0.5">
                <Tb title="Cut (Ctrl+X)" onClick={() => clipboardCommand('cut')}>
                  <Svg name="cut" /> <span className="text-xs">Cut</span>
                </Tb>
                <Tb title="Copy (Ctrl+C)" onClick={() => clipboardCommand('copy')}>
                  <Svg name="copy" /> <span className="text-xs">Copy</span>
                </Tb>
                <Tb title="Paste as plain text" onClick={() => void pasteFromClipboard(true)}>
                  <Svg name="paste" /> <span className="text-xs">Text only</span>
                </Tb>
              </div>
              <Big icon="painter" label="Format Painter" active={Boolean(painter)} onClick={pickFormat} title="Copy the formatting of the text at the cursor, then select other text to apply it" />
            </Group>

            <Group label="Tamil">
              <div className="flex flex-col gap-1">
                <select
                  value={tamilMode}
                  onChange={(e) => setTamilMode(e.target.value as TamilMode)}
                  aria-label="Keyboard"
                  title="Type Tamil with the English keyboard (Alt+T switches on and off)"
                  className={`h-7 w-44 rounded border px-1 text-sm ${tamilMode === 'off' ? 'border-slate-300 bg-surface' : 'border-emerald-400 bg-emerald-50 text-emerald-900'}`}
                >
                  {TAMIL_MODES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id === 'off' ? 'Keyboard: English' : m.label}
                    </option>
                  ))}
                </select>
                <Tb title="Show Tamil letters to click" active={lettersOpen} onClick={() => setLettersOpen((v) => !v)}>
                  <span className="text-xs">அ ஆ இ  Tamil letters</span>
                </Tb>
              </div>
              <Big glyph="அ" label="Fix Tamil" onClick={() => fixTamil(false)} title="Change Bamini text (like mDg;Geh;) into real Tamil (அனுப்புநர்). Select text first, or nothing to fix the whole document." />
              <label className="flex w-20 items-start gap-1 text-[11px] leading-tight text-slate-600" title="Text pasted in the old Bamini font is changed to Unicode Tamil">
                <input type="checkbox" className="mt-0.5" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)} /> Auto-fix when pasting
              </label>
            </Group>

            <Group label="Font">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <FontPicker
                    value={currentFont}
                    canManage={session.canManage}
                    webFonts={webFonts}
                    onFontsChanged={setWebFonts}
                    onPick={(f) => (f ? editor.chain().focus().setFontFamily(/^[\w -]+$/.test(f) && !/^\d/.test(f) ? f : `"${f}"`).run() : editor.chain().focus().unsetFontFamily().run())}
                  />
                  <SizeBox value={currentSize} onChange={setSize} />
                  <Tb title="Grow font" onClick={() => stepSize(1)}>
                    <span className="text-sm font-semibold">A<sup>+</sup></span>
                  </Tb>
                  <Tb title="Shrink font" onClick={() => stepSize(-1)}>
                    <span className="text-xs font-semibold">A<sup>−</sup></span>
                  </Tb>
                  <Menu
                    trigger={(toggle) => (
                      <Tb title="Change case" onClick={toggle}>
                        <span className="text-sm">Aa</span>
                      </Tb>
                    )}
                  >
                    {(close) => (
                      <div className="w-44 py-1">
                        {(
                          [
                            ['upper', 'UPPERCASE'],
                            ['lower', 'lowercase'],
                            ['title', 'Capitalize Each Word'],
                          ] as const
                        ).map(([k, label]) => (
                          <MenuItem key={k} onClick={() => (changeCase(k), close())}>
                            {label}
                          </MenuItem>
                        ))}
                      </div>
                    )}
                  </Menu>
                  <Tb title="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().setParagraph().run()}>
                    <Svg name="clear" />
                  </Tb>
                </div>
                <div className="flex items-center gap-0.5">
                  <Tb title="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
                    <span className="w-4 font-bold">B</span>
                  </Tb>
                  <Tb title="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
                    <span className="w-4 font-serif italic">I</span>
                  </Tb>
                  <Tb title="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
                    <span className="w-4 underline">U</span>
                  </Tb>
                  <Tb title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
                    <span className="w-4 line-through">ab</span>
                  </Tb>
                  <Tb title="Superscript" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().unsetSubscript().toggleSuperscript().run()}>
                    <span>
                      x<sup>2</sup>
                    </span>
                  </Tb>
                  <Tb title="Subscript" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().unsetSuperscript().toggleSubscript().run()}>
                    <span>
                      x<sub>2</sub>
                    </span>
                  </Tb>
                  <ColorButton
                    title="Highlight"
                    color={highlightColor}
                    noneLabel="No highlight"
                    glyph={<span className="px-0.5 text-sm font-semibold" style={{ background: highlightColor }}>ab</span>}
                    onApply={(c) => {
                      if (c) setHighlightColor(c);
                      if (c) editor.chain().focus().setBackgroundColor(c).run();
                      else editor.chain().focus().unsetBackgroundColor().run();
                    }}
                  />
                  <ColorButton
                    title="Font colour"
                    color={fontColor}
                    noneLabel="Automatic (black)"
                    glyph={
                      <span className="flex flex-col items-center leading-none">
                        <span className="text-sm font-semibold">A</span>
                        <span className="mt-0.5 h-1 w-4" style={{ background: fontColor }} />
                      </span>
                    }
                    onApply={(c) => {
                      if (c) setFontColor(c);
                      if (c) editor.chain().focus().setColor(c).run();
                      else editor.chain().focus().unsetColor().run();
                    }}
                  />
                </div>
              </div>
            </Group>

            <Group label="Paragraph">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-0.5">
                  <Tb title="Bullets" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
                    <Svg name="bullets" />
                  </Tb>
                  <Tb title="Numbering" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
                    <Svg name="numbers" />
                  </Tb>
                  <Tb
                    title="Decrease indent (Shift+Tab)"
                    onClick={() => (editor.isActive('listItem') ? editor.chain().focus().liftListItem('listItem').run() : editor.chain().focus().changeIndent(-36).run())}
                  >
                    <Svg name="outdent" />
                  </Tb>
                  <Tb
                    title="Increase indent (Tab)"
                    onClick={() => (editor.isActive('listItem') ? editor.chain().focus().sinkListItem('listItem').run() : editor.chain().focus().changeIndent(36).run())}
                  >
                    <Svg name="indent" />
                  </Tb>
                  <Menu
                    trigger={(toggle) => (
                      <Tb title="Line and paragraph spacing" onClick={toggle}>
                        <Svg name="spacing" />
                      </Tb>
                    )}
                  >
                    {(close) => (
                      <div className="w-52 py-1">
                        {LINE_SPACINGS.map((v) => (
                          <MenuItem key={v} active={String(blockAttrs.lineHeight ?? '') === v} onClick={() => (editor.chain().focus().setParagraphFormat({ lineHeight: v }).run(), close())}>
                            {v}
                          </MenuItem>
                        ))}
                        <div className="my-1 border-t border-slate-200" />
                        <MenuItem onClick={() => (editor.chain().focus().setParagraphFormat({ spaceBefore: blockAttrs.spaceBefore ? null : 12 }).run(), close())}>
                          {blockAttrs.spaceBefore ? 'Remove space before paragraph' : 'Add space before paragraph'}
                        </MenuItem>
                        <MenuItem onClick={() => (editor.chain().focus().setParagraphFormat({ spaceAfter: blockAttrs.spaceAfter ? null : 12 }).run(), close())}>
                          {blockAttrs.spaceAfter ? 'Remove space after paragraph' : 'Add space after paragraph'}
                        </MenuItem>
                        <MenuItem onClick={() => (editor.chain().focus().setParagraphFormat({ firstLine: blockAttrs.firstLine ? 0 : 36 }).run(), close())}>
                          {blockAttrs.firstLine ? 'Remove first-line indent' : 'First-line indent'}
                        </MenuItem>
                      </div>
                    )}
                  </Menu>
                </div>
                <div className="flex items-center gap-0.5">
                  {(['left', 'center', 'right', 'justify'] as const).map((a) => (
                    <Tb
                      key={a}
                      title={{ left: 'Align left (Ctrl+Shift+L)', center: 'Centre (Ctrl+Shift+E)', right: 'Align right (Ctrl+Shift+R)', justify: 'Justify (Ctrl+Shift+J)' }[a]}
                      active={editor.isActive({ textAlign: a }) || (a === 'left' && !blockAttrs.textAlign)}
                      onClick={() => editor.chain().focus().setTextAlign(a).run()}
                    >
                      <Svg name={a} />
                    </Tb>
                  ))}
                  <Tb title="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
                    <span className="text-lg leading-none">”</span>
                  </Tb>
                </div>
              </div>
            </Group>

            <Group label="Styles">
              <div className="flex items-center gap-1.5">
                <StyleTile label="Normal" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()} />
                {([1, 2, 3] as const).map((level) => (
                  <StyleTile
                    key={level}
                    label={`Heading ${level}`}
                    big={level}
                    active={editor.isActive('heading', { level })}
                    onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
                  />
                ))}
              </div>
            </Group>

            <Group label="Editing">
              <Big icon="find" label="Find & Replace" onClick={() => setFindOpen('replace')} title="Find and replace (Ctrl+H)" />
              <Big icon="selectAll" label="Select all" onClick={() => editor.chain().focus().selectAll().run()} />
            </Group>

          </>
        )}

        {tab === 'insert' && (
          <>
            <Group label="Tables">
              <TablePicker onPick={(rows, cols) => editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run()} />
            </Group>
            <Group label="Illustrations">
              <Big icon="image" label="Picture" onClick={() => imageInput.current?.click()} />
              {onImage && (
                <div className="ml-1 flex flex-col gap-0.5">
                  <span className="text-xs text-slate-500">Picture size</span>
                  <div className="flex gap-0.5">
                    {[25, 50, 75, 100].map((p) => (
                      <Tb key={p} title={`${p}% of the page width`} onClick={() => editor.chain().focus().updateAttributes('image', { width: Math.round(((box.width - page.margins.left - page.margins.right) * PX * p) / 100) }).run()}>
                        <span className="text-xs">{p}%</span>
                      </Tb>
                    ))}
                  </div>
                </div>
              )}
            </Group>
            <Group label="Pages">
              <Big icon="pageBreak" label="Page break" onClick={() => editor.chain().focus().insertPageBreak().run()} title="Start a new page (Ctrl+Enter)" />
              <Big icon="hr" label="Line" onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal line" />
            </Group>
            <Group label="Links & text">
              <Big
                icon="link"
                label="Link"
                active={editor.isActive('link')}
                onClick={() => {
                  const old = editor.getAttributes('link').href as string | undefined;
                  const url = window.prompt('Web address for the link (leave empty to remove it):', old ?? 'https://');
                  if (url === null) return;
                  if (!url.trim() || url.trim() === 'https://') editor.chain().focus().extendMarkRange('link').unsetLink().run();
                  else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
                }}
              />
              <Big
                icon="date"
                label="Date"
                onClick={() => editor.chain().focus().insertContent(new Date().toLocaleDateString('en-GB').replace(/\//g, '-')).run()}
                title="Insert today's date"
              />
              <Menu trigger={(toggle) => <Big glyph="Ω" label="Symbol" onClick={toggle} />}>
                {(close) => (
                  <div className="grid w-72 grid-cols-8 gap-1 p-2">
                    {SYMBOLS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => (editor.chain().focus().insertContent(s).run(), close())}
                        className="h-8 rounded border border-slate-200 text-base hover:bg-blue-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </Menu>
            </Group>
            {inTable && (
              <Group label="Table tools">
                <div className="flex flex-col gap-0.5">
                  <div className="flex gap-0.5">
                    <Tb title="Insert row above" onClick={() => editor.chain().focus().addRowBefore().run()}>
                      <Svg name="rowAbove" />
                    </Tb>
                    <Tb title="Insert row below" onClick={() => editor.chain().focus().addRowAfter().run()}>
                      <Svg name="rowBelow" />
                    </Tb>
                    <Tb title="Insert column left" onClick={() => editor.chain().focus().addColumnBefore().run()}>
                      <Svg name="colLeft" />
                    </Tb>
                    <Tb title="Insert column right" onClick={() => editor.chain().focus().addColumnAfter().run()}>
                      <Svg name="colRight" />
                    </Tb>
                    <Tb title="Merge or split cells" disabled={!editor.can().mergeOrSplit()} onClick={() => editor.chain().focus().mergeOrSplit().run()}>
                      <Svg name="merge" />
                    </Tb>
                  </div>
                  <div className="flex gap-0.5">
                    <Tb title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>
                      <span className="text-xs">− Row</span>
                    </Tb>
                    <Tb title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>
                      <span className="text-xs">− Column</span>
                    </Tb>
                    <Tb title="Header row" active={editor.isActive('tableHeader')} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
                      <span className="text-xs">Header</span>
                    </Tb>
                    <Tb title="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>
                      <Svg name="delete" />
                    </Tb>
                  </div>
                </div>
                <ColorButton
                  title="Cell shading"
                  color="#fff2cc"
                  noneLabel="No shading"
                  glyph={<span className="text-xs">Shade</span>}
                  onApply={(c) => editor.chain().focus().setCellAttribute('backgroundColor', c).run()}
                />
              </Group>
            )}
          </>
        )}

        {tab === 'layout' && (
          <>
            <Group label="Page setup">
              <Menu trigger={(toggle) => <Big icon="margins" label="Margins" onClick={toggle} />}>
                {(close) => (
                  <div className="w-56 py-1">
                    {MARGIN_PRESETS.map((m) => (
                      <MenuItem key={m.label} active={JSON.stringify(m.margins) === JSON.stringify(page.margins)} onClick={() => (setPage({ ...page, margins: m.margins }), setDirty(true), close())}>
                        {m.label}
                      </MenuItem>
                    ))}
                    <div className="my-1 border-t border-slate-200" />
                    <MenuItem onClick={() => (setDialog('margins'), close())}>Custom margins…</MenuItem>
                  </div>
                )}
              </Menu>
              <Menu trigger={(toggle) => <Big icon={page.landscape ? 'landscape' : 'portrait'} label="Orientation" onClick={toggle} />}>
                {(close) => (
                  <div className="w-40 py-1">
                    <MenuItem active={!page.landscape} onClick={() => (setPage({ ...page, landscape: false }), setDirty(true), close())}>
                      Portrait
                    </MenuItem>
                    <MenuItem active={page.landscape} onClick={() => (setPage({ ...page, landscape: true }), setDirty(true), close())}>
                      Landscape
                    </MenuItem>
                  </div>
                )}
              </Menu>
              <Menu trigger={(toggle) => <Big icon="page" label="Size" onClick={toggle} />}>
                {(close) => (
                  <div className="w-56 py-1">
                    {PAGE_SIZES.map((s) => (
                      <MenuItem
                        key={s.label}
                        active={Math.abs(s.width - page.width) < 1 && Math.abs(s.height - page.height) < 1}
                        onClick={() => (setPage({ ...page, width: s.width, height: s.height }), setDirty(true), close())}
                      >
                        {s.label}
                      </MenuItem>
                    ))}
                  </div>
                )}
              </Menu>
            </Group>
            <Group label="Paragraph">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                <NumberBox label="Left indent (cm)" value={(blockAttrs.indent ?? 0) / 28.35} onChange={(v) => editor.chain().focus().setParagraphFormat({ indent: Math.round(v * 28.35) }).run()} />
                <NumberBox label="Space before (pt)" value={blockAttrs.spaceBefore ?? 0} onChange={(v) => editor.chain().focus().setParagraphFormat({ spaceBefore: v || null }).run()} />
                <NumberBox label="First line (cm)" value={(blockAttrs.firstLine ?? 0) / 28.35} onChange={(v) => editor.chain().focus().setParagraphFormat({ firstLine: Math.round(v * 28.35) }).run()} />
                <NumberBox label="Space after (pt)" value={blockAttrs.spaceAfter ?? 0} onChange={(v) => editor.chain().focus().setParagraphFormat({ spaceAfter: v || null }).run()} />
              </div>
            </Group>
            <Group label="Page break">
              <Big icon="pageBreak" label="Breaks" onClick={() => editor.chain().focus().insertPageBreak().run()} />
            </Group>
          </>
        )}

        {tab === 'review' && (
          <>
            <Group label="Proofing">
              <Big icon="count" label="Word count" onClick={() => setDialog('count')} />
              <Big glyph="✓" label={spellcheck ? 'Spelling: on' : 'Spelling: off'} active={spellcheck} onClick={() => setSpellcheck((v) => !v)} title="Underline spelling mistakes (English)" />
            </Group>
            <Group label="Tamil">
              <Big glyph="அ" label="Fix whole document" onClick={() => fixTamil(true)} title="Change every paragraph written in Bamini into Unicode Tamil" />
              <Big glyph="அ" label="Fix selected text" onClick={() => fixTamil(false)} title="Change the selected text from Bamini into Unicode Tamil" />
            </Group>
            <Group label="Find">
              <Big icon="find" label="Find" onClick={() => setFindOpen('find')} />
              <Big icon="find" label="Replace" onClick={() => setFindOpen('replace')} />
            </Group>
          </>
        )}

        {tab === 'view' && (
          <Group label="Zoom">
            <Big icon="zoomOut" label="Zoom out" onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 10) / 10))} />
            <Big glyph="100%" label="Actual size" onClick={() => setZoom(1)} />
            <Big icon="zoomIn" label="Zoom in" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 10) / 10))} />
            <Big icon="fit" label="Page width" onClick={fitWidth} />
          </Group>
        )}
      </div>

      {/* Page */}
      <div ref={workspace} className="relative flex-1 overflow-auto bg-slate-200/70 py-6" onMouseUp={applyPainter} style={painter ? { cursor: 'copy' } : undefined}>
        <div style={{ zoom }} className="mx-auto w-fit">
          <div
            className="writer-sheet relative mx-auto shadow-lg"
            style={{
              width: `${box.width}pt`,
              minHeight: `${box.height}pt`,
              padding: `${page.margins.top}pt ${page.margins.right}pt ${page.margins.bottom}pt ${page.margins.left}pt`,
              background: '#fff',
              color: '#000',
            }}
            onClick={(e) => e.target === e.currentTarget && editor.commands.focus('end')}
          >
            <div className="relative">
              <EditorContent editor={editor} />
              {breaks.map((y, i) => (
                <div key={i} className="pointer-events-none absolute border-t border-dashed border-sky-400" style={{ top: y - 1, left: `-${page.margins.left}pt`, right: `-${page.margins.right}pt` }}>
                  <span className="absolute -top-2.5 right-1 rounded bg-sky-100 px-1.5 text-[10px] text-sky-700">Page {i + 2}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {findOpen && <FindPanel editor={editor} mode={findOpen} onMode={setFindOpen} onClose={() => setFindOpen(false)} />}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <div className="rounded-lg bg-surface px-4 py-3 text-sm shadow">{busy}</div>
          </div>
        )}
      </div>

      {lettersOpen && <TamilLetters mode={tamilMode} onInsert={(t) => editor.chain().focus().insertContent(t).run()} onClose={() => setLettersOpen(false)} />}

      {/* Status bar */}
      <footer className="flex items-center gap-4 border-t border-slate-200 bg-surface px-3 py-1 text-xs text-slate-600">
        <span>
          Page {Math.min(currentPage, pages)} of {pages}
        </span>
        <button type="button" onClick={() => setDialog('count')} className="hover:text-slate-900">
          Words: {words}
        </button>
        <span>Characters: {chars}</span>
        <button
          type="button"
          onClick={() => setTamilMode(tamilMode === 'off' ? lastTamilMode.current : 'off')}
          title="Switch keyboard (Alt+T)"
          className={`rounded px-1.5 font-medium ${tamilMode === 'off' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-800'}`}
        >
          {tamilMode === 'off' ? 'ENG' : `தமிழ் · ${{ phonetic: 'Phonetic', bamini: 'Bamini', tamil99: 'Tamil99' }[tamilMode]}`}
        </button>
        {painter && <span className="rounded bg-amber-100 px-1.5 text-amber-800">Format painter: select text to apply</span>}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 10) / 10))} className="px-1 text-base leading-none" aria-label="Zoom out">
            −
          </button>
          <input type="range" min={30} max={300} step={5} value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} className="w-28" aria-label="Zoom" />
          <button type="button" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 10) / 10))} className="px-1 text-base leading-none" aria-label="Zoom in">
            +
          </button>
          <span className="w-10 text-right">{Math.round(zoom * 100)}%</span>
        </div>
      </footer>

      <input ref={fileInput} type="file" accept=".docx,.dotx,.pdf,.txt,.html,.htm,.md" className="hidden" onChange={(e) => (e.target.files?.[0] && void openFromComputer(e.target.files[0]), (e.target.value = ''))} />
      <input ref={imageInput} type="file" accept="image/*" className="hidden" onChange={(e) => (e.target.files?.[0] && void insertImage(e.target.files[0]), (e.target.value = ''))} />

      {dialog === 'save' && <SaveDialog initialName={title} busy={saving} onCancel={() => setDialog(null)} onSave={saveAsNew} />}
      {dialog === 'margins' && (
        <MarginsDialog
          page={page}
          onCancel={() => setDialog(null)}
          onApply={(margins) => {
            setPage({ ...page, margins });
            setDirty(true);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'count' && (
        <Modal title="Word count" onClose={() => setDialog(null)} footer={<Button onClick={() => setDialog(null)}>Close</Button>}>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Pages</dt>
            <dd>{pages}</dd>
            <dt className="text-slate-500">Words</dt>
            <dd>{words}</dd>
            <dt className="text-slate-500">Characters (with spaces)</dt>
            <dd>{chars}</dd>
            <dt className="text-slate-500">Characters (no spaces)</dt>
            <dd>{editor.getText().replace(/\s/g, '').length}</dd>
            <dt className="text-slate-500">Paragraphs</dt>
            <dd>{editor.getText({ blockSeparator: '\n' }).split('\n').filter((l) => l.trim()).length}</dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}

// A full HTML page with the document, sized for printing.
function printableHtml(html: string, page: PageSetup, title: string, webFonts: WebFont[], fontOrigin = window.location.origin): string {
  const box = pageBox(page);
  const body = withLegacyKeys(html, webFonts);
  const m = page.margins;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: ${box.width}pt ${box.height}pt; margin: ${m.top}pt ${m.right}pt ${m.bottom}pt ${m.left}pt; }
    ${fontFaceCss(webFonts, fontOrigin)}
    html, body { margin: 0; background: #fff; }
    ${CONTENT_CSS}
    .writer-content .page-break { border: 0; margin: 0; break-after: page; }
    .writer-content table, .writer-content img { break-inside: avoid; }
  </style></head><body><div class="writer-content">${body}</div></body></html>`;
}

// Old Bamini-style fonts draw Tamil over English keys, so text set in them is printed as those keys.
function withLegacyKeys(html: string, webFonts: WebFont[]): string {
  const legacy = new Set(webFonts.filter((f) => f.encoding === 'bamini').map((f) => f.family.toLowerCase()));
  if (legacy.size === 0) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  doc.querySelectorAll<HTMLElement>('[style*="font-family"]').forEach((el) => {
    if (!legacy.has(el.style.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase())) return;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      // A nested span with another font is handled on its own.
      if (text.parentElement?.closest('[style*="font-family"]') === el) text.data = unicodeToBamini(text.data);
    }
  });
  return doc.body.firstElementChild!.innerHTML;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onload = () => ok(String(reader.result));
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(blob);
  });
}

const WRITER_CHROME_CSS = `
  .writer-content p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #94a3b8; float: left; height: 0; pointer-events: none; }
  .writer-content .page-break::after { content: "Page break"; position: absolute; left: 50%; top: -8px; transform: translateX(-50%); background: #fff; color: #64748b; font-size: 9px; padding: 0 6px; font-family: system-ui, sans-serif; }
  .writer-content .page-break.ProseMirror-selectednode { border-top-color: #2563eb; }
  .writer-content img.ProseMirror-selectednode { outline: 2px solid #2563eb; }
  .writer-content .selectedCell::after { content: ""; position: absolute; inset: 0; background: rgba(37, 99, 235, 0.15); pointer-events: none; }
  .writer-content td, .writer-content th { position: relative; }
  .writer-content .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: 0; width: 4px; background: #2563eb; pointer-events: none; }
  .writer-content.resize-cursor, .tableWrapper.resize-cursor { cursor: col-resize; }
  .writer-content .tableWrapper { overflow-x: auto; }
`;

// ---------- Small parts ----------

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex shrink-0 flex-col justify-between border-r border-slate-200 px-2.5 last:border-r-0">
      <div className="flex flex-1 items-center gap-1">{children}</div>
      <p className="mt-0.5 text-center text-[11px] text-slate-500">{label}</p>
    </section>
  );
}

function Tb({ title, onClick, active, disabled, children }: { title: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded px-1 text-slate-700 disabled:opacity-35 ${active ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-300' : 'hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

function Big({ icon, glyph, label, onClick, active, title }: { icon?: string; glyph?: string; label: string; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-[62px] min-w-[54px] flex-col items-center justify-center gap-1 rounded-md px-1.5 text-xs text-slate-700 ${active ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-300' : 'hover:bg-slate-100'}`}
    >
      {icon ? <Svg name={icon} className="h-6 w-6" /> : <span className="flex h-6 items-center text-lg font-semibold leading-none">{glyph}</span>}
      <span className="whitespace-nowrap leading-tight">{label}</span>
    </button>
  );
}

function StyleTile({ label, big, active, onClick }: { label: string; big?: 1 | 2 | 3; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-12 w-[78px] rounded-md border bg-white px-1.5 text-left text-black ${active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-300 hover:border-blue-400'}`}
    >
      <span className={big ? 'font-semibold text-blue-800' : ''} style={{ fontSize: big ? [0, 14, 13, 12][big] : 12 }}>
        {label}
      </span>
    </button>
  );
}

// A button with a drop-down panel that closes when clicking elsewhere.
function Menu({ trigger, children }: { trigger: (toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(() => setOpen((v) => !v))}
      {open && (
        <div className="fixed z-50 rounded-lg border border-slate-200 bg-surface shadow-xl" style={dropPosition(ref.current)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, active }: { children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-blue-50 ${active ? 'font-semibold text-blue-700' : 'text-slate-700'}`}>
      {active ? '✓ ' : ''}
      {children}
    </button>
  );
}

function FileMenu({ items, onClose }: { items: { icon: string; label: string; hint?: string; onClick: () => void }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown));
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="absolute left-3 top-full z-50 w-80 rounded-b-lg border border-slate-200 bg-surface py-1 shadow-2xl">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => {
            onClose();
            item.onClick();
          }}
          className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-slate-700 hover:bg-blue-50"
        >
          <Svg name={item.icon} />
          <span className="flex-1">{item.label}</span>
          {item.hint && <span className="text-xs text-slate-400">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function SizeBox({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (n >= 1 && n <= 400) onChange(Math.round(n * 2) / 2);
    else setText(String(value));
  };
  return (
    <div className="relative">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
        list="writer-sizes"
        aria-label="Font size"
        className="h-7 w-16 rounded border border-slate-300 bg-surface px-1.5 text-sm"
      />
      <datalist id="writer-sizes">
        {SIZES.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

function NumberBox({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n)) onChange(n);
  };
  return (
    <label className="flex items-center justify-between gap-2">
      {label}
      <input
        type="number"
        step="0.1"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="h-6 w-16 rounded border border-slate-300 bg-surface px-1 text-sm text-slate-800"
      />
    </label>
  );
}

function ColorButton({ title, color, glyph, noneLabel, onApply }: { title: string; color: string; glyph: ReactNode; noneLabel: string; onApply: (color: string | null) => void }) {
  return (
    <div className="flex items-center">
      <Tb title={title} onClick={() => onApply(color)}>
        {glyph}
      </Tb>
      <Menu
        trigger={(toggle) => (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={toggle} className="h-7 rounded px-0.5 text-slate-500 hover:bg-slate-100" aria-label={`${title} colours`}>
            ▾
          </button>
        )}
      >
        {(close) => (
          <div className="w-60 p-2">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (onApply(null), close())} className="mb-2 w-full rounded border border-slate-200 px-2 py-1 text-left text-sm hover:bg-slate-50">
              {noneLabel}
            </button>
            {[THEME_COLORS, STANDARD_COLORS].map((row, i) => (
              <div key={i} className="mb-1.5 grid grid-cols-10 gap-1">
                {row.map((c) => (
                  <button key={c} type="button" title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => (onApply(c), close())} className="h-5 w-5 rounded-sm border border-slate-300" style={{ background: c }} />
                ))}
              </div>
            ))}
            <label className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              More colours
              <input type="color" defaultValue={color} onChange={(e) => onApply(e.target.value)} onBlur={close} className="h-6 w-10" />
            </label>
          </div>
        )}
      </Menu>
    </div>
  );
}

function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  return (
    <Menu trigger={(toggle) => <Big icon="table" label="Table" onClick={toggle} />}>
      {(close) => (
        <div className="p-2" onMouseLeave={() => setHover([0, 0])}>
          <p className="mb-1.5 text-xs text-slate-600">{hover[0] ? `${hover[0]} × ${hover[1]} table` : 'Insert a table'}</p>
          <div className="grid grid-cols-10 gap-0.5">
            {Array.from({ length: 80 }, (_, i) => {
              const r = Math.floor(i / 10) + 1;
              const c = (i % 10) + 1;
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`${r} rows, ${c} columns`}
                  onMouseEnter={() => setHover([r, c])}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (onPick(r, c), close())}
                  className={`h-4 w-4 border ${r <= hover[0] && c <= hover[1] ? 'border-blue-500 bg-blue-100' : 'border-slate-300 bg-white'}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </Menu>
  );
}

function FindPanel({ editor, mode, onMode, onClose }: { editor: Editor; mode: 'find' | 'replace'; onMode: (m: 'find' | 'replace') => void; onClose: () => void }) {
  const [query, setQuery] = useState(() => {
    const { from, to, empty } = editor.state.selection;
    return empty ? '' : editor.state.doc.textBetween(from, to, ' ').slice(0, 100);
  });
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [index, setIndex] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const matches = findAll(editor.state.doc, query, matchCase);

  function go(dir: 1 | -1) {
    if (matches.length === 0) return;
    const pos = editor.state.selection.from;
    let i = dir > 0 ? matches.findIndex((m) => m.from > pos - (index >= 0 ? 0 : 1)) : [...matches].reverse().findIndex((m) => m.from < pos);
    if (dir < 0 && i >= 0) i = matches.length - 1 - i;
    if (i < 0) i = dir > 0 ? 0 : matches.length - 1;
    setIndex(i);
    editor.chain().setTextSelection(matches[i]).scrollIntoView().run();
  }

  function replaceOne() {
    const { from, to } = editor.state.selection;
    const current = matches.find((m) => m.from === from && m.to === to);
    if (!current) {
      go(1);
      return;
    }
    editor.chain().insertContentAt(current, replacement).run();
    setTimeout(() => go(1));
  }

  function replaceAll() {
    if (matches.length === 0) return;
    const tr = editor.state.tr;
    for (const m of [...matches].reverse()) {
      if (replacement) tr.insertText(replacement, m.from, m.to);
      else tr.delete(m.from, m.to);
    }
    editor.view.dispatch(tr);
    setIndex(-1);
  }

  return (
    <div className="fixed right-6 top-44 z-40 w-80 rounded-xl border border-slate-200 bg-surface p-3 shadow-2xl">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={() => onMode('find')} className={`text-sm ${mode === 'find' ? 'font-semibold text-blue-700' : 'text-slate-500'}`}>
          Find
        </button>
        <button type="button" onClick={() => onMode('replace')} className={`text-sm ${mode === 'replace' ? 'font-semibold text-blue-700' : 'text-slate-500'}`}>
          Replace
        </button>
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
          <Svg name="close" className="h-4 w-4" />
        </button>
      </div>
      <input
        ref={input}
        value={query}
        onChange={(e) => (setQuery(e.target.value), setIndex(-1))}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), go(e.shiftKey ? -1 : 1))}
        placeholder="Find what"
        className="mb-2 w-full rounded border border-slate-300 bg-surface px-2 py-1 text-sm"
      />
      {mode === 'replace' && (
        <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Replace with" className="mb-2 w-full rounded border border-slate-300 bg-surface px-2 py-1 text-sm" />
      )}
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
        <Checkbox label="Match case" checked={matchCase} onChange={setMatchCase} />
        <span>{query ? (matches.length === 0 ? 'Not found' : `${index >= 0 ? `${index + 1} of ` : ''}${matches.length} found`) : ''}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => go(-1)} disabled={matches.length === 0}>
          Previous
        </Button>
        <Button size="sm" onClick={() => go(1)} disabled={matches.length === 0}>
          Next
        </Button>
        {mode === 'replace' && (
          <>
            <Button size="sm" onClick={replaceOne} disabled={matches.length === 0}>
              Replace
            </Button>
            <Button size="sm" variant="primary" onClick={replaceAll} disabled={matches.length === 0}>
              Replace all
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function SaveDialog({ initialName, busy, onCancel, onSave }: { initialName: string; busy: boolean; onCancel: () => void; onSave: (name: string, folder: string, format: 'docx' | 'pdf') => void }) {
  const [name, setName] = useState(initialName);
  const [folder, setFolder] = useState('/Letters');
  const [format, setFormat] = useState<'docx' | 'pdf'>('docx');
  return (
    <Modal
      title="Save to Documents"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => onSave(name.trim(), folder, format)}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Name" value={name} onChange={setName} maxLength={200} required />
        <TextField label="Folder" value={folder} onChange={setFolder} hint="For example /Letters or /2026/October" />
        <fieldset className="space-y-1.5 text-sm">
          <legend className="mb-1 font-medium text-slate-700">Save as</legend>
          <label className="flex items-center gap-2">
            <input type="radio" checked={format === 'docx'} onChange={() => setFormat('docx')} /> Word (.docx) — can be opened and edited again here, in Word or in WPS
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={format === 'pdf'} onChange={() => setFormat('pdf')} /> PDF — for printing and sending; looks exactly like this page
          </label>
        </fieldset>
        <p className="text-sm text-slate-500">Tamil is saved as Unicode, so it copies correctly.</p>
      </div>
    </Modal>
  );
}

function MarginsDialog({ page, onCancel, onApply }: { page: PageSetup; onCancel: () => void; onApply: (m: PageSetup['margins']) => void }) {
  const cm = (pt: number) => String(Math.round((pt / 28.35) * 100) / 100);
  const [values, setValues] = useState({ top: cm(page.margins.top), bottom: cm(page.margins.bottom), left: cm(page.margins.left), right: cm(page.margins.right) });
  const parsed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])) as Record<keyof typeof values, number>;
  const valid = Object.values(parsed).every((n) => Number.isFinite(n) && n >= 0 && n <= 10);
  return (
    <Modal
      title="Custom margins"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onApply({ top: parsed.top * 28.35, bottom: parsed.bottom * 28.35, left: parsed.left * 28.35, right: parsed.right * 28.35 })}>
            Apply
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        {(['top', 'bottom', 'left', 'right'] as const).map((k) => (
          <TextField key={k} label={`${k[0].toUpperCase()}${k.slice(1)} (cm)`} type="number" step="0.1" min="0" max="10" value={values[k]} onChange={(v) => setValues({ ...values, [k]: v })} />
        ))}
      </div>
    </Modal>
  );
}


const LETTER_ROWS: [string, string[]][] = [
  ['Vowels', ['அ', 'ஆ', 'இ', 'ஈ', 'உ', 'ஊ', 'எ', 'ஏ', 'ஐ', 'ஒ', 'ஓ', 'ஔ', 'ஃ']],
  ['Consonants', ['க', 'ங', 'ச', 'ஞ', 'ட', 'ண', 'த', 'ந', 'ப', 'ம', 'ய', 'ர', 'ல', 'வ', 'ழ', 'ள', 'ற', 'ன', 'ஜ', 'ஷ', 'ஸ', 'ஹ', 'க்ஷ', 'ஸ்ரீ']],
  ['Signs', ['ா', 'ி', 'ீ', 'ு', 'ூ', 'ெ', 'ே', 'ை', 'ொ', 'ோ', 'ௌ', '்']],
];

const KEY_HINTS: Record<Exclude<TamilMode, 'off'>, string> = {
  phonetic: 'Type Tamil in English letters: ammaa → அம்மா, vaNakkam → வணக்கம், thamizh → தமிழ். a/aa i/ee u/oo e/E o/O ai au · k g ch s nj t d N th n w p m y r R l L zh v j sh S h · n at the start = ந, w = ந, n inside a word = ன, N = ண, L = ள, zh = ழ, R = ற, q = ஃ',
  bamini: 'Bamini typewriter keys: mk;kh → அம்மா, mDg;Geh; → அனுப்புநர். Type ெ ே ை (n N i) before the letter, as on paper.',
  tamil99: 'Tamil99: h=க j=ப k=ம l=த ;=ந \'=ய m=ர n=ல v=வ /=ழ y=ள u=ற i=ன o=ட p=ண [=ச ]=ஞ b=ங · a=அ q=ஆ s=இ w=ஈ d=உ e=ஊ g=எ t=ஏ r=ஐ c=ஒ x=ஓ z=ஔ · f = புள்ளி (்)',
};

// Tamil letters to click, and a reminder of the keys for the chosen keyboard.
function TamilLetters({ mode, onInsert, onClose }: { mode: TamilMode; onInsert: (text: string) => void; onClose: () => void }) {
  return (
    <div className="border-t border-slate-200 bg-surface px-3 py-2">
      <div className="mb-1 flex items-start gap-2">
        <p className="flex-1 text-xs text-slate-600">{mode === 'off' ? 'Click a letter to add it. To type Tamil with the keyboard, choose a Tamil keyboard in the Tamil group (or press Alt+T).' : KEY_HINTS[mode]}</p>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close Tamil letters">
          <Svg name="close" className="h-4 w-4" />
        </button>
      </div>
      {LETTER_ROWS.map(([label, letters]) => (
        <div key={label} className="mb-1 flex flex-wrap items-center gap-1">
          <span className="w-20 text-[11px] text-slate-500">{label}</span>
          {letters.map((l) => (
            <button
              key={l}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onInsert(l)}
              className="h-8 min-w-8 rounded border border-slate-200 bg-white px-1.5 text-base text-black hover:border-emerald-400 hover:bg-emerald-50"
              style={{ fontFamily: TAMIL_FONT }}
            >
              {label === 'Signs' ? `◌${l}` : l}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
