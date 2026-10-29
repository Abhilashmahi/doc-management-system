import { useState } from 'react';
import { useSession } from '../app/session';
import { useLoad, useToast } from '../components/kit';
import { Link } from '../components/Link';
import { newId, type CanvasDocument } from '../designer/types';
import { errorMessage, http } from '../lib/api';
import { navigate } from '../lib/router';
import type { Template } from '../lib/types';
import { TemplateThumb } from './documents/DocumentFormPage';

interface Shortcut {
  label: string;
  // A design size (administrators start a new template of that size), or a link.
  size?: { width: number; height: number };
  to?: string;
  color: string;
  icon: string;
  managersOnly?: boolean;
  editorsOnly?: boolean;
}

const SHORTCUTS: Shortcut[] = [
  { label: 'Certificate', size: { width: 794, height: 1123 }, color: '#7d2ae8', icon: 'M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM8.2 13.9 7 23l5-3 5 3-1.2-9.1', managersOnly: true },
  { label: 'Landscape', size: { width: 1123, height: 794 }, color: '#00c4cc', icon: 'M2 6h20v12H2zM6 10h8M6 14h5', managersOnly: true },
  { label: 'ID card', size: { width: 324, height: 204 }, color: '#ff7b54', icon: 'M3 5h18v14H3zM7 9h4v4H7zM14 10h4M14 14h3', managersOnly: true },
  { label: 'Letter', size: { width: 816, height: 1056 }, color: '#2563eb', icon: 'M4 4h16v16H4zM4 4l8 7 8-7', managersOnly: true },
  { label: 'From a PDF', to: '/tools/pdf-to-template', color: '#4f46e5', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM12 18v-6M9 15l3 3 3-3', managersOnly: true },
  { label: 'New document', to: '/documents/new', color: '#16a34a', icon: 'M12 5v14M5 12h14', editorsOnly: true },
  { label: 'Upload', to: '/documents?upload=1', color: '#0891b2', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12', editorsOnly: true },
  { label: 'Writer', to: '/writer', color: '#1d4ed8', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6M8 13l1.5 5 1.5-4 1.5 4 1.5-5' },
  { label: 'Paint', to: '/paint', color: '#a349a4', icon: 'M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9 15l.2-3zM7 14c-2 0-3 1.5-3 3 0 1.3-.7 2-2 2 1 1.5 2.7 2 4 2 2.2 0 4-1.8 4-4' },
  { label: 'PDF tools', to: '/tools', color: '#e5322d', icon: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' },
];

// The top of the home page, in the style of Canva: a colourful banner with a search box, round quick-start
// buttons, and a strip of ready-made templates.
export function CreateHero() {
  const session = useSession();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = useLoad(() => http.get<{ templates: Template[] }>('/templates', { status: 'Published' }), []);

  const office = Boolean(session.accountId);
  const shortcuts = SHORTCUTS.filter((s) => (!s.managersOnly || (session.canManage && office)) && (!s.editorsOnly || (session.canEdit && office)));

  async function startDesign(s: Shortcut) {
    if (!s.size) return;
    setBusy(s.label);
    try {
      const canvas: CanvasDocument = { schemaVersion: 1, pages: [{ id: newId('page'), ...s.size, background: '#ffffff', elements: [] }] };
      const created = await http.post<{ id: number }>('/templates', { name: `Untitled ${s.label.toLowerCase()}`, categoryId: null, description: '', canvas });
      navigate(`/templates/${created.id}/design`);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(null);
    }
  }

  return (
    <div className="mb-8">
      <section className="relative overflow-hidden rounded-3xl px-6 py-10 text-center text-white shadow-sm sm:py-14" style={{ background: 'linear-gradient(120deg, #00c4cc 0%, #6a5cff 55%, #7d2ae8 100%)' }}>
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">What will you create today?</h1>
        <form
          role="search"
          className="mx-auto mt-6 flex max-w-xl items-center rounded-full bg-surface p-1.5 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/documents?q=${encodeURIComponent(query.trim())}`);
          }}
        >
          <svg viewBox="0 0 24 24" className="ml-3 h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your documents" placeholder="Search your documents" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none" />
          <button type="submit" className="rounded-full bg-[#7d2ae8] px-5 py-2 text-sm font-semibold text-white hover:bg-[#6a1fd0]">Search</button>
        </form>
      </section>

      <div className="mt-6 flex justify-start gap-4 overflow-x-auto pb-2 sm:justify-center sm:gap-6">
        {shortcuts.map((s) => {
          const circle = (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-md transition group-hover:scale-105" style={{ background: s.color }}>
                {busy === s.label ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={s.icon} /></svg>
                )}
              </span>
              <span className="text-xs font-medium text-slate-700">{s.label}</span>
            </>
          );
          return s.to ? (
            <Link key={s.label} to={s.to} className="group flex w-20 shrink-0 flex-col items-center gap-2">{circle}</Link>
          ) : (
            <button key={s.label} type="button" disabled={busy !== null} onClick={() => startDesign(s)} className="group flex w-20 shrink-0 flex-col items-center gap-2" title={`Design a new ${s.label.toLowerCase()} template`}>
              {circle}
            </button>
          );
        })}
      </div>

      {data && data.templates.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Start from a template</h2>
            <Link to="/templates" className="text-sm font-medium text-indigo-600 hover:underline">See all</Link>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {data.templates.slice(0, 10).map((t) => (
              <Link key={t.id} to={session.canEdit && office ? `/documents/new?templateId=${t.id}` : '/templates'} className="group w-44 shrink-0">
                <div className="overflow-hidden rounded-xl ring-1 ring-slate-200 transition group-hover:shadow-md group-hover:ring-2 group-hover:ring-[#7d2ae8]">
                  <TemplateThumb templateId={t.id} />
                </div>
                <p className="mt-2 truncate text-sm font-medium text-slate-800">{t.name}</p>
                <p className="truncate text-xs text-slate-500">{t.categoryName ?? 'No category'}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
