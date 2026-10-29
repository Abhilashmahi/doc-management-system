import { useState, type FormEvent } from 'react';
import { ApiError, api, googleStartUrl, type CurrentUser } from '../lib/api';
import { GoogleButton, OrDivider } from './GoogleButton';
import { PasswordInput } from './PasswordInput';
import { errorTextClass, inputClass, labelClass, primaryButtonClass } from './ui';

interface Props {
  onSignedIn: (user: CurrentUser) => void;
  googleEnabled: boolean;
}

type Fields = 'accountName' | 'fullName' | 'username' | 'password' | 'confirmPassword';
type Errors = Partial<Record<Fields, string>>;

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;

// Same rules as the server (backend/src/routes/signup.ts). The server check is the one that counts.
function validate(values: Record<Fields, string>): Errors {
  const errors: Errors = {};
  if (values.accountName.trim().length < 2) errors.accountName = 'Enter your office or organisation name.';
  if (values.fullName.trim().length < 2) errors.fullName = 'Enter your full name.';
  if (!USERNAME_PATTERN.test(values.username.trim())) {
    errors.username = 'Username must be 3 to 50 characters: letters, numbers, dots, underscores or hyphens.';
  }
  if (values.password.length < 10) errors.password = 'Password must be at least 10 characters long.';
  else if (!/[A-Za-z]/.test(values.password)) errors.password = 'Password must contain at least one letter.';
  else if (!/[0-9]/.test(values.password)) errors.password = 'Password must contain at least one number.';
  if (values.confirmPassword !== values.password) errors.confirmPassword = 'The two passwords do not match.';
  return errors;
}

export function SignUpForm({ onSignedIn, googleEnabled }: Props) {
  const [values, setValues] = useState<Record<Fields, string>>({
    accountName: '',
    fullName: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field: Fields, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  // Google sign-up saves the office name with the new account, so the name must be filled in first.
  function handleGoogle() {
    const accountName = values.accountName.trim();
    if (accountName.length < 2) {
      setErrors((prev) => ({ ...prev, accountName: 'Enter your office or organisation name first.' }));
      return;
    }
    window.location.assign(googleStartUrl('signup', accountName));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const clientErrors = validate(values);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    setSubmitting(true);
    try {
      const result = await api.signup({
        accountName: values.accountName.trim(),
        fullName: values.fullName.trim(),
        username: values.username.trim(),
        password: values.password,
      });
      onSignedIn(result.user);
    } catch (error) {
      if (error instanceof ApiError) {
        // Show server-side field problems next to the matching box when we can.
        const fieldErrors: Errors = {};
        for (const problem of error.details) {
          if (problem.field in values) fieldErrors[problem.field as Fields] = problem.message;
        }
        setErrors(fieldErrors);
        setFormError(Object.keys(fieldErrors).length === 0 ? error.message : null);
      } else {
        setFormError('Cannot reach the server. Is the backend running?');
      }
      setValues((prev) => ({ ...prev, password: '', confirmPassword: '' }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
      <div>
        <label htmlFor="signup-account" className={labelClass}>Office or organisation name</label>
        <input
          id="signup-account"
          autoComplete="organization"
          value={values.accountName}
          onChange={(e) => update('accountName', e.target.value)}
          aria-invalid={Boolean(errors.accountName)}
          aria-describedby={errors.accountName ? 'signup-account-error' : undefined}
          className={inputClass}
        />
        {errors.accountName && <p id="signup-account-error" className={errorTextClass}>{errors.accountName}</p>}
      </div>

      <div>
        <label htmlFor="signup-name" className={labelClass}>Your full name</label>
        <input
          id="signup-name"
          autoComplete="name"
          value={values.fullName}
          onChange={(e) => update('fullName', e.target.value)}
          aria-invalid={Boolean(errors.fullName)}
          aria-describedby={errors.fullName ? 'signup-name-error' : undefined}
          className={inputClass}
        />
        {errors.fullName && <p id="signup-name-error" className={errorTextClass}>{errors.fullName}</p>}
      </div>

      <div>
        <label htmlFor="signup-username" className={labelClass}>Username</label>
        <input
          id="signup-username"
          autoComplete="username"
          value={values.username}
          onChange={(e) => update('username', e.target.value)}
          aria-invalid={Boolean(errors.username)}
          aria-describedby={errors.username ? 'signup-username-error' : 'signup-username-hint'}
          className={inputClass}
        />
        {errors.username
          ? <p id="signup-username-error" className={errorTextClass}>{errors.username}</p>
          : <p id="signup-username-hint" className="mt-1 text-xs text-slate-500">3 to 50 letters, numbers, dots, underscores or hyphens.</p>}
      </div>

      <div>
        <label htmlFor="signup-password" className={labelClass}>Password</label>
        <PasswordInput
          id="signup-password"
          value={values.password}
          onChange={(v) => update('password', v)}
          autoComplete="new-password"
          invalid={Boolean(errors.password)}
          describedBy={errors.password ? 'signup-password-error' : 'signup-password-hint'}
        />
        {errors.password
          ? <p id="signup-password-error" className={errorTextClass}>{errors.password}</p>
          : <p id="signup-password-hint" className="mt-1 text-xs text-slate-500">At least 10 characters, with a letter and a number.</p>}
      </div>

      <div>
        <label htmlFor="signup-confirm" className={labelClass}>Confirm password</label>
        <PasswordInput
          id="signup-confirm"
          value={values.confirmPassword}
          onChange={(v) => update('confirmPassword', v)}
          autoComplete="new-password"
          invalid={Boolean(errors.confirmPassword)}
          describedBy={errors.confirmPassword ? 'signup-confirm-error' : undefined}
        />
        {errors.confirmPassword && <p id="signup-confirm-error" className={errorTextClass}>{errors.confirmPassword}</p>}
      </div>

      {formError && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {formError}
        </div>
      )}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
        {submitting ? 'Creating account...' : 'Create account'}
      </button>

      {googleEnabled && (
        <>
          <OrDivider />
          <GoogleButton label="Sign up with Google" onClick={handleGoogle} />
        </>
      )}
    </form>
  );
}
