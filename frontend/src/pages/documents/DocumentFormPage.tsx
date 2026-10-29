import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../app/session';
import { Button, Card, EmptyState, ErrorBanner, FilterInput, FilterSelect, LoadingBlock, PageHeader, SelectField, TextAreaField, TextField, fieldErrors, useLoad, useToast } from '../../components/kit';
import { Link } from '../../components/Link';
import { DocumentPreview } from '../../designer/PageView';
import type { CanvasDocument } from '../../designer/types';
import { errorMessage, http } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { navigate, useSearchParams } from '../../lib/router';
import type { DocumentDetail, FieldDefinition, Template, TemplateDetail, TemplateField } from '../../lib/types';
import { FolderInput, useCategories, useFolders } from './shared';

// Two jobs:
//  - /documents/new            choose a template, fill in its form, and save a new document
//  - /documents/:id/edit       change the values of an existing template-based document
// The form is generated from the template's fields; the preview on the right updates as you type.
export function DocumentFormPage({ documentId }: { documentId?: number }) {
  const params = useSearchParams();
  const templateId = Number(params.get('templateId')) || null;

  if (documentId) return <EditExisting documentId={documentId} />;
  if (templateId) return <CreateFromTemplate templateId={templateId} />;
  return <TemplatePicker />;
}

// ---------- Step 1: choose a template ----------

function TemplatePicker() {
  const session = useSession();
  const categories = useCategories();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const { data, error, loading, reload } = useLoad(() => http.get<{ templates: Template[] }>('/templates', { status: 'Published' }), []);

  const templates = (data?.templates ?? []).filter(
    (t) => (!q || t.name.toLowerCase().includes(q.toLowerCase())) && (!categoryId || String(t.categoryId) === categoryId),
  );

  if (!session.accountId) {
    return <EmptyState title="Choose an office first" text="Pick the office in the top bar, then create the document." />;
  }

  return (
    <>
      <PageHeader title="New document" description="Step 1 of 2: choose a published template. You fill in its fields next." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <FilterInput label="Search templates" value={q} onChange={setQ} type="search" />
        <FilterSelect label="All categories" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
      </div>
      {loading && <LoadingBlock />}
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {data && templates.length === 0 && (
        <EmptyState
          title={data.templates.length === 0 ? 'No published templates yet' : 'No templates match'}
          text={data.templates.length === 0 ? 'An administrator needs to design and publish a template first.' : 'Try another search or category.'}
          action={session.canManage && data.templates.length === 0 ? <Link to="/templates" className="font-medium text-indigo-600 hover:underline">Go to Templates</Link> : undefined}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => navigate(`/documents/new?templateId=${t.id}`)}
            className="rounded-xl bg-surface p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-2 hover:ring-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <TemplateThumb templateId={t.id} />
            <p className="mt-3 font-medium text-slate-900">{t.name}</p>
            <p className="text-sm text-slate-500">{t.categoryName ?? 'No category'}</p>
            <p className="mt-1 text-xs text-slate-400">Version {t.currentVersionNo} · updated {formatDate(t.updatedAt)}</p>
          </button>
        ))}
      </div>
    </>
  );
}

// A small preview of a template's first page.
export function TemplateThumb({ templateId }: { templateId: number }) {
  const { data } = useLoad(() => http.get<TemplateDetail>(`/templates/${templateId}`), [templateId]);
  return (
    <div className="flex h-44 items-start justify-center overflow-hidden rounded-lg bg-slate-100 p-3">
      {data && <DocumentPreview canvas={{ ...data.canvas, pages: [data.canvas.pages[0]] }} values={null} maxWidth={150} />}
    </div>
  );
}

// ---------- Step 2: the generated form ----------

interface FormModel {
  canvas: CanvasDocument;
  fields: TemplateField[];
  definitions: FieldDefinition[];
}

function CreateFromTemplate({ templateId }: { templateId: number }) {
  const session = useSession();
  const toast = useToast();
  const categories = useCategories();
  const folders = useFolders();
  const { data, error, loading, reload } = useLoad(async () => {
    const [detail, fields] = await Promise.all([
      http.get<TemplateDetail>(`/templates/${templateId}`),
      http.get<{ fields: FieldDefinition[] }>('/fields', { includeInactive: true }),
    ]);
    return { detail, definitions: fields.fields };
  }, [templateId]);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [folder, setFolder] = useState('/');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<'Draft' | 'Final' | 'another' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedCount, setSavedCount] = useState(0);

  // Fill in default values once the template has loaded.
  useEffect(() => {
    if (!data) return;
    setValues(defaultValues(data.detail.fields, data.definitions));
    setName(`${data.detail.template.name} – ${new Date().toLocaleDateString('en-IN')}`);
    setCategoryId(data.detail.template.categoryId ? String(data.detail.template.categoryId) : '');
  }, [data]);

  if (loading && !data) return <LoadingBlock />;
  if (error || !data) return <ErrorBanner message={error ?? 'Template not found.'} onRetry={reload} />;

  const model: FormModel = { canvas: data.detail.canvas, fields: data.detail.fields, definitions: data.definitions };

  async function save(mode: 'Draft' | 'Final' | 'another') {
    setSaving(mode);
    setFormError(null);
    setErrors({});
    const clientErrors = mode === 'Draft' ? {} : validate(model, values);
    if (Object.keys(clientErrors).length > 0 || !name.trim()) {
      setErrors({ ...clientErrors, ...(name.trim() ? {} : { name: 'Enter a document name.' }) });
      setFormError('Some fields need attention.');
      setSaving(null);
      return;
    }
    try {
      const result = await http.post<{ id: number }>('/documents', {
        templateId,
        name: name.trim(),
        categoryId: categoryId ? Number(categoryId) : null,
        folder,
        data: values,
        status: mode === 'Draft' ? 'Draft' : 'Final',
      });
      if (mode === 'another') {
        // Same template, fresh form: for entering many records one after another.
        toast(`Saved “${name.trim()}”. Ready for the next record.`);
        setSavedCount((n) => n + 1);
        setValues(defaultValues(model.fields, model.definitions));
        setSaving(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      toast(mode === 'Draft' ? 'Draft saved.' : 'Document saved.');
      navigate(`/documents/${result.id}`);
    } catch (e) {
      setFormError(errorMessage(e));
      setErrors(fieldErrors(e));
      setSaving(null);
    }
  }

  return (
    <>
      <div className="mb-2 text-sm">
        <Link to="/documents/new" className="text-slate-500 hover:text-slate-800">← Choose another template</Link>
      </div>
      <PageHeader
        title={data.detail.template.name}
        description={`Step 2 of 2: fill in the fields. Template version ${data.detail.template.currentVersionNo}.${savedCount ? ` ${savedCount} record(s) saved in this session.` : ''}`}
      />
      <FormLayout
        model={model}
        values={values}
        onValues={setValues}
        errors={errors}
        formError={formError}
        meta={
          <>
            <TextField label="Document name" value={name} onChange={setName} error={errors.name} required maxLength={200} />
            <SelectField label="Category" value={categoryId ?? ''} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} placeholder="No category" />
            <FolderInput value={folder} onChange={setFolder} folders={folders} error={errors.folder} />
          </>
        }
        actions={
          <>
            <Button busy={saving === 'Draft'} disabled={saving !== null} onClick={() => save('Draft')}>Save as draft</Button>
            <Button busy={saving === 'another'} disabled={saving !== null || !session.canEdit} onClick={() => save('another')}>Save & add another</Button>
            <Button variant="primary" busy={saving === 'Final'} disabled={saving !== null} onClick={() => save('Final')}>Save document</Button>
          </>
        }
      />
    </>
  );
}

function EditExisting({ documentId }: { documentId: number }) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => http.get<DocumentDetail>(`/documents/${documentId}`), [documentId]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<'Draft' | 'Final' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data?.content) setValues({ ...data.content.data });
  }, [data]);

  if (loading && !data) return <LoadingBlock />;
  if (error || !data) return <ErrorBanner message={error ?? 'Document not found.'} onRetry={reload} />;
  if (!data.content) return <EmptyState title="This document has no form" text="Uploaded files are changed by uploading a new version." />;

  const doc = data.document;
  const model: FormModel = { canvas: data.content.canvas, fields: data.content.fields, definitions: data.content.definitions };

  async function save(status: 'Draft' | 'Final') {
    setSaving(status);
    setFormError(null);
    setErrors({});
    const clientErrors = status === 'Draft' ? {} : validate(model, values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setFormError('Some fields need attention.');
      setSaving(null);
      return;
    }
    try {
      // baseVersionNo lets the server refuse the save if someone else changed the document meanwhile.
      await http.put(`/documents/${doc.id}/content`, { data: values, status, baseVersionNo: doc.currentVersionNo });
      toast(status === 'Draft' ? 'Draft saved as a new version.' : 'Saved as a new version.');
      navigate(`/documents/${doc.id}`);
    } catch (e) {
      setFormError(errorMessage(e));
      setErrors(fieldErrors(e));
      setSaving(null);
    }
  }

  return (
    <>
      <div className="mb-2 text-sm">
        <Link to={`/documents/${doc.id}`} className="text-slate-500 hover:text-slate-800">← Back to document</Link>
      </div>
      <PageHeader title={`Edit: ${doc.name}`} description={`Saving creates version ${doc.currentVersionNo + 1}. Earlier versions stay in the history.`} />
      <FormLayout
        model={model}
        values={values}
        onValues={setValues}
        errors={errors}
        formError={formError}
        actions={
          <>
            <Link to={`/documents/${doc.id}`} className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</Link>
            <Button busy={saving === 'Draft'} disabled={saving !== null} onClick={() => save('Draft')}>Save as draft</Button>
            <Button variant="primary" busy={saving === 'Final'} disabled={saving !== null} onClick={() => save('Final')}>Save</Button>
          </>
        }
      />
    </>
  );
}

// ---------- Shared form layout ----------

function FormLayout({
  model,
  values,
  onValues,
  errors,
  formError,
  meta,
  actions,
}: {
  model: FormModel;
  values: Record<string, string>;
  onValues: (v: Record<string, string>) => void;
  errors: Record<string, string>;
  formError: string | null;
  meta?: React.ReactNode;
  actions: React.ReactNode;
}) {
  const byKey = useMemo(() => new Map(model.definitions.map((d) => [d.fieldKey, d])), [model.definitions]);
  const visibleFields = model.fields.filter((f) => byKey.get(f.fieldKey)?.isVisible !== false);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="space-y-6">
        {meta && (
          <Card title="Document">
            <div className="space-y-4">{meta}</div>
          </Card>
        )}
        <Card title="Fields">
          {visibleFields.length === 0 ? (
            <p className="text-sm text-slate-500">This template has no fields to fill in.</p>
          ) : (
            <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
              {visibleFields.map((tf) => (
                <FieldInput
                  key={tf.fieldKey}
                  templateField={tf}
                  definition={byKey.get(tf.fieldKey)}
                  value={values[tf.fieldKey] ?? ''}
                  error={errors[tf.fieldKey]}
                  onChange={(v) => onValues({ ...values, [tf.fieldKey]: v })}
                />
              ))}
            </form>
          )}
        </Card>
        {formError && <ErrorBanner message={formError} />}
        <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-surface">
          {actions}
        </div>
      </div>

      <Card title="Live preview">
        <div className="rounded-lg bg-slate-100 p-4 lg:sticky lg:top-20">
          <DocumentPreview canvas={model.canvas} values={values} maxWidth={720} />
        </div>
      </Card>
    </div>
  );
}

function FieldInput({ templateField, definition, value, error, onChange }: { templateField: TemplateField; definition?: FieldDefinition; value: string; error?: string; onChange: (v: string) => void }) {
  const label = definition?.label ?? templateField.fieldKey;
  const rules = definition?.validation ?? {};
  const required = templateField.required || rules.required === true;
  const hint = `{{${templateField.fieldKey}}}`;

  switch (definition?.dataType) {
    case 'multiline':
      return <TextAreaField label={label} value={value} onChange={onChange} required={required} error={error} hint={hint} maxLength={rules.maxLength} />;
    case 'select':
      return <SelectField label={label} value={value} onChange={onChange} required={required} error={error} hint={hint} placeholder="Choose..." options={(rules.options ?? []).map((o) => ({ value: o, label: o }))} />;
    case 'date':
      return <TextField label={label} type="date" value={value} onChange={onChange} required={required} error={error} hint={hint} />;
    case 'number':
      return <TextField label={label} type="number" inputMode="decimal" value={value} onChange={onChange} required={required} error={error} hint={hint} min={rules.min} max={rules.max} />;
    default:
      return <TextField label={label} value={value} onChange={onChange} required={required} error={error} hint={hint} maxLength={rules.maxLength} />;
  }
}

function defaultValues(fields: TemplateField[], definitions: FieldDefinition[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const def = definitions.find((d) => d.fieldKey === f.fieldKey);
    let value = f.defaultValue || def?.defaultValue || '';
    // "today" is a handy default for issue dates.
    if (def?.dataType === 'date' && value.toLowerCase() === 'today') value = new Date().toISOString().slice(0, 10);
    out[f.fieldKey] = value;
  }
  return out;
}

// The same checks as the server, so most mistakes show up before saving. The server check is the one that counts.
function validate(model: FormModel, values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const tf of model.fields) {
    const def = model.definitions.find((d) => d.fieldKey === tf.fieldKey);
    const label = def?.label ?? tf.fieldKey;
    const value = (values[tf.fieldKey] ?? '').trim();
    const rules = def?.validation ?? {};
    if (!value) {
      if (tf.required || rules.required) errors[tf.fieldKey] = `${label} is required.`;
      continue;
    }
    if (rules.maxLength !== undefined && value.length > rules.maxLength) errors[tf.fieldKey] = `${label} can be at most ${rules.maxLength} characters long.`;
    else if (rules.minLength !== undefined && value.length < rules.minLength) errors[tf.fieldKey] = `${label} must be at least ${rules.minLength} characters long.`;
    else if (def?.dataType === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) errors[tf.fieldKey] = `${label} must be a number.`;
      else if (rules.min !== undefined && n < rules.min) errors[tf.fieldKey] = `${label} must be ${rules.min} or more.`;
      else if (rules.max !== undefined && n > rules.max) errors[tf.fieldKey] = `${label} must be ${rules.max} or less.`;
    } else if (rules.pattern) {
      try {
        if (!new RegExp(`^(?:${rules.pattern})$`).test(value)) errors[tf.fieldKey] = rules.patternMessage || `${label} is not in the expected format.`;
      } catch {
        // ignore a broken pattern; the server ignores it too
      }
    }
  }
  return errors;
}
