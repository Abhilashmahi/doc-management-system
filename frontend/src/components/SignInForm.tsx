import { useState, type FormEvent } from 'react';
import { ApiError, api, googleStartUrl, type CurrentUser } from '../lib/api';
import { GoogleButton, OrDivider } from './GoogleButton';
import { PasswordInput } from './PasswordInput';
import { errorTextClass, inputClass, labelClass, primaryButtonClass } from './ui';

interface Props {
  onSignedIn: (user: CurrentUser) => void;
  googleEnabled: boolean;
}

export function SignInForm({ onSignedIn, googleEnabled }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const next: { username?: string; password?: string } = {};
    if (username.trim().length === 0) next.username = 'Enter your username.';
    if (password.length === 0) next.password = 'Enter your password.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await api.login(username.trim(), password);
      onSignedIn(result.user);
    } catch (error) {
      setPassword('');
      setFormError(error instanceof ApiError ? error.message : 'Cannot reach the server. Is the backend running?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
      <div>
        <label htmlFor="signin-username" className={labelClass}>Username</label>
        <input
          id="signin-username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-invalid={Boolean(errors.username)}
          aria-describedby={errors.username ? 'signin-username-error' : undefined}
          className={inputClass}
        />
        {errors.username && <p id="signin-username-error" className={errorTextClass}>{errors.username}</p>}
      </div>

      <div>
        <label htmlFor="signin-password" className={labelClass}>Password</label>
        <PasswordInput
          id="signin-password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          invalid={Boolean(errors.password)}
          describedBy={errors.password ? 'signin-password-error' : undefined}
        />
        {errors.password && <p id="signin-password-error" className={errorTextClass}>{errors.password}</p>}
      </div>

      {formError && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {formError}
        </div>
      )}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
        {submitting ? 'Signing in...' : 'Sign in'}
      </button>

      <div className="flex justify-between pt-1 text-sm">
        <button type="button" className="text-indigo-600 hover:underline disabled:text-slate-400 disabled:no-underline" disabled title="Available in a later update">
          Forgot password?
        </button>
      </div>

      {googleEnabled && (
        <>
          <OrDivider />
          <GoogleButton label="Sign in with Google" onClick={() => window.location.assign(googleStartUrl('signin'))} />
        </>
      )}
    </form>
  );
}
