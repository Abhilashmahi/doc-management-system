import { useState, type FormEvent } from 'react';
import { useSession } from '../app/session';
import { PasswordInput } from '../components/PasswordInput';
import { Button, Card, ErrorBanner, PageHeader, fieldErrors, useToast } from '../components/kit';
import { errorMessage, http } from '../lib/api';
import { roleLabel } from '../lib/format';
import { ThemePicker } from '../lib/theme';

type Fields = 'currentPassword' | 'newPassword' | 'confirmPassword';
type Errors = Partial<Record<Fields, string>>;

// Same rules as the server (passwordSchema in backend/src/routes/users.ts). The server check is the one that counts.
function validate(values: Record<Fields, string>): Errors {
  const errors: Errors = {};
  if (values.newPassword.length < 10) errors.newPassword = 'Password must be at least 10 characters long.';
  else if (!/[A-Za-z]/.test(values.newPassword)) errors.newPassword = 'Password must contain at least one letter.';
  else if (!/[0-9]/.test(values.newPassword)) errors.newPassword = 'Password must contain at least one number.';
  if (values.confirmPassword !== values.newPassword) errors.confirmPassword = 'The two passwords do not match.';
  return errors;
}

// The signed-in user's own details, and a form to change their password.
export function ProfilePage() {
  const session = useSession();
  const toast = useToast();
  const { user } = session;
  const [values, setValues] = useState<Record<Fields, string>>({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The Master Admin belongs to no office; for everyone else show their own office name.
  const officeName = session.isMaster ? 'All offices' : (user.accountName ?? session.accounts.find((a) => a.id === user.accountId)?.name ?? null);

  function update(field: Fields, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const clientErrors = validate(values);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    setSaving(true);
    try {
      await http.post('/profile/password', { currentPassword: values.currentPassword, newPassword: values.newPassword });
      toast('Password changed. Other devices were signed out.');
      setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (e) {
      const server = fieldErrors(e);
      setErrors(server);
      // Show the banner only when the problem is not already shown next to a box.
      setFormError(Object.keys(server).length === 0 ? errorMessage(e) : null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="My profile" description="Your account details, appearance and password." />

      <div className="space-y-6">
        <Card title="Account">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Detail label="Name" value={user.fullName} />
            <Detail label="Username" value={user.username} />
            <Detail label="Role" value={roleLabel(user.role)} />
            {officeName && <Detail label="Office" value={officeName} />}
          </dl>
        </Card>

        <Card title="Appearance">
          <p className="mb-3 text-sm text-slate-600">Choose light or dark mode for this browser. You can also switch with the sun/moon button in the top bar.</p>
          <ThemePicker />
        </Card>

        <Card title="Change password">
          <form className="max-w-md space-y-4" onSubmit={handleSubmit} noValidate>
            {/* Hidden username helps password managers save the new password against the right account. */}
            <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />

            <PasswordBox
              id="profile-current"
              label="Current password"
              value={values.currentPassword}
              onChange={(v) => update('currentPassword', v)}
              autoComplete="current-password"
              error={errors.currentPassword}
              hint="Leave empty if you have only ever signed in with Google."
            />
            <PasswordBox
              id="profile-new"
              label="New password"
              value={values.newPassword}
              onChange={(v) => update('newPassword', v)}
              autoComplete="new-password"
              error={errors.newPassword}
              hint="At least 10 characters, with a letter and a number."
            />
            <PasswordBox
              id="profile-confirm"
              label="Confirm new password"
              value={values.confirmPassword}
              onChange={(v) => update('confirmPassword', v)}
              autoComplete="new-password"
              error={errors.confirmPassword}
            />

            {formError && <ErrorBanner message={formError} />}

            <Button variant="primary" type="submit" busy={saving}>
              Change password
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value}</dd>
    </div>
  );
}

// Label + PasswordInput + error or hint underneath, wired together for screen readers.
function PasswordBox({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  error?: string;
  hint?: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>
      <PasswordInput id={id} value={value} onChange={onChange} autoComplete={autoComplete} invalid={Boolean(error)} describedBy={describedBy} />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
