import { useState, type FormEvent } from 'react';
import { useSession } from '../../app/session';
import {
  Badge,
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
  SelectField,
  TextAreaField,
  TextField,
  fieldErrors,
  useLoad,
  useToast,
} from '../../components/kit';
import { errorMessage, http } from '../../lib/api';
import type { FieldDataType, FieldDefinition, FieldValidation } from '../../lib/types';

const NO_OFFICE_HINT = 'Choose an office in the top bar first';

const TYPE_LABELS: Record<FieldDataType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Drop-down list',
  multiline: 'Multi-line text',
};

const TYPE_OPTIONS = (Object.keys(TYPE_LABELS) as FieldDataType[]).map((t) => ({ value: t, label: TYPE_LABELS[t] }));

// "Applicant name" -> "ApplicantName". Strips anything the server would reject in a Field ID.
function toFieldKey(label: string): string {
  const key = label
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('')
    .replace(/^[0-9]+/, ''); // a Field ID must start with a letter
  return key.slice(0, 60);
}

// A short, readable list of the rules, e.g. "Required · 3–50 chars".
function rulesSummary(field: FieldDefinition): string[] {
  const v = field.validation ?? {};
  const parts: string[] = [];
  if (v.required) parts.push('Required');
  if (v.minLength !== undefined && v.maxLength !== undefined) parts.push(`${v.minLength}–${v.maxLength} chars`);
  else if (v.minLength !== undefined) parts.push(`≥ ${v.minLength} chars`);
  else if (v.maxLength !== undefined) parts.push(`≤ ${v.maxLength} chars`);
  if (v.min !== undefined && v.max !== undefined) parts.push(`${v.min} to ${v.max}`);
  else if (v.min !== undefined) parts.push(`min ${v.min}`);
  else if (v.max !== undefined) parts.push(`max ${v.max}`);
  if (v.pattern) parts.push('Pattern');
  if (v.options?.length) parts.push(`${v.options.length} option${v.options.length === 1 ? '' : 's'}`);
  return parts;
}

// The Field Master: the list of data fields (Applicant name, Date of birth, ...) that templates can use.
export function FieldsPage() {
  const session = useSession();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<FieldDefinition | 'new' | null>(null);

  const { data, error, loading, reload } = useLoad(
    () => http.get<{ fields: FieldDefinition[] }>('/fields', { includeInactive: true }),
    [session.accountId],
  );

  const readOnly = session.isMaster && !session.accountId;
  const query = search.trim().toLowerCase();
  const fields = (data?.fields ?? []).filter(
    (f) => !query || f.label.toLowerCase().includes(query) || f.fieldKey.toLowerCase().includes(query),
  );

  return (
    <div>
      <PageHeader
        title="Field Master"
        description="Data fields that templates use, such as {{ApplicantName}}. Their rules are checked whenever a document is filled in."
        actions={
          <Button variant="primary" disabled={readOnly} title={readOnly ? NO_OFFICE_HINT : undefined} onClick={() => setEditing('new')}>
            <Icon name="plus" /> Add field
          </Button>
        }
      />

      <div className="mb-4">
        <FilterInput label="Search fields" value={search} onChange={setSearch} />
      </div>

      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBanner message={error} onRetry={reload} />
      ) : fields.length === 0 ? (
        <EmptyState
          title={query ? 'No matching fields' : 'No fields yet'}
          text={query ? 'Try a different search.' : 'Add fields such as Applicant Name or Date of Birth, then place them on templates.'}
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Label</th>
                  <th className="px-4 py-3 font-medium">Field ID</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Rules</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fields.map((f) => {
                  const rules = rulesSummary(f);
                  return (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{f.label}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">{`{{${f.fieldKey}}}`}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{TYPE_LABELS[f.dataType] ?? f.dataType}</td>
                      <td className="px-4 py-3 text-slate-600">{rules.length ? rules.join(' · ') : <span className="text-slate-400">—</span>}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={f.isActive ? 'green' : 'red'}>{f.isActive ? 'Active' : 'Inactive'}</Badge>
                          {!f.isVisible && <Badge tone="slate">Hidden</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={readOnly}
                          title={readOnly ? NO_OFFICE_HINT : undefined}
                          aria-label={`Edit ${f.label}`}
                          onClick={() => setEditing(f)}
                        >
                          <Icon name="edit" /> Edit
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <FieldForm
          field={editing === 'new' ? null : editing}
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

// Number boxes are kept as text while typing, so an empty box means "no rule".
const numText = (n: number | undefined) => (n === undefined ? '' : String(n));

function FieldForm({ field, onClose, onSaved }: { field: FieldDefinition | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const v = field?.validation ?? {};
  const [label, setLabel] = useState(field?.label ?? '');
  const [fieldKey, setFieldKey] = useState(field?.fieldKey ?? '');
  // Once the user types their own Field ID we stop suggesting one from the label.
  const [keyTouched, setKeyTouched] = useState(Boolean(field));
  const [dataType, setDataType] = useState<FieldDataType>(field?.dataType ?? 'text');
  const [required, setRequired] = useState(Boolean(v.required));
  const [minLength, setMinLength] = useState(numText(v.minLength));
  const [maxLength, setMaxLength] = useState(numText(v.maxLength));
  const [min, setMin] = useState(numText(v.min));
  const [max, setMax] = useState(numText(v.max));
  const [pattern, setPattern] = useState(v.pattern ?? '');
  const [patternMessage, setPatternMessage] = useState(v.patternMessage ?? '');
  const [options, setOptions] = useState((v.options ?? []).join('\n'));
  const [defaultValue, setDefaultValue] = useState(field?.defaultValue ?? '');
  const [isVisible, setIsVisible] = useState(field?.isVisible ?? true);
  const [isActive, setIsActive] = useState(field?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isTextLike = dataType === 'text' || dataType === 'multiline';

  function changeLabel(value: string) {
    setLabel(value);
    if (!keyTouched) setFieldKey(toFieldKey(value));
  }

  // Only send the rules that make sense for the chosen type and that were filled in.
  function buildValidation(): FieldValidation {
    const rules: FieldValidation = {};
    if (required) rules.required = true;
    if (isTextLike) {
      if (minLength.trim() !== '') rules.minLength = Number(minLength);
      if (maxLength.trim() !== '') rules.maxLength = Number(maxLength);
    }
    if (dataType === 'number') {
      if (min.trim() !== '') rules.min = Number(min);
      if (max.trim() !== '') rules.max = Number(max);
    }
    if (dataType === 'text' && pattern.trim() !== '') {
      rules.pattern = pattern.trim();
      if (patternMessage.trim() !== '') rules.patternMessage = patternMessage.trim();
    }
    if (dataType === 'select') {
      rules.options = options
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean);
    }
    return rules;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    const body = { fieldKey: fieldKey.trim(), label, dataType, validation: buildValidation(), defaultValue, isVisible, isActive };
    try {
      if (field) {
        await http.put(`/fields/${field.id}`, body);
        toast('Field saved.');
      } else {
        await http.post('/fields', body);
        toast('Field added.');
      }
      onSaved();
    } catch (e) {
      // Server names look like "validation.options" or "validation.options.2"; keep the first two parts.
      const mapped: Record<string, string> = {};
      for (const [name, message] of Object.entries(fieldErrors(e))) {
        const key = name.split('.').slice(0, 2).join('.');
        if (!mapped[key]) mapped[key] = message;
      }
      setErrors(mapped);
      setFormError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={field ? 'Edit field' : 'Add field'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="field-form" busy={saving}>
            {field ? 'Save changes' : 'Add field'}
          </Button>
        </>
      }
    >
      <form id="field-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        {formError && <ErrorBanner message={formError} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Label" required value={label} onChange={changeLabel} error={errors.label} maxLength={150} placeholder="Applicant name" />
          <TextField
            label="Field ID"
            required
            value={fieldKey}
            onChange={(value) => {
              setKeyTouched(true);
              setFieldKey(value);
            }}
            disabled={Boolean(field)}
            error={errors.fieldKey}
            hint={`Used in templates as {{${fieldKey || 'FieldKey'}}}; cannot change later.`}
            className="font-mono"
            maxLength={60}
          />
          <SelectField label="Type" value={dataType} onChange={(value) => setDataType(value as FieldDataType)} options={TYPE_OPTIONS} error={errors.dataType} />
          <TextField label="Default value" value={defaultValue} onChange={setDefaultValue} error={errors.defaultValue} maxLength={500} hint="Pre-filled when a new document is created." />
        </div>

        <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">Rules</legend>
          <Checkbox label="Required" checked={required} onChange={setRequired} hint="The document cannot be saved while this field is empty." />

          {isTextLike && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Minimum length" type="number" min={0} value={minLength} onChange={setMinLength} error={errors['validation.minLength']} />
              <TextField label="Maximum length" type="number" min={1} value={maxLength} onChange={setMaxLength} error={errors['validation.maxLength']} />
            </div>
          )}

          {dataType === 'number' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Smallest value" type="number" value={min} onChange={setMin} error={errors['validation.min']} />
              <TextField label="Largest value" type="number" value={max} onChange={setMax} error={errors['validation.max']} />
            </div>
          )}

          {dataType === 'text' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Pattern (regular expression)"
                value={pattern}
                onChange={setPattern}
                error={errors['validation.pattern']}
                hint="Optional. Example: ^[0-9]{6}$ for a 6-digit PIN code."
                className="font-mono"
                maxLength={200}
              />
              <TextField
                label="Message when the pattern does not match"
                value={patternMessage}
                onChange={setPatternMessage}
                error={errors['validation.patternMessage']}
                placeholder="Enter a 6-digit PIN code."
                maxLength={200}
              />
            </div>
          )}

          {dataType === 'select' && (
            <TextAreaField
              label="Options"
              required
              rows={5}
              value={options}
              onChange={setOptions}
              error={errors['validation.options']}
              hint="One option per line."
            />
          )}
        </fieldset>

        <div className="space-y-3">
          <Checkbox label="Visible" checked={isVisible} onChange={setIsVisible} hint="Hidden fields are kept but not shown on the data entry form." />
          <Checkbox label="Active" checked={isActive} onChange={setIsActive} hint="Inactive fields cannot be added to new templates." />
        </div>
      </form>
    </Modal>
  );
}
