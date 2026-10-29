import { useState } from 'react';
import { ActivityLine } from '../app/AppShell';
import { CreateHero } from './CreateHero';
import { useSession } from '../app/session';
import { Badge, Card, ErrorBanner, Icon, LoadingBlock, PageHeader, StatusBadge, useLoad } from '../components/kit';
import { Link } from '../components/Link';
import { http } from '../lib/api';
import { formatBytes, timeAgo } from '../lib/format';
import type { ActivityEntry } from '../lib/types';

interface DashboardData {
  totals: {
    documents: number;
    archivedDocuments: number;
    templates: number;
    publishedTemplates: number;
    categories: number;
    users: number;
    createdThisMonth: number;
    downloads30d: number;
    storageUsedBytes: number;
    storageLimitBytes: number;
  };
  byCategory: { name: string; total: number }[];
  monthly: { month: string; total: number }[];
  recentlyEdited: { id: number; name: string; status: string; sourceType: string; categoryName: string | null; updatedAt: string; updatedByName: string | null }[];
  recentlyOpened: { id: number; name: string; status: string; sourceType: string; categoryName: string | null; lastOpenedAt: string }[];
  recentActivity: ActivityEntry[];
}

// Every number on this page comes from SQL Server (GET /api/dashboard), limited to the current office.
export function DashboardPage() {
  const session = useSession();
  const { data, error, loading, reload } = useLoad(() => http.get<DashboardData>('/dashboard'), []);

  const officeName = session.isMaster
    ? (session.accounts.find((a) => a.id === session.accountId)?.name ?? 'All offices')
    : session.user.accountName;

  return (
    <>
      <CreateHero />

      <PageHeader
        title={`Welcome, ${session.user.fullName.split(' ')[0]}`}
        description={officeName ? `Your workspace: ${officeName}` : 'Your workspace'}
      />

      {loading && !data && <LoadingBlock />}
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Total documents" value={data.totals.documents} note={`${data.totals.archivedDocuments} archived`} to="/documents" />
            <StatTile label="Templates" value={data.totals.templates} note={`${data.totals.publishedTemplates} published`} to="/templates" />
            <StatTile label="Categories" value={data.totals.categories} note="active" to={session.canManage ? '/admin/categories' : undefined} />
            <StatTile label="Users" value={data.totals.users} note="active" to={session.canManage ? '/admin/users' : undefined} />
            <StatTile label="Created this month" value={data.totals.createdThisMonth} note="new documents" />
            <StatTile label="Recent downloads" value={data.totals.downloads30d} note="last 30 days" />
            <StorageTile used={data.totals.storageUsedBytes} limit={data.totals.storageLimitBytes} />
            <StatTile label="Recently edited" value={data.recentlyEdited.length} note="documents shown below" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Documents by category">
              <CategoryBars rows={data.byCategory} />
            </Card>
            <Card title="Documents created per month">
              <MonthlyColumns rows={data.monthly} />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Recently edited documents" className="lg:col-span-2" padded={false}>
              <DocumentList
                rows={data.recentlyEdited.map((d) => ({ ...d, when: d.updatedAt, by: d.updatedByName }))}
                empty="No documents yet. Create one from a template or upload a file."
              />
            </Card>
            <Card title="Recently opened" padded={false}>
              <DocumentList rows={data.recentlyOpened.map((d) => ({ ...d, when: d.lastOpenedAt, by: null }))} empty="Documents you open appear here." compact />
            </Card>
          </div>

          <Card title="Recent activity" padded={false} actions={session.canManage ? <Link to="/admin/activity" className="text-sm font-medium text-indigo-600 hover:underline">View all</Link> : undefined}>
            {data.recentActivity.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">No activity yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">What happened</th>
                      {session.isMaster && !session.accountId && <th className="px-4 py-2 font-medium">Office</th>}
                      <th className="px-4 py-2 text-right font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.recentActivity.map((a) => (
                      <tr key={a.id}>
                        <td className="px-4 py-2.5"><ActivityLine entry={a} /></td>
                        {session.isMaster && !session.accountId && <td className="px-4 py-2.5 text-slate-500">{a.accountName ?? '—'}</td>}
                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-500">{timeAgo(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function StatTile({ label, value, note, to }: { label: string; value: number; note?: string; to?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value.toLocaleString('en-IN')}</p>
      {note && <p className="mt-0.5 text-xs text-slate-400">{note}</p>}
    </>
  );
  const cls = 'block rounded-xl bg-surface p-4 shadow-sm ring-1 ring-slate-200';
  return to ? <Link to={to} className={`${cls} hover:ring-indigo-300`}>{body}</Link> : <div className={cls}>{body}</div>;
}

function StorageTile({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="rounded-xl bg-surface p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium text-slate-500">Storage used</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{formatBytes(used)}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Storage used">
        <div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-400">of {formatBytes(limit)}</p>
    </div>
  );
}

// Horizontal bars: one hue, sorted largest first, value written at the end of each bar.
function CategoryBars({ rows }: { rows: { name: string; total: number }[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-slate-500">No documents yet.</p>;
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <ul className="space-y-2.5" aria-label="Documents by category">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-sm" title={`${r.name}: ${r.total}`}>
          <span className="truncate text-slate-600">{r.name}</span>
          <span className="flex items-center gap-2">
            <span className="h-3.5 rounded-r bg-indigo-500" style={{ width: `${(r.total / max) * 85}%`, minWidth: 4 }} />
            <span className="tabular-nums text-xs text-slate-600">{r.total}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// Columns for the last 12 months, with a tooltip on hover or keyboard focus.
function MonthlyColumns({ rows }: { rows: { month: string; total: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => r.total), 1);
  const label = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
  const fullLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const gridSteps = [1, 0.5, 0];

  return (
    <div className="relative">
      <div className="relative h-44">
        {/* Recessive grid lines with the scale on the left */}
        {gridSteps.map((s) => (
          <div key={s} className="absolute left-0 right-0 flex items-center gap-2" style={{ bottom: `${s * 100}%` }}>
            <span className="w-6 text-right text-[10px] tabular-nums text-slate-400">{Math.round(max * s)}</span>
            <span className="h-px flex-1 bg-slate-100" />
          </div>
        ))}
        <div className="absolute bottom-0 left-8 right-0 top-0 flex items-end gap-[2px]">
          {rows.map((r, i) => (
            <button
              type="button"
              key={r.month}
              className="group relative flex h-full flex-1 items-end justify-center focus:outline-none"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${fullLabel(r.month)}: ${r.total} documents`}
            >
              <span
                className={`w-full max-w-7 rounded-t ${active === i ? 'bg-indigo-700' : 'bg-indigo-500'}`}
                style={{ height: `${(r.total / max) * 100}%`, minHeight: r.total > 0 ? 4 : 0 }}
              />
              {active === i && (
                <span className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white shadow">
                  {fullLabel(r.month)}: <strong>{r.total}</strong>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="ml-8 mt-1 flex gap-[2px]">
        {rows.map((r) => (
          <span key={r.month} className="flex-1 text-center text-[10px] text-slate-400">{label(r.month)}</span>
        ))}
      </div>
    </div>
  );
}

function DocumentList({
  rows,
  empty,
  compact = false,
}: {
  rows: { id: number; name: string; status: string; sourceType: string; categoryName: string | null; when: string; by: string | null }[];
  empty: string;
  compact?: boolean;
}) {
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((d) => (
        <li key={d.id}>
          <Link to={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <Icon name={d.sourceType === 'upload' ? 'upload' : 'documents'} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">{d.name}</span>
              <span className="block truncate text-xs text-slate-500">
                {d.categoryName ?? 'Uncategorised'} · {timeAgo(d.when)}
                {d.by && ` · ${d.by}`}
              </span>
            </span>
            {!compact && (d.sourceType === 'upload' ? <Badge tone="blue">Upload</Badge> : <StatusBadge status={d.status} />)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
