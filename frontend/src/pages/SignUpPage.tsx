import type { AuthOptions, CurrentUser } from '../lib/api';
import { Link } from '../components/Link';
import { SignUpForm } from '../components/SignUpForm';
import { AuthLayout } from './AuthLayout';

interface Props {
  options: AuthOptions;
  onSignedIn: (user: CurrentUser) => void;
}

export function SignUpPage({ options, onSignedIn }: Props) {
  // The administrator can turn self sign-up off. The backend enforces this too, so this screen only explains it.
  if (!options.selfSignupEnabled) {
    return (
      <AuthLayout>
        <h2 className="text-xl font-semibold text-slate-900">Account creation is off</h2>
        <p className="mt-1 text-sm text-slate-500">
          Creating new accounts is turned off. Please ask your administrator to create one for you.
        </p>
        <p className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
          <Link to="/login" className="font-medium text-indigo-600 hover:underline">Back to sign in</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="text-xl font-semibold text-slate-900">Create your account</h2>
      <p className="mt-1 text-sm text-slate-500">Create an office account. You become its first administrator.</p>

      <SignUpForm onSignedIn={onSignedIn} googleEnabled={options.googleEnabled} />

      <p className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
        Already have an account? <Link to="/login" className="font-medium text-indigo-600 hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
