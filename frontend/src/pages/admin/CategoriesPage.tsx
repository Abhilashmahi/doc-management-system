import { useState, type FormEvent } from 'react';
import { useSession } from '../../app/session';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorBanner,
  FilterInput,
  Icon,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusBadge,
  TextAreaField,
  TextField,
  fieldErrors,
  useLoad,
  useToast,
} from '../../components/kit';
import { errorMessage, http } from '../../lib/api';
import type { Category } from '../../lib/types';

const NO_OFFICE_HINT = 'Choose an office in the top bar first';

// Document categories (Birth certificate, Income certificate, ...). Templates and documents are filed under them.
export function CategoriesPage() {
  const session = useSession();
  const [search, setSearch] = useState('');
  // null = closed, 'new' = add form, otherwise the category being edited.
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  const { data, error, loading, reload } = useLoad(
    () => http.get<{ categories: Category[] }>('/categories', { includeInactive: true }),
    [session.accountId],
  );

  // The Master Admin viewing "all offices" can look, but changes need a specific office.
  const readOnly = session.isMaster && !session.accountId;
  const query = search.trim().toLowerCase();
  const categories = (data?.categories ?? []).filter(
    (c) => !query || c.name.toLowerCase().includes(query) || (c.description ?? '').toLowerCase().includes(query),
  );

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Group templates and documents by type, such as Birth Certificate or Income Certificate."
        actions={
          <Button variant="primary" disabled={readOnly} title={readOnly ? NO_OFFICE_HINT : undefined} onClick={() => setEditing('new')}>
            <Icon name="plus" /> Add category
          </Button>
        }
      />

      <div className="mb-4">
        <FilterInput label="Search categories" value={search} onChange={setSearch} />
      </div>

      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBanner message={error} onRetry={reload} />
      ) : categories.length === 0 ? (
        <EmptyState
          title={query ? 'No matching categories' : 'No categories yet'}
          text={query ? 'Try a different search.' : 'Add your first category to start organising templates and documents.'}
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 text-right font-medium">Templates</th>
                  <th className="px-4 py-3 text-right font-medium">Documents</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                    <td className="max-w-xs px-4 py-3 text-slate-600">{c.description || <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.templateCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.documentCount}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.isActive ? 'Active' : 'Inactive'} /></td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={readOnly}
                        title={readOnly ? NO_OFFICE_HINT : undefined}
                        aria-label={`Edit ${c.name}`}
                        onClick={() => setEditing(c)}
                      >
                        <Icon name="edit" /> Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <CategoryForm
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function CategoryForm({ category, onClose, onSaved }: { category: Category | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      if (category) {
        await http.put(`/categories/${category.id}`, { name, description, isActive });
        toast('Category saved.');
      } else {
        await http.post('/categories', { name, description });
        toast('Category added.');
      }
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={category ? 'Edit category' : 'Add category'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="category-form" busy={saving}>
            {category ? 'Save changes' : 'Add category'}
          </Button>
        </>
      }
    >
      <form id="category-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        {formError && <ErrorBanner message={formError} />}
        <TextField label="Name" required value={name} onChange={setName} error={errors.name} maxLength={150} />
        <TextAreaField label="Description" value={description} onChange={setDescription} error={errors.description} maxLength={500} />
        {category && (
          <Checkbox
            label="Active"
            checked={isActive}
            onChange={setIsActive}
            hint="Inactive categories are hidden when creating new templates and documents. Existing ones keep their category."
          />
        )}
      </form>
    </Modal>
  );
}
