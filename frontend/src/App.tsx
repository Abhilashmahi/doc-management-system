import { useCallback, useEffect, useState } from 'react';
import { Routes } from './app/Routes';
import { SessionProvider } from './app/session';
import { ToastProvider } from './components/kit';
import { api, type AuthOptions, type CurrentUser } from './lib/api';
import { navigate, usePathname } from './lib/router';
import { LoginPage } from './pages/LoginPage';
import { SignUpPage } from './pages/SignUpPage';

const NO_OPTIONS: AuthOptions = { selfSignupEnabled: false, googleEnabled: false };

// Signed-out visitors belong on /signup or /login. Signed-in users may open any app page, but not the sign-in pages.
function canonicalPath(pathname: string, signedIn: boolean): string {
  if (signedIn) return pathname === '/login' || pathname === '/signup' ? '/' : pathname;
  return pathname === '/signup' ? '/signup' : '/login';
}

export default function App() {
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [options, setOptions] = useState<AuthOptions>(NO_OPTIONS);
  const [checking, setChecking] = useState(true);
  // Where a signed-out visitor was heading, so they land there after signing in.
  const [returnTo] = useState(() => (['/login', '/signup'].includes(window.location.pathname) ? '/' : window.location.pathname + window.location.search));

  // On first load, ask the server whether the browser still has a valid session, and which sign-in options are on.
  useEffect(() => {
    Promise.all([
      api.me().then((result) => result.user).catch(() => null),
      api.authOptions().catch(() => NO_OPTIONS),
    ])
      .then(([currentUser, authOptions]) => {
        setUser(currentUser);
        setOptions(authOptions);
      })
      .finally(() => setChecking(false));
  }, []);

  const target = canonicalPath(pathname, user !== null);

  // Keep the address bar in step with the page on screen, for example / becomes /login for a signed-out visitor.
  // The search string is kept, so ?authError=... from a failed Google sign-in still reaches the login page.
  useEffect(() => {
    if (checking) return;
    if (window.location.pathname !== target) navigate(target + window.location.search, true);
  }, [checking, target]);

  const handleSignedIn = useCallback(
    (signedIn: CurrentUser) => {
      setUser(signedIn);
      navigate(returnTo, true);
    },
    [returnTo],
  );

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      navigate('/login', true);
    }
  }, []);

  if (checking) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading...</div>;
  }

  if (user) {
    return (
      <ToastProvider>
        <SessionProvider user={user} onLogout={handleLogout}>
          <Routes />
        </SessionProvider>
      </ToastProvider>
    );
  }

  if (target === '/signup') {
    return <SignUpPage options={options} onSignedIn={handleSignedIn} />;
  }

  return <LoginPage options={options} onSignedIn={handleSignedIn} />;
}
