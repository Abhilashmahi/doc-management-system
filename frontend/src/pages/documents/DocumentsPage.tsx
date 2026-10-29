import { useEffect, useState } from 'react';
import { useSession } from '../../app/session';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  FilterInput,
  FilterSelect,
  Icon,
  LoadingBlock,
  PageHeader,
  Pagination,
  StatusBadge,
  useLoad,
  useToast,
} from '../../components/kit';
import { Link } from '../../components/Link';
import { exportDesign } from '../../designer/export';
import { errorMessage, http } from '../../lib/api';
import { formatBytes, timeAgo } from '../../lib/format';
import { navigate, useSearchParams } from '../../lib/router';
import type { DocumentDetail, DocumentSummary } from '../../lib/types';
import { UploadDialog, fileKind, useCategories, useFolders } from './shared';

interface ListResult {
  total: number;
  page: number;
  pageSize: number;
  documents: DocumentSummary[];
}

type View = 'active' | 'archived' | 'trash';
type SingleAction = 'archive' | 'unarchive' | 'delete' | 'undelete' | 'purge';
type Pending = { kind: SingleAction; docs: DocumentSummary[] } | { kind: 'empty' } | null;

// How each action is described in its confirmation dialog.
const ACTION_TEXT: Record<SingleAction, { title: string; button: string; danger?: boolean; done: string }> = {
  archive: { title: 'Archive', button: 'Archive', done: 'archived' },
  unarchive: { title: 'Restore', button: 'Restore', done: 'restored' },
  delete: { title: 'Delete', button: 'Move to trash', danger: true, done: 'moved to the trash' },
  undelete: { title: 'Restore', button: 'Restore', done: 'restored from the trash' },
  purge: { title: 'Delete forever', button: 'Delete forever', danger: true, done: 'deleted forever' },
};

export function DocumentsPage() {
  const session = useSession();
  const toast = useToast();
  const params = useSearchParams();
  const categories = useCategories();
  const folders = useFolders();

  const [q, setQ] = useState(params.get('q') ?? '');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [folder, setFolder] = useState('');
  const [view, setView] = useState<View>(params.get('view') === 'trash' ? 'trash' : 'active');
  const [sort, setSort] = useState('updated');
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(params.get('upload') === '1');
  const [pending, setPending] = useState<Pending>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);

  // The top-bar search changes ?q= while this page is open.
  const urlQuery = params.get('q') ?? '';
  useEffect(() => {
    setQ(urlQuery);
    setSearch(urlQuery);
    setPage(1);
  }, [urlQuery]);

  // Wait a moment after typing before searching, so every key press does not hit the server.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const { data, error, loading, reload } = useLoad(
    () => http.get<ListResult>('/documents', { q: search, categoryId, status, sourceType, folder, view, sort, page, pageSize: 20 }),
    [search, categoryId, status, sourceType, folder, view, sort, page],
  );

  // A new page of results or a new tab starts with nothing selected.
  useEffect(() => setSelected([]), [data]);

  const canChange = session.canEdit && Boolean(session.accountId);
  const canPurge = session.canManage && Boolean(session.accountId);
  const filtersOn = Boolean(search || categoryId || status || sourceType || folder);
  const rows = data?.documents ?? [];
  const allSelected = rows.length > 0 && rows.every((d) => selected.includes(d.id));
  const selectedDocs = rows.filter((d) => selected.includes(d.id));

  function switchView(next: View) {
    setView(next);
    setPage(1);
  }

  async function download(doc: DocumentSummary) {
    setBusyId(doc.id);
    try {
      if (doc.sourceType === 'upload') {
        window.location.assign(`/api/documents/${doc.id}/file`);
      } else {
        const detail = await http.get<DocumentDetail>(`/documents/${doc.id}`);
        if (!detail.content) throw new Error('This document has no design to export.');
        const format = session.settings?.defaultExportFormat ?? 'pdf';
        await exportDesign(detail.content.canvas, detail.content.data, format, doc.name);
        await http.post(`/documents/${doc.id}/exported`, { format });
      }
    } catch (e) {
      toast(e instanceof Error && !('status' in e) ? e.message : errorMessage(e), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function duplicate(doc: DocumentSummary) {
    setBusyId(doc.id);
    try {
      const result = await http.post<{ id: number }>(`/documents/${doc.id}/duplicate`);
      toast('Copy created.');
      navigate(`/documents/${result.id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusyId(null);
    }
  }

  // Runs an action on one or more documents and reports how it went.
  async function perform(kind: SingleAction, docs: DocumentSummary[]) {
    const label = docs.length === 1 ? `“${docs[0].name}”` : `${docs.length} documents`;
    if (docs.length === 1) {
      const id = docs[0].id;
      if (kind === 'delete') await http.del(`/documents/${id}`);
      else if (kind === 'purge') await http.del(`/documents/${id}/permanent`);
      else if (kind === 'undelete') await http.post(`/documents/${id}/undelete`);
      else await http.post(`/documents/${id}/${kind === 'unarchive' ? 'restore' : 'archive'}`);
    } else {
      const bulk = kind === 'unarchive' ? null : kind;
      if (!bulk) {
        for (const d of docs) await http.post(`/documents/${d.id}/restore`);
      } else {
        const result = await http.post<{ done: number; failed: number }>('/documents/bulk', { action: bulk, ids: docs.map((d) => d.id) });
        if (result.failed > 0) toast(`${result.failed} of ${docs.length} could not be changed.`, 'error');
      }
    }
    toast(`${label} ${ACTION_TEXT[kind].done}.`);
    setSelected([]);
    reload();
  }

  const tabs: { label: string; value: View; icon?: string }[] = [
    { label: 'Active', value: 'active' },
    { label: 'Archived', value: 'archived' },
    { label: 'Trash', value: 'trash', icon: 'trash' },
  ];

  return (
    <>
      <PageHeader
        title="Documents"
        description="Every document in this office: designed from templates or uploaded as files."
        actions={
          canChange ? (
            <>
              <Button onClick={() => setUploadOpen(true)}>
                <Icon name="upload" /> Upload
              </Button>
              <Link to="/documents/new" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
                <Icon name="plus" /> New from template
              </Link>
            </>
          ) : undefined
        }
      />

      <div className="mb-3 flex items-end justify-between gap-2 border-b border-slate-200">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => switchView(tab.value)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${view === tab.value ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {tab.icon && <Icon name={tab.icon} />}
              {tab.label}
            </button>
          ))}
        </div>
        {view === 'trash' && canPurge && rows.length > 0 && (
          <button type="button" onClick={() => setPending({ kind: 'empty' })} className="mb-1.5 text-sm font-medium text-red-600 hover:underline">
            Empty trash
          </button>
        )}
      </div>

      {view === 'trash' && (
        <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          Deleted documents stay here for 30 days, then they are deleted forever. Restore a document to bring it back.
          {!session.canManage && ' Only administrators can delete forever.'}
        </p>
      )}

      <div className="mb-4 flex flex-col flex-wrap gap-2 sm:flex-row">
        <FilterInput label="Search by name or file name" value={q} onChange={setQ} type="search" />
        <FilterSelect label="All categories" value={categoryId} onChange={(v) => { setCategoryId(v); setPage(1); }} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect label="All folders" value={folder} onChange={(v) => { setFolder(v); setPage(1); }} options={folders.filter((f) => f !== '/').map((f) => ({ value: f, label: f }))} />
        <FilterSelect label="Any type" value={sourceType} onChange={(v) => { setSourceType(v); setPage(1); }} options={[{ value: 'template', label: 'From template' }, { value: 'upload', label: 'Uploaded file' }]} />
        <FilterSelect label="Any status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: 'Draft', label: 'Draft' }, { value: 'Final', label: 'Final' }]} />
        {view !== 'trash' && (
          <FilterSelect label="Sort: last updated" value={sort === 'updated' ? '' : sort} onChange={(v) => setSort(v || 'updated')} options={[{ value: 'created', label: 'Sort: newest' }, { value: 'name', label: 'Sort: name' }, { value: 'opened', label: 'Sort: recently opened' }]} />
        )}
      </div>

      {/* Actions for the selected documents */}
      {selected.length > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-lg">
          <span className="mr-2 font-medium">{selected.length} selected</span>
          {view === 'active' && canChange && (
            <>
              <BarButton onClick={() => setPending({ kind: 'archive', docs: selectedDocs })}>Archive</BarButton>
              <BarButton danger onClick={() => setPending({ kind: 'delete', docs: selectedDocs })}>Delete</BarButton>
            </>
          )}
          {view === 'archived' && canChange && (
            <>
              {session.canManage && <BarButton onClick={() => setPending({ kind: 'unarchive', docs: selectedDocs })}>Restore</BarButton>}
              <BarButton danger onClick={() => setPending({ kind: 'delete', docs: selectedDocs })}>Delete</BarButton>
            </>
          )}
          {view === 'trash' && canChange && (
            <>
              <BarButton onClick={() => setPending({ kind: 'undelete', docs: selectedDocs })}>Restore</BarButton>
              {canPurge && <BarButton danger onClick={() => setPending({ kind: 'purge', docs: selectedDocs })}>Delete forever</BarButton>}
            </>
          )}
          <button type="button" onClick={() => setSelected([])} className="ml-auto text-white/70 hover:text-white">Clear selection</button>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <LoadingBlock />}

      {data && rows.length === 0 && (
        <EmptyState
          title={filtersOn ? 'No documents match these filters' : view === 'trash' ? 'The trash is empty' : view === 'archived' ? 'No archived documents' : 'No documents yet'}
          text={filtersOn ? 'Try a different search or clear the filters.' : view === 'trash' ? 'Deleted documents appear here for 30 days.' : view === 'archived' ? 'Archived documents appear here.' : 'Create a document from a template, or upload an existing file.'}
          action={!filtersOn && view === 'active' && canChange ? <Button variant="primary" onClick={() => setUploadOpen(true)}>Upload a document</Button> : undefined}
        />
      )}

      {data && rows.length > 0 && (
        <div className={`overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-slate-200 ${loading ? 'opacity-60' : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {canChange && (
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={allSelected}
                        onChange={(e) => setSelected(e.target.checked ? rows.map((d) => d.id) : [])}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                    </th>
                  )}
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Folder</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">{view === 'trash' ? 'Deleted' : 'Status'}</th>
                  <th className="px-4 py-2.5 font-medium">{view === 'trash' ? 'Deleted by' : 'Updated'}</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((doc) => (
                  <tr key={doc.id} className={selected.includes(doc.id) ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}>
                    {canChange && (
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${doc.name}`}
                          checked={selected.includes(doc.id)}
                          onChange={(e) => setSelected((s) => (e.target.checked ? [...s, doc.id] : s.filter((id) => id !== doc.id)))}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                        />
                      </td>
                    )}
                    <td className="max-w-xs px-4 py-2.5">
                      {view === 'trash' ? (
                        <span className="block truncate font-medium text-slate-500 line-through decoration-slate-300">{doc.name}</span>
                      ) : (
                        <Link to={`/documents/${doc.id}`} className="block truncate font-medium text-slate-900 hover:text-indigo-700">
                          {doc.name}
                        </Link>
                      )}
                      <span className="text-xs text-slate-500">
                        v{doc.currentVersionNo}
                        {doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ''}
                        {session.isMaster && !session.accountId ? ` · office #${doc.accountId}` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{doc.categoryName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{doc.folderPath}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={doc.sourceType === 'upload' ? 'blue' : 'indigo'}>{fileKind(doc)}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {view === 'trash' ? <span className="text-slate-600">{timeAgo(doc.deletedAt)}</span> : doc.isArchived ? <StatusBadge status="Archived" /> : <StatusBadge status={doc.status} />}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                      {view === 'trash' ? (
                        doc.deletedByName ?? '—'
                      ) : (
                        <>
                          {timeAgo(doc.updatedAt)}
                          <span className="block text-xs text-slate-400">{doc.updatedByName ?? doc.createdByName}</span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {view === 'trash' ? (
                          <>
                            {canChange && <IconButton label="Restore" icon="restore" onClick={() => setPending({ kind: 'undelete', docs: [doc] })} />}
                            {canPurge && <IconButton label="Delete forever" icon="trash" danger onClick={() => setPending({ kind: 'purge', docs: [doc] })} />}
                          </>
                        ) : (
                          <>
                            <IconButton label={doc.sourceType === 'upload' ? 'Download' : 'Export'} icon="download" busy={busyId === doc.id} onClick={() => download(doc)} />
                            {canChange && !doc.isArchived && <IconButton label="Duplicate" icon="copy" onClick={() => duplicate(doc)} />}
                            {canChange && !doc.isArchived && <IconButton label="Archive" icon="archive" onClick={() => setPending({ kind: 'archive', docs: [doc] })} />}
                            {doc.isArchived && session.canManage && session.accountId && <IconButton label="Restore" icon="restore" onClick={() => setPending({ kind: 'unarchive', docs: [doc] })} />}
                            {canChange && <IconButton label="Delete" icon="trash" danger onClick={() => setPending({ kind: 'delete', docs: [doc] })} />}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </div>
      )}

      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onUploaded={(id) => {
            setUploadOpen(false);
            navigate(`/documents/${id}`);
          }}
        />
      )}

      {pending && pending.kind === 'empty' && (
        <ConfirmDialog
          title="Empty the trash?"
          message={<>Every document in the trash ({data?.total ?? 0}) will be deleted forever, including its files. This cannot be undone.</>}
          confirmLabel="Empty trash"
          danger
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const result = await http.post<{ removed: number }>('/documents/trash/empty');
            toast(`${result.removed} document${result.removed === 1 ? '' : 's'} deleted forever.`);
            reload();
          }}
        />
      )}

      {pending && pending.kind !== 'empty' && (
        <ConfirmDialog
          title={`${ACTION_TEXT[pending.kind].title} ${pending.docs.length === 1 ? 'document' : `${pending.docs.length} documents`}?`}
          message={confirmMessage(pending.kind, pending.docs)}
          confirmLabel={ACTION_TEXT[pending.kind].button}
          danger={ACTION_TEXT[pending.kind].danger}
          onClose={() => setPending(null)}
          onConfirm={() => perform(pending.kind, pending.docs)}
        />
      )}
    </>
  );
}

function confirmMessage(kind: SingleAction, docs: DocumentSummary[]) {
  const what = docs.length === 1 ? <>“{docs[0].name}”</> : <>These {docs.length} documents</>;
  switch (kind) {
    case 'delete':
      return <>{what} will move to the Trash. You can restore {docs.length === 1 ? 'it' : 'them'} from there for 30 days.</>;
    case 'purge':
      return <>{what} and {docs.length === 1 ? 'its' : 'their'} files will be deleted forever. This cannot be undone. The activity log keeps a record that {docs.length === 1 ? 'it' : 'they'} existed.</>;
    case 'archive':
      return <>{what} will move to the Archived tab. An administrator can restore {docs.length === 1 ? 'it' : 'them'} later.</>;
    case 'unarchive':
      return <>{what} will move back to the active documents.</>;
    case 'undelete':
      return <>{what} will come back to where {docs.length === 1 ? 'it was' : 'they were'} before deletion.</>;
  }
}

function BarButton({ onClick, children, danger = false }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-md px-3 py-1 font-medium ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-white/15 hover:bg-white/25'}`}>
      {children}
    </button>
  );
}

export function IconButton({ label, icon, onClick, busy = false, danger = false }: { label: string; icon: string; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={`rounded-md p-1.5 disabled:opacity-50 ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
    >
      {busy ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Icon name={icon} />}
    </button>
  );
}
