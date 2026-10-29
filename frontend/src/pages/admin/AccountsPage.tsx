import { useState, type FormEvent } from 'react';
import { useSession } from '../../app/session';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorBanner,
  Icon,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusBadge,
  TextField,
  fieldErrors,
  useLoad,
  useToast,
} from '../../components/kit';
import { errorMessage, http } from '../../lib/api';
import { formatBytes, timeAgo } from '../../lib/format';
import { navigate } from '../../lib/router';
import type { Account } from '../../lib/types';
import { NewPasswordField } from './UsersPage';

const MB = 1024 * 1024;

// Offices (accounts). Only the Master Admin sees this page.
export function AccountsPage() {
  const session = useSession();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const { data, error, loading, reload } = useLoad(() => http.get<{ accounts: Account[] }>('/accounts'), []);
  const accounts = data?.accounts ?? [];

  // The office list in the top bar comes from the session, so refresh it as well as this table.
  async function afterSave() {
    setEditing(null);
    reload();
    await session.reloadAccounts().catch(() => undefined);
  }

  function workIn(id: number) {
    session.setAccountId(id);
    navigate('/');
  }

  return (
    <div>
      <PageHeader
        title="Offices"
        description="Each office has its own users, templates and documents. Storage limits apply per office."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Create office
          </Button>
        }
      />

      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBanner message={error} onRetry={reload} />
      ) : accounts.length === 0 ? (
        <EmptyState title="No offices yet" text="Create the first office together with its administrator." />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Office</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Users</th>
                  <th className="px-4 py-3 text-right font-medium">Documents</th>
                  <th className="px-4 py-3 text-right font-medium">Templates</th>
                  <th className="px-4 py-3 font-medium">Storage</th>
                  <th className="px-4 py-3 font-medium">Last activity</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {a.name}
                      {a.id === session.accountId && <span className="ml-2 text-xs font-normal text-indigo-600">(current)</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={a.isActive ? 'Active' : 'Inactive'} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.userCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.documentCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.templateCount}</td>
                    <td className="px-4 py-3"><StorageBar used={a.storageUsedBytes} limit={a.storageLimitBytes} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{a.lastActivityAt ? timeAgo(a.lastActivityAt) : 'None yet'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        <Button size="sm" variant="primary" disabled={!a.isActive} title={a.isActive ? undefined : 'Activate the office first'} onClick={() => workIn(a.id)}>
                          Work in this office
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}>
                          <Icon name="edit" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`View activity for ${a.name}`}
                          title="View activity (switches the top bar to this office)"
                          onClick={() => {
                            // The activity log follows the office chosen in the top bar.
                            session.setAccountId(a.id);
                            navigate('/admin/activity');
                          }}
                        >
                          <Icon name="activity" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing === 'new' && <CreateOfficeForm onClose={() => setEditing(null)} onSaved={afterSave} />}
      {editing && editing !== 'new' && <EditOfficeForm account={editing} onClose={() => setEditing(null)} onSaved={afterSave} />}
    </div>
  );
}

// "120 MB of 1.0 GB" with a thin bar that turns amber, then red, as the office fills up.
function StorageBar({ used, limit }: { used: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const colour = percent >= 90 ? 'bg-red-500' : percent >= 75 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <div className="w-36">
      <div className="whitespace-nowrap text-xs text-slate-600">
        {formatBytes(used)} of {formatBytes(limit)}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Storage used">
        <div className={`h-full ${colour}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function CreateOfficeForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [storageLimitMb, setStorageLimitMb] = useState('1024');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await http.post('/accounts', {
        name,
        storageLimitMb: Number(storageLimitMb),
        admin: { fullName, username, password },
      });
      toast('Office created.');
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Create office"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-office-form" busy={saving}>Create office</Button>
        </>
      }
    >
      <form id="create-office-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        {formError && <ErrorBanner message={formError} />}
        <TextField label="Office name" required value={name} onChange={setName} error={errors.name} maxLength={150} />
        <TextField
          label="Storage limit (MB)"
          type="number"
          min={10}
          required
          value={storageLimitMb}
          onChange={setStorageLimitMb}
          error={errors.storageLimitMb}
          hint="1024 MB = 1 GB. Uploads stop when the office reaches its limit."
        />
        <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">First administrator</legend>
          <p className="text-xs text-slate-500">This person can then add the rest of the office's users.</p>
          <TextField label="Full name" required value={fullName} onChange={setFullName} error={errors['admin.fullName']} autoComplete="off" />
          <TextField label="Username" required value={username} onChange={setUsername} error={errors['admin.username']} autoComplete="off" />
          <NewPasswordField value={password} onChange={setPassword} error={errors['admin.password']} />
        </fieldset>
      </form>
    </Modal>
  );
}

function EditOfficeForm({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [storageLimitMb, setStorageLimitMb] = useState(String(Math.round(account.storageLimitBytes / MB)));
  const [isActive, setIsActive] = useState(account.isActive);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await http.put(`/accounts/${account.id}`, { name, storageLimitMb: Number(storageLimitMb), isActive });
      toast('Office saved.');
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Edit ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={account.isActive && !isActive ? 'danger' : 'primary'} type="submit" form="edit-office-form" busy={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-office-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        {formError && <ErrorBanner message={formError} />}
        <TextField label="Office name" required value={name} onChange={setName} error={errors.name} maxLength={150} />
        <TextField
          label="Storage limit (MB)"
          type="number"
          min={10}
          required
          value={storageLimitMb}
          onChange={setStorageLimitMb}
          error={errors.storageLimitMb}
          hint={`Currently using ${formatBytes(account.storageUsedBytes)}.`}
        />
        <Checkbox label="Active" checked={isActive} onChange={setIsActive} hint="Users of an inactive office cannot sign in." />
        {account.isActive && !isActive && (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
            All {account.userCount} user{account.userCount === 1 ? '' : 's'} of this office will be signed out at once and cannot sign in until it is activated again. No data is deleted.
          </p>
        )}
      </form>
    </Modal>
  );
}
