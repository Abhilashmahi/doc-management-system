import { useState } from 'react';
import { useSession } from '../../app/session';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  FilterInput,
  FilterSelect,
  Icon,
  LoadingBlock,
  Modal,
  PageHeader,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
  fieldErrors,
  useLoad,
  useToast,
} from '../../components/kit';
import { Link } from '../../components/Link';
import { PAGE_SIZES, newId, type CanvasDocument } from '../../designer/types';
import { errorMessage, http } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { navigate, useSearchParams } from '../../lib/router';
import type { StoredAsset, Template } from '../../lib/types';
import { TemplateThumb } from '../documents/DocumentFormPage';
import { useCategories } from '../documents/shared';

type Pending = { kind: 'publish' | 'unpublish' | 'archive' | 'restore'; template: Template } | null;

export function TemplatesPage() {
  const session = useSession();
  const toast = useToast();
  const params = useSearchParams();
  const categories = useCategories();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [createOpen, setCreateOpen] = useState(params.get('create') === '1');
  const [editing, setEditing] = useState<Template | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const { data, error, loading, reload } = useLoad(
    () => http.get<{ templates: Template[] }>('/templates', { q, status, categoryId }),
    [q, status, categoryId],
  );

  const canChange = session.canManage && Boolean(session.accountId);

  async function duplicate(t: Template) {
    try {
      const result = await http.post<{ id: number }>(`/templates/${t.id}/duplicate`);
      toast('Template copied as a draft.');
      navigate(`/templates/${result.id}/design`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Templates"
        description={session.canManage ? 'Design reusable layouts with fillable fields. Publish a template so people can create documents from it.' : 'Published templates you can create documents from.'}
        actions={
          canChange ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" /> New template
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <FilterInput label="Search templates" value={q} onChange={setQ} type="search" />
        <FilterSelect label="All categories" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        {session.canManage && (
          <FilterSelect label="Any status" value={status} onChange={setStatus} options={['Draft', 'Published', 'Archived'].map((s) => ({ value: s, label: s }))} />
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <LoadingBlock />}
      {data && data.templates.length === 0 && (
        <EmptyState
          title={q || status || categoryId ? 'No templates match' : 'No templates yet'}
          text={canChange ? 'Create a template from a blank page or from a scanned form image.' : 'An administrator needs to publish a template first.'}
          action={canChange ? <Button variant="primary" onClick={() => setCreateOpen(true)}>New template</Button> : undefined}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data?.templates.map((t) => (
          <div key={t.id} className="flex flex-col rounded-xl bg-surface p-4 shadow-sm ring-1 ring-slate-200">
            <TemplateThumb templateId={t.id} />
            <div className="mt-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{t.name}</p>
                <p className="text-sm text-slate-500">{t.categoryName ?? 'No category'}</p>
              </div>
              <StatusBadge status={t.status} />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Version {t.currentVersionNo} · {t.documentCount} document{t.documentCount === 1 ? '' : 's'} · updated {timeAgo(t.updatedAt)}
            </p>
            {t.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{t.description}</p>}

            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              {t.status === 'Published' && session.canEdit && session.accountId && (
                <Link to={`/documents/new?templateId=${t.id}`} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
                  <Icon name="plus" /> Use
                </Link>
              )}
              {canChange && t.status !== 'Archived' && (
                <Link to={`/templates/${t.id}/design`} className="inline-flex items-center gap-1 rounded-lg bg-surface px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
                  <Icon name="design" /> Design
                </Link>
              )}
              {canChange && (
                <>
                  <Button size="sm" onClick={() => setEditing(t)}>Details</Button>
                  <Button size="sm" onClick={() => duplicate(t)}>Duplicate</Button>
                  {t.status === 'Draft' && <Button size="sm" onClick={() => setPending({ kind: 'publish', template: t })}>Publish</Button>}
                  {t.status === 'Published' && <Button size="sm" onClick={() => setPending({ kind: 'unpublish', template: t })}>Unpublish</Button>}
                  {t.status !== 'Archived' && <Button size="sm" onClick={() => setPending({ kind: 'archive', template: t })}>Archive</Button>}
                  {t.status === 'Archived' && <Button size="sm" onClick={() => setPending({ kind: 'restore', template: t })}>Restore</Button>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {createOpen && <CreateTemplateDialog onClose={() => setCreateOpen(false)} />}
      {editing && <TemplateDetailsDialog template={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {pending && (
        <ConfirmDialog
          title={{ publish: 'Publish template?', unpublish: 'Move back to draft?', archive: 'Archive template?', restore: 'Restore template?' }[pending.kind]}
          message={
            {
              publish: 'Editors can then create documents from it. You can keep editing; each save becomes a new version, and existing documents keep the version they were made from.',
              unpublish: 'Editors will no longer see it when creating documents. Existing documents are not affected.',
              archive: 'It is hidden from everyone creating documents. Existing documents are not affected.',
              restore: 'The template becomes a draft again. Publish it when it is ready.',
            }[pending.kind]
          }
          confirmLabel={{ publish: 'Publish', unpublish: 'Move to draft', archive: 'Archive', restore: 'Restore' }[pending.kind]}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const status = { publish: 'Published', unpublish: 'Draft', archive: 'Archived', restore: 'Draft' }[pending.kind];
            await http.post(`/templates/${pending.template.id}/status`, { status });
            toast(`Template ${status === 'Published' ? 'published' : status === 'Archived' ? 'archived' : 'moved to draft'}.`);
            reload();
          }}
        />
      )}
    </>
  );
}

// New template: a blank page of a chosen size, or a page with an uploaded image (a scanned form) as its background.
function CreateTemplateDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const categories = useCategories();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [sizeIndex, setSizeIndex] = useState('0');
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const size = PAGE_SIZES[Number(sizeIndex)];
      const page = { id: newId('page'), width: size.width, height: size.height, background: '#ffffff', backgroundFileId: null as number | null, elements: [] };
      if (backgroundFile) {
        const form = new FormData();
        form.append('file', backgroundFile);
        const uploaded = await http.upload<{ file: StoredAsset }>('/files/assets', form);
        page.backgroundFileId = uploaded.file.id;
        // Match the page shape to the image, keeping the chosen width.
        const img = await readImageSize(backgroundFile);
        if (img) page.height = Math.round((size.width * img.height) / img.width);
      }
      const canvas: CanvasDocument = { schemaVersion: 1, pages: [page] };
      const result = await http.post<{ id: number }>('/templates', {
        name,
        categoryId: categoryId ? Number(categoryId) : null,
        description,
        canvas,
      });
      toast('Template created. Add text, fields and codes in the designer.');
      navigate(`/templates/${result.id}/design`);
    } catch (e) {
      setError(errorMessage(e));
      setErrors(fieldErrors(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New template"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={submit}>Create and open designer</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Template name" value={name} onChange={setName} required error={errors.name} placeholder="Birth Certificate Template 01" maxLength={150} />
        <SelectField label="Category" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} placeholder="No category" />
        <TextAreaField label="Description" value={description} onChange={setDescription} maxLength={500} />
        <SelectField label="Page size" value={sizeIndex} onChange={setSizeIndex} options={PAGE_SIZES.map((s, i) => ({ value: i, label: `${s.label} (${s.width} × ${s.height} px)` }))} />
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Start from a scanned form (optional)</p>
          <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(e) => setBackgroundFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200" />
          <p className="mt-1 text-xs text-slate-500">
            A PNG or JPEG becomes the page background, and you place fields on top of it. For a PDF form, save the page as an image first
            (for example with “Export as image” in your PDF reader).
          </p>
        </div>
        {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}

function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function TemplateDetailsDialog({ template, onClose, onSaved }: { template: Template; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const categories = useCategories();
  const [name, setName] = useState(template.name);
  const [categoryId, setCategoryId] = useState(template.categoryId ? String(template.categoryId) : '');
  const [description, setDescription] = useState(template.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await http.put(`/templates/${template.id}`, { name, categoryId: categoryId ? Number(categoryId) : null, description });
      toast('Template details saved.');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setErrors(fieldErrors(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Template details"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={submit}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Template name" value={name} onChange={setName} required error={errors.name} maxLength={150} />
        <SelectField label="Category" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} placeholder="No category" />
        <TextAreaField label="Description" value={description} onChange={setDescription} maxLength={500} />
        {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}
