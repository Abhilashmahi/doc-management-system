import { useEffect, useState } from 'react';
import type { AuthOptions, CurrentUser } from '../lib/api';
import { Link } from '../components/Link';
import { SignInForm } from '../components/SignInForm';
import { AuthLayout } from './AuthLayout';

interface Props {
  options: AuthOptions;
  onSignedIn: (user: CurrentUser) => void;
}

// Messages for the reason codes that the backend sends back after a failed Google sign-in (see backend/src/routes/google.ts).
const AUTH_MESSAGES: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_expired: 'That Google sign-in took too long. Please try again.',
  google_failed: 'Google sign-in failed. Please try again.',
  google_not_configured: 'Google sign-in is not set up yet.',
  google_no_account: 'No account is linked to that Google address yet. Use Create account to make one.',
  google_office_name: 'Enter your office or organisation name, then sign up with Google.',
  google_conflict: 'An account with that email already exists. Sign in with your username and password instead.',
  google_signup_disabled: 'Creating new accounts is turned off. Please ask your administrator.',
  google_deactivated: 'This account is deactivated. Please contact your administrator.',
  google_email_unverified: 'Google has not confirmed that address. Verify it with Google and try again.',
};

export function LoginPage({ options, onSignedIn }: Props) {
  const [pageError, setPageError] = useState<string | null>(null);

  // A failed Google sign-in comes back as ?authError=<reason>. Show the message once, then clean the address bar.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('authError');
    if (!reason) return;
    setPageError(AUTH_MESSAGES[reason] ?? 'Sign-in failed. Please try again.');
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  return (
    <AuthLayout>
      {pageError && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {pageError}
        </div>
      )}

      <h2 className="text-xl font-semibold text-slate-900">Sign in</h2>
      <p className="mt-1 text-sm text-slate-500">Use the username and password you registered with.</p>

      <SignInForm onSignedIn={onSignedIn} googleEnabled={options.googleEnabled} />

      <p className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
        {options.selfSignupEnabled
          ? <>New here? <Link to="/signup" className="font-medium text-indigo-600 hover:underline">Create an account</Link></>
          : 'Accounts are created by an administrator.'}
      </p>
    </AuthLayout>
  );
}
