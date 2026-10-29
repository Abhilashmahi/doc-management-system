import { useEffect, useState } from 'react';
import { ActivityLine } from '../../app/AppShell';
import { useSession } from '../../app/session';
import { Button, Card, EmptyState, ErrorBanner, FilterInput, FilterSelect, LoadingBlock, PageHeader, Pagination, useLoad } from '../../components/kit';
import { http } from '../../lib/api';
import { formatDateTime, timeAgo } from '../../lib/format';
import { useSearchParams } from '../../lib/router';
import type { ActivityEntry, UserRow } from '../../lib/types';

const PAGE_SIZE = 50;

interface ActivityPageResult {
  total: number;
  page: number;
  pageSize: number;
  activity: ActivityEntry[];
}

// The audit log stores extra facts as a JSON string, e.g. {"name":"Birth","isActive":true}.
// Turn it into "name: Birth" chips. Bad or unexpected JSON is shown as plain text instead of crashing.
function detailChips(details: string | null): string[] {
  if (!details) return [];
  try {
    const parsed: unknown = JSON.parse(details);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
    return [String(details)];
  } catch {
    return [details];
  }
}

// Full audit log: who did what, and when. Filter by person, action and date.
export function ActivityPage() {
  const session = useSession();
  const params = useSearchParams();
  const urlUserId = params.get('userId') ?? '';

  const [userId, setUserId] = useState(urlUserId);
  const [actionDraft, setActionDraft] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  // Follow the address bar, e.g. when arriving from "View activity" on the Users page.
  useEffect(() => {
    setUserId(urlUserId);
    setPage(1);
  }, [urlUserId]);

  // Wait until the user stops typing before searching by action.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAction(actionDraft.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [actionDraft]);

  const users = useLoad(() => http.get<{ users: UserRow[] }>('/users'), [session.accountId]);
  const { data, error, loading, reload } = useLoad(
    () => http.get<ActivityPageResult>('/activity', { userId, action, from, to, page, pageSize: PAGE_SIZE }),
    [session.accountId, userId, action, from, to, page],
  );

  // Every filter change starts again from page 1.
  function filter(setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      setPage(1);
    };
  }

  const hasFilters = Boolean(userId || action || from || to);
  const activity = data?.activity ?? [];
  const dateInput =
    'rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

  return (
    <div>
      <PageHeader title="Activity log" description="Everything that happened: sign-ins, changes to documents, templates, users and settings." />

      <div className="mb-4 flex flex-col flex-wrap gap-2 sm:flex-row sm:items-center">
        <FilterSelect
          label="All users"
          value={userId}
          onChange={filter(setUserId)}
          options={(users.data?.users ?? []).map((u) => ({ value: u.id, label: `${u.fullName} (${u.username})` }))}
        />
        <FilterInput label="Action, e.g. DOCUMENT or LOGIN" value={actionDraft} onChange={setActionDraft} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => filter(setFrom)(e.target.value)} className={dateInput} />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => filter(setTo)(e.target.value)} className={dateInput} />
        </label>
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setUserId('');
              setActionDraft('');
              setAction('');
              setFrom('');
              setTo('');
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBanner message={error} onRetry={reload} />
      ) : activity.length === 0 ? (
        <EmptyState title="No activity found" text={hasFilters ? 'Try changing the filters.' : 'Actions will appear here as people use the app.'} />
      ) : (
        <Card padded={false}>
          <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">What happened</th>
                  {session.isMaster && <th className="px-4 py-3 font-medium">Office</th>}
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="px-4 py-3 font-medium">IP address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activity.map((entry) => (
                  <tr key={entry.id} className="align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="text-slate-900">{formatDateTime(entry.createdAt)}</div>
                      <div className="text-xs text-slate-500">{timeAgo(entry.createdAt)}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{entry.username ?? <span className="text-slate-400">—</span>}</td>
                    <td className="min-w-[14rem] px-4 py-3">
                      <ActivityLine entry={entry} />
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400">{entry.action}</div>
                    </td>
                    {session.isMaster && <td className="px-4 py-3 text-slate-600">{entry.accountName ?? <span className="text-slate-400">—</span>}</td>}
                    <td className="px-4 py-3">
                      <div className="flex max-w-sm flex-wrap gap-1">
                        {detailChips(entry.details).map((chip, i) => (
                          <span key={i} className="max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700" title={chip}>
                            {chip}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{entry.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data?.page ?? page} pageSize={data?.pageSize ?? PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
