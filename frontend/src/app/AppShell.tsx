import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from '../components/Link';
import { Icon } from '../components/kit';
import { http } from '../lib/api';
import { ThemeToggle } from '../lib/theme';
import { actionText, roleLabel, timeAgo } from '../lib/format';
import { navigate, usePathname } from '../lib/router';
import type { ActivityEntry } from '../lib/types';
import { useSession } from './session';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  show: boolean;
}

// The frame around every signed-in page: sidebar on the left, top bar with search, office switcher,
// notifications and the profile menu.
export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu after moving to another page.
  useEffect(() => setMenuOpen(false), [pathname]);

  const main: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: 'dashboard', show: true },
    { to: '/documents', label: 'Documents', icon: 'documents', show: true },
    { to: '/templates', label: 'Templates', icon: 'templates', show: true },
    { to: '/tools', label: 'PDF Tools', icon: 'tools', show: true },
    { to: '/writer', label: 'Writer', icon: 'writer', show: true },
    { to: '/paint', label: 'Paint', icon: 'paint', show: true },
  ];
  const admin: NavItem[] = [
    { to: '/admin/categories', label: 'Categories', icon: 'categories', show: session.canManage },
    { to: '/admin/fields', label: 'Field Master', icon: 'fields', show: session.canManage },
    { to: '/admin/users', label: 'Users', icon: 'users', show: session.canManage },
    { to: '/admin/accounts', label: 'Offices', icon: 'accounts', show: session.isMaster },
    { to: '/admin/activity', label: 'Activity Log', icon: 'activity', show: session.canManage },
    { to: '/admin/settings', label: 'Settings', icon: 'settings', show: session.isMaster },
  ];

  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));
  const appName = session.settings?.appName ?? 'e-Sevai Document Manager';

  const nav = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4 text-sm" aria-label="Main">
      <ul className="space-y-0.5">
        {main.map((item) => (
          <NavLink key={item.to} item={item} active={isActive(item.to)} />
        ))}
      </ul>
      {admin.some((i) => i.show) && (
        <div>
          <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Administration</p>
          <ul className="space-y-0.5">
            {admin.filter((i) => i.show).map((item) => (
              <NavLink key={item.to} item={item} active={isActive(item.to)} />
            ))}
          </ul>
        </div>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-surface lg:flex">
        <Brand name={appName} />
        {nav}
      </aside>

      {/* Mobile sidebar */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col bg-surface shadow-xl">
            <Brand name={appName} />
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMenuOpen(true)} />
        {session.isMaster && !session.accountId && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 sm:px-6">
            You are viewing <strong>all offices</strong> (read only). Choose an office in the top bar to create or change its documents, templates and settings.
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <Link to="/" className="flex items-center gap-2 border-b border-slate-100 px-4 py-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: 'var(--color-brand)' }}>
        eS
      </span>
      <span className="truncate text-sm font-semibold text-slate-900">{name}</span>
    </Link>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li>
      <Link
        to={item.to}
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 ${active ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
      >
        <Icon name={item.icon} />
        {item.label}
      </Link>
    </li>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const session = useSession();
  const [query, setQuery] = useState('');

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-6">
      <button type="button" onClick={onMenu} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <Icon name="menu" className="h-5 w-5" />
      </button>

      <form
        role="search"
        className="relative hidden max-w-sm flex-1 sm:block"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/documents?q=${encodeURIComponent(query.trim())}`);
        }}
      >
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents..."
          aria-label="Search documents"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-sm focus:border-indigo-400 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
      </form>

      <div className="ml-auto flex items-center gap-2">
        {session.isMaster && <OfficeSwitcher />}
        {session.canEdit && session.accountId && (
          <Link to="/documents/new" className="hidden items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 md:inline-flex">
            <Icon name="plus" /> New document
          </Link>
        )}
        <ThemeToggle />
        <Notifications />
        <ProfileMenu />
      </div>
    </header>
  );
}

function OfficeSwitcher() {
  const session = useSession();
  return (
    <select
      aria-label="Office"
      value={session.accountId ?? ''}
      onChange={(e) => session.setAccountId(e.target.value ? Number(e.target.value) : null)}
      className="max-w-[12rem] rounded-lg border border-slate-300 bg-surface py-1.5 pl-2 pr-7 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
    >
      <option value="">All offices</option>
      {session.accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.isActive ? '' : ' (inactive)'}
        </option>
      ))}
    </select>
  );
}

// Opens a small panel and closes it when the user clicks elsewhere or presses Escape.
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const SEEN_KEY = 'esevai.lastSeenActivity';

function Notifications() {
  const session = useSession();
  const { open, setOpen, ref } = useDropdown();
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [lastSeen, setLastSeen] = useState<string>(() => {
    try {
      return window.localStorage.getItem(SEEN_KEY) ?? '';
    } catch {
      return '';
    }
  });

  // Refresh when the office changes and every two minutes while the app is open.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      http
        .get<{ activity: ActivityEntry[] }>('/activity/recent')
        .then((r) => !cancelled && setItems(r.activity))
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session.accountId]);

  const unread = items.filter((i) => i.createdAt > lastSeen && i.username !== session.user.username).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items[0]) {
      setLastSeen(items[0].createdAt);
      try {
        window.localStorage.setItem(SEEN_KEY, items[0].createdAt);
      } catch {
        // ignore: the badge simply reappears next visit
      }
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggle} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} aria-expanded={open}>
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl bg-surface shadow-lg ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">Recent activity</div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing yet.</li>}
            {items.map((item) => (
              <li key={item.id} className="px-4 py-2.5 text-sm">
                <ActivityLine entry={item} />
                <div className="mt-0.5 text-xs text-slate-400">{timeAgo(item.createdAt)}</div>
              </li>
            ))}
          </ul>
          {session.canManage && (
            <Link to="/admin/activity" className="block border-t border-slate-100 px-4 py-2 text-center text-sm font-medium text-indigo-600 hover:bg-slate-50">
              View full activity log
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// "Priya created Birth cert - Ravi" — links to the document when there is one.
export function ActivityLine({ entry }: { entry: ActivityEntry }) {
  const who = entry.userName ?? 'Someone';
  const isDocument = entry.entityType === 'Document' && entry.entityId;
  return (
    <span className="text-slate-700">
      <span className="font-medium text-slate-900">{who}</span> {actionText(entry.action)}
      {isDocument && (
        <>
          {' '}
          {entry.documentName ? (
            <Link to={`/documents/${entry.entityId}`} className="font-medium text-indigo-600 hover:underline">
              {entry.documentName}
            </Link>
          ) : (
            <span>document #{entry.entityId}</span>
          )}
        </>
      )}
    </span>
  );
}

function ProfileMenu() {
  const session = useSession();
  const { open, setOpen, ref } = useDropdown();
  const initials = session.user.fullName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100" aria-expanded={open} aria-label="Profile menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{initials}</span>
        <span className="hidden text-left text-sm leading-tight md:block">
          <span className="block font-medium text-slate-900">{session.user.fullName}</span>
          <span className="block text-xs text-slate-500">{roleLabel(session.user.role)}</span>
        </span>
        <Icon name="chevronDown" className="hidden h-4 w-4 text-slate-400 md:block" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl bg-surface py-1 shadow-lg ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Signed in as {session.user.username}</div>
          <Link to="/profile" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <Icon name="user" /> My profile
          </Link>
          <button type="button" onClick={session.onLogout} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
            <Icon name="logout" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
