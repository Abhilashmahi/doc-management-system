import { useState } from 'react';
import { useSession } from '../app/session';
import { useLoad } from '../components/kit';
import { Link } from '../components/Link';
import { http } from '../lib/api';
import { GROUPS, TOOLS, type Tool, type ToolGroup } from './catalog';

export function ToolIcon({ tool, size = 'h-11 w-11' }: { tool: Tool; size?: string }) {
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-xl`} style={{ background: `${tool.color}14`, color: tool.color }}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={tool.icon} />
      </svg>
    </span>
  );
}

// The PDF tools home: a big headline, group filters and a grid of tool cards.
export function ToolsHome() {
  const session = useSession();
  const [group, setGroup] = useState<ToolGroup | 'All'>('All');
  const { data: caps } = useLoad(() => http.get<{ libreoffice: boolean }>('/tools/capabilities'), []);

  const visible = TOOLS.filter((t) => (!t.managersOnly || session.canManage) && (group === 'All' || t.group === group));

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <section className="bg-gradient-to-b from-surface to-slate-50 px-4 pb-6 pt-10 text-center sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">All your PDF tools in one place</h1>
        <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600 sm:text-lg">
          Merge, split, compress, convert, rotate, number and watermark PDFs. Your files stay on this server and are never sent to another website.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Tool groups">
          {(['All', ...GROUPS] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={group === g}
              onClick={() => setGroup(g)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${group === g ? 'bg-ink text-white' : 'bg-surface text-slate-700 ring-1 ring-slate-200 hover:ring-slate-400'}`}
            >
              {g === 'All' ? 'All' : g}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 px-4 pb-10 pt-2 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((tool) => {
          const unavailable = tool.needsLibreOffice && caps && !caps.libreoffice;
          return (
            <Link
              key={tool.id}
              to={`/tools/${tool.id}`}
              className="group flex flex-col rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300"
            >
              <ToolIcon tool={tool} />
              <h2 className="mt-4 text-lg font-semibold text-slate-900">{tool.title}</h2>
              <p className="mt-1 flex-1 text-sm text-slate-600">{tool.description}</p>
              {unavailable && <span className="mt-3 self-start rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Needs LibreOffice</span>}
            </Link>
          );
        })}
      </section>
    </div>
  );
}
