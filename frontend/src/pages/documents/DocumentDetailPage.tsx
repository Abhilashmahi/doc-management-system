import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../app/session';
import { Badge, Button, Card, ConfirmDialog, ErrorBanner, Icon, LoadingBlock, Modal, StatusBadge, useLoad, useToast } from '../../components/kit';
import { Link } from '../../components/Link';
import { exportDesign, type ExportFormat } from '../../designer/export';
import { DocumentPreview } from '../../designer/PageView';
import type { CanvasDocument } from '../../designer/types';
import { errorMessage, http } from '../../lib/api';
import { formatBytes, formatDateTime, timeAgo } from '../../lib/format';
import { navigate } from '../../lib/router';
import type { DocumentDetail, DocumentSummary } from '../../lib/types';
import { ConvertDialog } from './ConvertDialog';
import { ShareDialog } from './ShareDialog';
import { RenameMoveDialog, fileKind } from './shared';

type Pending = 'archive' | 'restore' | 'delete' | null;

export function DocumentDetailPage({ id }: { id: number }) {
  const session = useSession();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => http.get<DocumentDetail>(`/documents/${id}`), [id]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [uploadingVersion, setUploadingVersion] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (loading && !data) return <LoadingBlock />;
  if (error || !data) return <ErrorBanner message={error ?? 'Document not found.'} onRetry={reload} />;

  const doc = data.document;
  const canChange = session.canEdit && Boolean(session.accountId) && !doc.isArchived;

  async function doExport(format: ExportFormat) {
    if (!data?.content) return;
    setExporting(format);
    try {
      await exportDesign(data.content.canvas, data.content.data, format, doc.name);
      await http.post(`/documents/${doc.id}/exported`, { format });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setExporting(null);
    }
  }

  async function uploadNewVersion(file: File) {
    setUploadingVersion(true);
    const form = new FormData();
    form.append('file', file);
    form.append('baseVersionNo', String(doc.currentVersionNo));
    try {
      const result = await http.upload<{ versionNo: number }>(`/documents/${doc.id}/file`, form);
      toast(`Version ${result.versionNo} uploaded. Earlier versions are kept.`);
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploadingVersion(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function duplicate() {
    try {
      const result = await http.post<{ id: number }>(`/documents/${doc.id}/duplicate`);
      toast('Copy created.');
      navigate(`/documents/${result.id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <>
      <div className="mb-2 text-sm">
        <Link to="/documents" className="text-slate-500 hover:text-slate-800">← Documents</Link>
      </div>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">{doc.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Badge tone={doc.sourceType === 'upload' ? 'blue' : 'indigo'}>{fileKind(doc)}</Badge>
            {doc.isArchived ? <StatusBadge status="Archived" /> : <StatusBadge status={doc.status} />}
            <span>Version {doc.currentVersionNo}</span>
            <span>·</span>
            <span>Updated {timeAgo(doc.updatedAt)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {doc.sourceType === 'template' && canChange && (
            <>
              <Link to={`/documents/${doc.id}/edit`} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
                <Icon name="edit" /> Edit values
              </Link>
              <Link to={`/documents/${doc.id}/design`} className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
                <Icon name="design" /> Edit layout
              </Link>
            </>
          )}
          {doc.sourceType === 'template' && data.content && (
            <ExportMenu busy={exporting} onExport={doExport} defaultFormat={session.settings?.defaultExportFormat ?? 'pdf'} />
          )}
          {doc.sourceType === 'upload' && (
            <a href={`/api/documents/${doc.id}/file`} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
              <Icon name="download" /> Download
            </a>
          )}
          {(doc.sourceType === 'upload' ? Boolean(doc.fileName) : Boolean(data.content)) && (
            <Button onClick={() => setShareOpen(true)}>
              <Icon name="share" /> Share
            </Button>
          )}
          {doc.sourceType === 'upload' && /.pdf$/i.test(doc.fileName ?? '') && canChange && (
            <Link to={`/documents/${doc.id}/edit-text`} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
              <Icon name="edit" /> Edit text
            </Link>
          )}
          {doc.sourceType === 'upload' && /\.(docx|pdf|txt|html?|md)$/i.test(doc.fileName ?? '') && (
            <Link to={`/writer?doc=${doc.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              <Icon name="writer" /> Edit in Writer
            </Link>
          )}
          {doc.sourceType === 'upload' && /^image\/(png|jpeg|gif|bmp|webp)$/.test(doc.mimeType ?? '') && (
            <Link to={`/paint?doc=${doc.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              <Icon name="paint" /> Edit in Paint
            </Link>
          )}
          {doc.sourceType === 'upload' && canChange && (
            <>
              <Button onClick={() => setConvertOpen(true)}>
                <Icon name="convert" /> Convert
              </Button>
              <input ref={fileInput} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadNewVersion(e.target.files[0])} />
              <Button busy={uploadingVersion} onClick={() => fileInput.current?.click()}>
                <Icon name="upload" /> New version
              </Button>
            </>
          )}
          {canChange && (
            <>
              <Button onClick={() => setRenameOpen(true)}>Rename / move</Button>
              <Button onClick={duplicate}>
                <Icon name="copy" /> Duplicate
              </Button>
              <Button onClick={() => setPending('archive')}>
                <Icon name="archive" /> Archive
              </Button>
              <Button variant="danger" onClick={() => setPending('delete')}>
                <Icon name="trash" /> Delete
              </Button>
            </>
          )}
          {doc.isArchived && session.canManage && session.accountId && (
            <Button onClick={() => setPending('restore')}>
              <Icon name="restore" /> Restore
            </Button>
          )}
          {doc.isArchived && session.canEdit && session.accountId && (
            <Button variant="danger" onClick={() => setPending('delete')}>
              <Icon name="trash" /> Delete
            </Button>
          )}
        </div>
      </div>

      {doc.isArchived && (
        <div className="mb-4 rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-600">
          This document is archived, so it cannot be edited. {session.canManage ? 'Restore it to make changes.' : 'Ask an administrator to restore it.'}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Preview">
          {doc.sourceType === 'template' && data.content ? (
            <div className="rounded-lg bg-slate-100 p-4">
              <DocumentPreview canvas={data.content.canvas} values={data.content.data} maxWidth={760} />
            </div>
          ) : (
            <FilePreview doc={doc} onConvert={canChange ? () => setConvertOpen(true) : undefined} />
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Details">
            <dl className="space-y-2.5 text-sm">
              <Detail label="Category">{doc.categoryName ?? 'None'}</Detail>
              <Detail label="Folder">{doc.folderPath}</Detail>
              {doc.templateName && (
                <Detail label="Template">
                  {doc.templateName} <span className="text-slate-400">(version {doc.templateVersionNo})</span>
                </Detail>
              )}
              {doc.fileName && <Detail label="File">{doc.fileName} · {formatBytes(doc.sizeBytes)}</Detail>}
              <Detail label="Created">{formatDateTime(doc.createdAt)} by {doc.createdByName}</Detail>
              <Detail label="Last updated">{formatDateTime(doc.updatedAt)}{doc.updatedByName ? ` by ${doc.updatedByName}` : ''}</Detail>
            </dl>
          </Card>

          {data.content && Object.keys(data.content.data).length > 0 && (
            <Card title="Field values">
              <dl className="space-y-2.5 text-sm">
                {data.content.fields.map((f) => {
                  const def = data.content!.definitions.find((d) => d.fieldKey === f.fieldKey);
                  return (
                    <Detail key={f.fieldKey} label={def?.label ?? f.fieldKey}>
                      {data.content!.data[f.fieldKey] || <span className="text-slate-400">empty</span>}
                    </Detail>
                  );
                })}
              </dl>
            </Card>
          )}

          <Card title="Version history" padded={false}>
            <ol className="divide-y divide-slate-100">
              {data.versions.map((v) => (
                <li key={v.versionNo} className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">
                      Version {v.versionNo}
                      {v.versionNo === doc.currentVersionNo && <span className="ml-2"><Badge tone="green">Current</Badge></span>}
                    </p>
                    <p className="truncate text-xs text-slate-500">{v.note ?? '—'}</p>
                    <p className="text-xs text-slate-400">{formatDateTime(v.createdAt)} · {v.createdByName}</p>
                  </div>
                  {v.fileId ? (
                    <a href={`/api/documents/${doc.id}/file?version=${v.versionNo}`} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline">
                      Download
                    </a>
                  ) : doc.sourceType === 'template' ? (
                    <button type="button" onClick={() => setViewVersion(v.versionNo)} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline">
                      View
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {renameOpen && <RenameMoveDialog doc={doc} onClose={() => setRenameOpen(false)} onSaved={reload} />}
      {convertOpen && <ConvertDialog doc={doc} onClose={() => setConvertOpen(false)} />}
      {shareOpen && <ShareDialog detail={data} onClose={() => setShareOpen(false)} />}
      {viewVersion !== null && <VersionDialog documentId={doc.id} versionNo={viewVersion} onClose={() => setViewVersion(null)} />}

      {pending && (
        <ConfirmDialog
          title={{ archive: 'Archive document?', restore: 'Restore document?', delete: 'Delete document?' }[pending]}
          message={
            {
              archive: 'The document moves to the Archived tab and cannot be edited. An administrator can restore it.',
              restore: 'The document moves back to the active documents and can be edited again.',
              delete: 'The document moves to the Trash (Documents → Trash). You can restore it from there for 30 days; after that it is deleted forever.',
            }[pending]
          }
          confirmLabel={{ archive: 'Archive', restore: 'Restore', delete: 'Move to trash' }[pending]}
          danger={pending === 'delete'}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            if (pending === 'delete') {
              await http.del(`/documents/${doc.id}`);
              toast('Moved to the trash. Restore it from Documents → Trash.');
              navigate('/documents');
              return;
            }
            await http.post(`/documents/${doc.id}/${pending}`);
            toast(pending === 'archive' ? 'Document archived.' : 'Document restored.');
            reload();
          }}
        />
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-slate-800">{children}</dd>
    </div>
  );
}

function ExportMenu({ busy, onExport, defaultFormat }: { busy: ExportFormat | null; onExport: (f: ExportFormat) => void; defaultFormat: ExportFormat }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const formats: { value: ExportFormat; label: string }[] = [
    { value: 'pdf', label: 'PDF document' },
    { value: 'png', label: 'PNG image' },
    { value: 'jpeg', label: 'JPEG image' },
  ];
  return (
    <div className="relative inline-flex" ref={ref}>
      <Button variant="secondary" busy={busy !== null} onClick={() => onExport(defaultFormat)} className="rounded-r-none">
        <Icon name="download" /> Export {defaultFormat.toUpperCase()}
      </Button>
      <Button variant="secondary" className="rounded-l-none border-l-0 px-2" aria-label="More export formats" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevronDown" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg bg-surface py-1 shadow-lg ring-1 ring-slate-200">
          {formats.map((f) => (
            <button
              key={f.value}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setOpen(false);
                onExport(f.value);
              }}
            >
              {f.label}
            </button>
          ))}
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">PDF pages are high-resolution images; the text is not selectable.</p>
        </div>
      )}
    </div>
  );
}

// The same preview rules as the server (backend/src/services/formats.ts): the server refuses anything else inline.
const IMAGE_PREVIEW = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const TEXT_PREVIEW = ['txt', 'csv', 'md', 'json', 'xml'];

// Shows uploaded files in the browser where that is safe and possible.
function FilePreview({ doc, onConvert }: { doc: DocumentSummary; onConvert?: () => void }) {
  const src = `/api/documents/${doc.id}/file?inline=1&v=${doc.currentVersionNo}`;
  const ext = doc.fileName?.includes('.') ? doc.fileName.split('.').pop()!.toLowerCase() : '';

  if (IMAGE_PREVIEW.includes(ext)) {
    return (
      <div className="flex justify-center rounded-lg bg-slate-100 p-4">
        <img src={src} alt={doc.name} className="max-h-[75vh] max-w-full rounded shadow" />
      </div>
    );
  }
  if (ext === 'pdf') {
    return <iframe src={src} title={doc.name} className="h-[75vh] w-full rounded-lg ring-1 ring-slate-200" />;
  }
  if (TEXT_PREVIEW.includes(ext)) {
    return <TextPreview src={src} csv={ext === 'csv'} />;
  }
  const reason = ['html', 'htm', 'svg'].includes(ext)
    ? 'Web pages and SVG drawings can contain scripts, so they are only downloaded, never opened inside the app.'
    : ['docx', 'doc', 'odt', 'rtf', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp'].includes(ext)
      ? 'Office files cannot be shown in the browser as they are. Convert a copy to PDF to view it here, or download the file to open it in Office.'
      : 'Download the file to open it with a program on your computer.';
  return (
    <div className="rounded-lg bg-slate-50 px-6 py-12 text-center text-sm text-slate-600">
      <p className="font-medium text-slate-800">No preview for {fileKind(doc)} files</p>
      <p className="mx-auto mt-1 max-w-md">{reason} The stored original is never changed.</p>
      {onConvert && (
        <Button className="mt-4" onClick={onConvert}>
          Convert a copy...
        </Button>
      )}
      <a href={`/api/documents/${doc.id}/file`} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">
        <Icon name="download" /> Download {fileKind(doc)}
      </a>
    </div>
  );
}

// Splits one CSV line, honouring quoted values that contain commas.
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(current);
      current = '';
    } else current += ch;
  }
  cells.push(current);
  return cells;
}

function TextPreview({ src, csv }: { src: string; csv: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(src, { credentials: 'include' })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => setText(t.slice(0, 200_000)))
      .catch(() => setFailed(true));
  }, [src]);

  if (failed) return <ErrorBanner message="The file could not be loaded." />;
  if (text === null) return <LoadingBlock />;
  if (!csv) return <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-800">{text}</pre>;

  const rows = text.split(/\r?\n/).filter((l) => l.length > 0).slice(0, 500).map(parseCsvLine);
  const [head, ...body] = rows;
  return (
    <div className="max-h-[75vh] overflow-auto rounded-lg ring-1 ring-slate-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-600">
          <tr>{head?.map((c, i) => <th key={i} className="px-3 py-2 font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {body.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="px-3 py-1.5 text-slate-700">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {rows.length >= 500 && <p className="px-3 py-2 text-xs text-slate-500">Showing the first 500 rows. Download the file to see everything.</p>}
    </div>
  );
}

function VersionDialog({ documentId, versionNo, onClose }: { documentId: number; versionNo: number; onClose: () => void }) {
  const { data, error, loading } = useLoad(
    () => http.get<{ data: Record<string, string> | null; canvas: CanvasDocument | null }>(`/documents/${documentId}/versions/${versionNo}`),
    [documentId, versionNo],
  );
  return (
    <Modal title={`Version ${versionNo}`} onClose={onClose} wide>
      {loading && <LoadingBlock />}
      {error && <ErrorBanner message={error} />}
      {data?.canvas ? (
        <div className="rounded-lg bg-slate-100 p-4">
          <DocumentPreview canvas={data.canvas} values={data.data ?? {}} maxWidth={680} />
        </div>
      ) : (
        data && <p className="text-sm text-slate-500">This version has no saved design.</p>
      )}
    </Modal>
  );
}
