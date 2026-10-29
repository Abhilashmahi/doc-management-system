import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { http, setScopeAccountId, type CurrentUser } from '../lib/api';
import type { Account, AppSettings } from '../lib/types';

// Everything the signed-in screens need to know about who is using the app and which office they are working on.
export interface Session {
  user: CurrentUser;
  settings: AppSettings | null;
  isMaster: boolean;
  canManage: boolean; // Admin or Master Admin
  canEdit: boolean; // Editor or above
  // The office being worked on. For normal users this is always their own office.
  accountId: number | null;
  accounts: Account[]; // only filled for the Master Admin
  setAccountId: (id: number | null) => void;
  reloadAccounts: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  onLogout: () => void;
}

const SessionContext = createContext<Session | null>(null);

const STORAGE_KEY = 'esevai.masterAccountId';

function readStoredAccountId(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? Number(raw) || null : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ user, onLogout, children }: { user: CurrentUser; onLogout: () => void; children: ReactNode }) {
  const isMaster = user.role === 'MasterAdmin';
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountIdState] = useState<number | null>(isMaster ? readStoredAccountId() : user.accountId);
  // Pages wait for the settings (upload rules, app name) and, for the Master Admin, the office list.
  const [ready, setReady] = useState(false);

  // Set the header before any page loads data, so the very first request already targets the right office.
  if (isMaster) setScopeAccountId(accountId);
  else setScopeAccountId(null);

  const reloadSettings = useCallback(async () => {
    const result = await http.get<{ settings: AppSettings }>('/settings');
    setSettings(result.settings);
  }, []);

  const reloadAccounts = useCallback(async () => {
    if (!isMaster) return;
    const result = await http.get<{ accounts: Account[] }>('/accounts');
    setAccounts(result.accounts);
    // Forget a stored office that no longer exists.
    setAccountIdState((current) => (current && !result.accounts.some((a) => a.id === current) ? null : current));
  }, [isMaster]);

  useEffect(() => {
    // A failure here is not fatal: pages then fall back to safe defaults and the server still checks everything.
    Promise.all([reloadSettings().catch(() => undefined), reloadAccounts().catch(() => undefined)]).finally(() => setReady(true));
  }, [reloadAccounts, reloadSettings]);

  const setAccountId = useCallback((id: number | null) => {
    setScopeAccountId(id);
    setAccountIdState(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, String(id));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private windows may block storage; the choice then lasts only for this visit.
    }
  }, []);

  // Apply the brand colour from Settings to the whole app.
  useEffect(() => {
    if (settings?.brandColor) document.documentElement.style.setProperty('--color-brand', settings.brandColor);
    if (settings?.appName) document.title = settings.appName;
  }, [settings]);

  const value = useMemo<Session>(
    () => ({
      user,
      settings,
      isMaster,
      canManage: isMaster || user.role === 'Admin',
      canEdit: isMaster || user.role === 'Admin' || user.role === 'Editor',
      accountId,
      accounts,
      setAccountId,
      reloadAccounts,
      reloadSettings,
      onLogout,
    }),
    [user, settings, isMaster, accountId, accounts, setAccountId, reloadAccounts, reloadSettings, onLogout],
  );

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading...</div>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
