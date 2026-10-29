import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from '../../app/session';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  FilterSelect,
  Icon,
  LoadingBlock,
  Modal,
  PageHeader,
  SelectField,
  TextField,
  fieldErrors,
  useLoad,
  useToast,
} from '../../components/kit';
import { errorMessage, http } from '../../lib/api';
import { roleLabel, timeAgo } from '../../lib/format';
import { navigate } from '../../lib/router';
import type { Role, UserRow } from '../../lib/types';

// ---------- Password helpers (also used by the Offices page) ----------

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

// A random 12-character password with letters and digits. Look-alike characters (0/O, 1/l/I) are left out
// so it is easy to read out over the phone. It is regenerated until it has at least one letter and one digit.
export function generatePassword(length = 12): string {
  for (;;) {
    const bytes = new Uint32Array(length);
    crypto.getRandomValues(bytes);
    const password = Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
    if (/[A-Za-z]/.test(password) && /[0-9]/.test(password)) return password;
  }
}

// A visible password box with "Generate" and "Copy" buttons. Visible on purpose: the admin needs to pass it on.
export function NewPasswordField({ label = 'Password', value, onChange, error }: { label?: string; value: string; onChange: (v: string) => void; error?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <TextField
        label={label}
        required
        value={value}
        onChange={(v) => {
          setCopied(false);
          onChange(v);
        }}
        error={error}
        hint="At least 10 characters, with a letter and a number. Share it with the user; they can change it in My profile."
        autoComplete="new-password"
        className="font-mono"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            setCopied(false);
            onChange(generatePassword());
          }}
        >
          Generate
        </Button>
        <Button
          size="sm"
          disabled={!value}
          onClick={() => {
            navigator.clipboard
              ?.writeText(value)
              .then(() => setCopied(true))
              .catch(() => undefined);
          }}
        >
          <Icon name="copy" /> {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

// ---------- Users page ----------

const ROLE_HELP: { role: Role; text: string }[] = [
  { role: 'Admin', text: 'manages office users, templates, categories and fields.' },
  { role: 'Editor', text: 'creates and edits documents.' },
  { role: 'Viewer', text: 'can only view and download.' },
];

function isLocked(user: UserRow): boolean {
  return Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
}

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; user: UserRow }
  | { kind: 'password'; user: UserRow }
  | { kind: 'status'; user: UserRow };

export function UsersPage() {
  const session = useSession();
  const toast = useToast();
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const { data, error, loading, reload } = useLoad(() => http.get<{ users: UserRow[] }>('/users'), [session.accountId]);

  const users = (data?.users ?? []).filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (statusFilter === 'active' && !u.isActive) return false;
    if (statusFilter === 'inactive' && u.isActive) return false;
    if (statusFilter === 'locked' && !isLocked(u)) return false;
    return true;
  });

  const roleOptions = (['MasterAdmin', 'Admin', 'Editor', 'Viewer'] as Role[])
    .filter((r) => r !== 'MasterAdmin' || session.isMaster)
    .map((r) => ({ value: r, label: roleLabel(r) }));

  async function unlock(user: UserRow) {
    try {
      await http.post(`/users/${user.id}/unlock`);
      toast(`${user.fullName} can sign in again.`);
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const close = () => setDialog(null);
  const saved = () => {
    setDialog(null);
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Users"
        description="People who can sign in, and what each of them is allowed to do."
        actions={
          <Button variant="primary" onClick={() => setDialog({ kind: 'add' })}>
            <Icon name="plus" /> Add user
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <FilterSelect label="All roles" value={roleFilter} onChange={setRoleFilter} options={roleOptions} />
        <FilterSelect
          label="All statuses"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'locked', label: 'Locked' },
          ]}
        />
      </div>

      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBanner message={error} onRetry={reload} />
      ) : users.length === 0 ? (
        <EmptyState
          title={roleFilter || statusFilter ? 'No matching users' : 'No users yet'}
          text={roleFilter || statusFilter ? 'Try changing the filters.' : 'Add the people who work in this office.'}
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  {session.isMaster && <th className="px-4 py-3 font-medium">Office</th>}
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last sign-in</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => {
                  const locked = isLocked(u);
                  const isMe = u.id === session.user.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {u.fullName} {isMe && <span className="text-xs font-normal text-slate-500">(you)</span>}
                        </div>
                        <div className="text-xs text-slate-500">{u.username}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{u.email || <span className="text-slate-400">—</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge tone={u.role === 'MasterAdmin' || u.role === 'Admin' ? 'indigo' : 'slate'}>{roleLabel(u.role)}</Badge>
                      </td>
                      {session.isMaster && <td className="px-4 py-3 text-slate-600">{u.accountName ?? <span className="text-slate-400">All offices</span>}</td>}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
                          {locked && <Badge tone="amber">Locked</Badge>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600" title={u.lastLoginAt ?? undefined}>
                        {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowMenu
                          label={`Actions for ${u.fullName}`}
                          items={[
                            { label: 'Edit', onClick: () => setDialog({ kind: 'edit', user: u }) },
                            { label: 'Reset password', onClick: () => setDialog({ kind: 'password', user: u }) },
                            ...(locked ? [{ label: 'Unlock', onClick: () => unlock(u) }] : []),
                            // You cannot switch yourself off; the server refuses it too.
                            ...(isMe ? [] : [{ label: u.isActive ? 'Deactivate' : 'Activate', danger: u.isActive, onClick: () => setDialog({ kind: 'status', user: u }) }]),
                            { label: 'View activity', onClick: () => navigate(`/admin/activity?userId=${u.id}`) },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {dialog?.kind === 'add' && <AddUserForm onClose={close} onSaved={saved} />}
      {dialog?.kind === 'edit' && <EditUserForm user={dialog.user} onClose={close} onSaved={saved} />}
      {dialog?.kind === 'password' && <ResetPasswordForm user={dialog.user} onClose={close} onSaved={saved} />}
      {dialog?.kind === 'status' && (
        <ConfirmDialog
          title={dialog.user.isActive ? 'Deactivate user' : 'Activate user'}
          message={
            dialog.user.isActive
              ? `${dialog.user.fullName} will be signed out at once and will not be able to sign in until activated again. Their documents are kept.`
              : `${dialog.user.fullName} will be able to sign in again.`
          }
          confirmLabel={dialog.user.isActive ? 'Deactivate' : 'Activate'}
          danger={dialog.user.isActive}
          onClose={close}
          onConfirm={async () => {
            await http.post(`/users/${dialog.user.id}/status`, { isActive: !dialog.user.isActive });
            toast(dialog.user.isActive ? 'User deactivated.' : 'User activated.');
            reload();
          }}
        />
      )}
    </div>
  );
}

// ---------- Row actions menu ----------

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

// A "..." button with a small drop-down. The list uses fixed positioning so the table's scroll box does not clip it.
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    menuRef.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [position]);

  function toggle() {
    if (position) return setPosition(null);
    const rect = buttonRef.current!.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        className="rounded-md px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {position && (
        <div
          ref={menuRef}
          role="menu"
          style={{ top: position.top, right: position.right }}
          className="fixed z-40 w-48 overflow-hidden rounded-xl bg-surface py-1 text-left shadow-lg ring-1 ring-slate-200"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setPosition(null);
                item.onClick();
              }}
              className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-50 ${item.danger ? 'text-red-600' : 'text-slate-700'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------- Dialogs ----------

function RoleHelp() {
  return (
    <ul className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
      {ROLE_HELP.map((r) => (
        <li key={r.role}>
          <span className="font-semibold text-slate-800">{r.role}</span>: {r.text}
        </li>
      ))}
    </ul>
  );
}

function AddUserForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const session = useSession();
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('Editor');
  const [accountId, setAccountId] = useState(session.accountId ? String(session.accountId) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Only the Master Admin picks an office; everyone else adds users to their own office.
  const showOffice = session.isMaster && role !== 'MasterAdmin';
  const roles: Role[] = session.isMaster ? ['Admin', 'Editor', 'Viewer', 'MasterAdmin'] : ['Admin', 'Editor', 'Viewer'];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await http.post('/users', {
        fullName,
        username,
        email,
        password,
        role,
        accountId: showOffice && accountId ? Number(accountId) : null,
      });
      toast('User added.');
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add user"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-user-form" busy={saving}>Add user</Button>
        </>
      }
    >
      <form id="add-user-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        {formError && <ErrorBanner message={formError} />}
        <TextField label="Full name" required value={fullName} onChange={setFullName} error={errors.fullName} autoComplete="off" />
        <TextField label="Username" required value={username} onChange={setUsername} error={errors.username} hint="Used to sign in. Letters, numbers, dots, underscores, hyphens and @." autoComplete="off" />
        <TextField label="Email" type="email" value={email} onChange={setEmail} error={errors.email} hint="Optional. Needed to sign in with Google." autoComplete="off" />
        <NewPasswordField value={password} onChange={setPassword} error={errors.password} />
        <SelectField label="Role" value={role} onChange={(v) => setRole(v as Role)} options={roles.map((r) => ({ value: r, label: roleLabel(r) }))} error={errors.role} />
        <RoleHelp />
        {role === 'MasterAdmin' && <p className="text-xs text-amber-700">A Master Admin can see and change every office.</p>}
        {showOffice && (
          <SelectField
            label="Office"
            required
            value={accountId}
            onChange={setAccountId}
            placeholder="Choose an office"
            options={session.accounts.map((a) => ({ value: a.id, label: a.name }))}
            error={errors.accountId}
          />
        )}
      </form>
    </Modal>
  );
}

function EditUserForm({ user, onClose, onSaved }: { user: UserRow; onClose: () => void; onSaved: () => void }) {
  const session = useSession();
  const toast = useToast();
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email ?? '');
  const [role, setRole] = useState<Role>(user.role);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isMe = user.id === session.user.id;
  // The Master Admin role cannot be given or taken away after creation (the server enforces this).
  const roles: Role[] = user.role === 'MasterAdmin' ? ['MasterAdmin'] : ['Admin', 'Editor', 'Viewer'];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await http.put(`/users/${user.id}`, { fullName, email, role });
      toast(role !== user.role ? 'User saved. They will need to sign in again.' : 'User saved.');
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Edit ${user.fullName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="edit-user-form" busy={saving}>Save changes</Button>
        </>
      }
    >
      <form id="edit-user-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        {formError && <ErrorBanner message={formError} />}
        <TextField label="Username" value={user.username} onChange={() => undefined} disabled hint="Usernames cannot be changed." />
        <TextField label="Full name" required value={fullName} onChange={setFullName} error={errors.fullName} />
        <TextField label="Email" type="email" value={email} onChange={setEmail} error={errors.email} hint="Optional." />
        <SelectField
          label="Role"
          value={role}
          onChange={(v) => setRole(v as Role)}
          options={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
          disabled={isMe || user.role === 'MasterAdmin'}
          error={errors.role}
          hint={isMe ? 'You cannot change your own role.' : 'Changing the role signs the user out so the new role applies at once.'}
        />
        {user.role !== 'MasterAdmin' && <RoleHelp />}
      </form>
    </Modal>
  );
}

function ResetPasswordForm({ user, onClose, onSaved }: { user: UserRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState(() => generatePassword());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await http.post(`/users/${user.id}/password`, { password });
      toast('Password reset. Give the new password to the user.');
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Reset password for ${user.fullName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="reset-password-form" busy={saving}>Reset password</Button>
        </>
      }
    >
      <form id="reset-password-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        {formError && <ErrorBanner message={formError} />}
        <p className="text-sm text-slate-600">
          The user is signed out on every device and any lockout is cleared. Copy the password before saving.
        </p>
        <NewPasswordField label="New password" value={password} onChange={setPassword} error={errors.password} />
      </form>
    </Modal>
  );
}
