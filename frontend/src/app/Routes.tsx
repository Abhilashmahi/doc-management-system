import type { ReactNode } from 'react';
import { EmptyState } from '../components/kit';
import { Link } from '../components/Link';
import { DesignerPage } from '../designer/DesignerPage';
import { matchPath, usePathname } from '../lib/router';
import { DashboardPage } from '../pages/DashboardPage';
import { ProfilePage } from '../pages/ProfilePage';
import { AccountsPage } from '../pages/admin/AccountsPage';
import { ActivityPage } from '../pages/admin/ActivityPage';
import { CategoriesPage } from '../pages/admin/CategoriesPage';
import { FieldsPage } from '../pages/admin/FieldsPage';
import { SettingsPage } from '../pages/admin/SettingsPage';
import { UsersPage } from '../pages/admin/UsersPage';
import { DocumentDetailPage } from '../pages/documents/DocumentDetailPage';
import { DocumentFormPage } from '../pages/documents/DocumentFormPage';
import { DocumentsPage } from '../pages/documents/DocumentsPage';
import { TemplatesPage } from '../pages/templates/TemplatesPage';
import { ToolPage } from '../tools/ToolPage';
import { ToolsHome } from '../tools/ToolsHome';
import { PaintPage } from '../paint/PaintPage';
import { PdfTextEditor } from '../pdfedit/PdfTextEditor';
import { WriterPage } from '../writer/WriterPage';
import { AppShell } from './AppShell';
import { useSession } from './session';

interface Route {
  path: string;
  render: (params: Record<string, string>) => ReactNode;
  fullScreen?: boolean; // the designer uses the whole window, without the sidebar
  allow?: 'manage' | 'master';
}

const ROUTES: Route[] = [
  { path: '/', render: () => <DashboardPage /> },
  { path: '/documents', render: () => <DocumentsPage /> },
  { path: '/documents/new', render: () => <DocumentFormPage /> },
  { path: '/documents/:id', render: (p) => <DocumentDetailPage id={Number(p.id)} /> },
  { path: '/documents/:id/edit', render: (p) => <DocumentFormPage documentId={Number(p.id)} /> },
  { path: '/documents/:id/edit-text', render: (p) => <PdfTextEditor documentId={Number(p.id)} />, fullScreen: true },
  { path: '/documents/:id/design', render: (p) => <DesignerPage mode="document" id={Number(p.id)} />, fullScreen: true },
  { path: '/templates', render: () => <TemplatesPage /> },
  { path: '/tools', render: () => <ToolsHome /> },
  { path: '/tools/:tool', render: (p) => <ToolPage toolId={p.tool} /> },
  { path: '/paint', render: () => <PaintPage />, fullScreen: true },
  { path: '/writer', render: () => <WriterPage />, fullScreen: true },
  { path: '/templates/:id/design', render: (p) => <DesignerPage mode="template" id={Number(p.id)} />, fullScreen: true, allow: 'manage' },
  { path: '/admin/categories', render: () => <CategoriesPage />, allow: 'manage' },
  { path: '/admin/fields', render: () => <FieldsPage />, allow: 'manage' },
  { path: '/admin/users', render: () => <UsersPage />, allow: 'manage' },
  { path: '/admin/activity', render: () => <ActivityPage />, allow: 'manage' },
  { path: '/admin/accounts', render: () => <AccountsPage />, allow: 'master' },
  { path: '/admin/settings', render: () => <SettingsPage />, allow: 'master' },
  { path: '/profile', render: () => <ProfilePage /> },
];

// Picks the page for the current address. Pages are keyed by the office, so switching office reloads their data.
// Hiding a page here is only for convenience; the server checks every permission again.
export function Routes() {
  const pathname = usePathname();
  const session = useSession();

  for (const route of ROUTES) {
    const params = matchPath(route.path, pathname);
    if (!params) continue;
    const allowed = !route.allow || (route.allow === 'manage' ? session.canManage : session.isMaster);
    const page = allowed ? (
      <div key={`${session.accountId ?? 'all'}:${pathname}`} className={route.fullScreen ? 'contents' : undefined}>
        {route.render(params)}
      </div>
    ) : (
      <EmptyState title="You do not have access to this page" text="Ask an administrator if you need it." action={<Link to="/" className="text-indigo-600 hover:underline">Go to the dashboard</Link>} />
    );
    return route.fullScreen && allowed ? page : <AppShell>{page}</AppShell>;
  }

  return (
    <AppShell>
      <EmptyState title="Page not found" text="The address may be mistyped, or the page has moved." action={<Link to="/" className="text-indigo-600 hover:underline">Go to the dashboard</Link>} />
    </AppShell>
  );
}
