import type { ReactNode } from 'react';
import { ThemeToggle } from '../lib/theme';

interface Props {
  children: ReactNode;
}

// Shared frame for the sign-in and create-account pages: the app name at the top, a short intro, and a card for the form.
export function AuthLayout({ children }: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">eS</span>
          <span className="font-semibold text-slate-900">e-Sevai Document Manager</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 pb-12 sm:px-8 md:grid-cols-2">
        <section>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Manage, edit and export your documents in one place
          </h1>
          <p className="mt-4 text-slate-600">
            Create documents from templates, store files securely, and keep a full history of every change.
          </p>
        </section>

        <section className="w-full rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
          {children}
        </section>
      </main>
    </div>
  );
}
