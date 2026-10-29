import { useEffect, useState } from 'react';

// Light / dark appearance. The choice is remembered in this browser; "system" follows the computer's setting.
// index.html applies the saved choice before the page draws, so there is no white flash on a dark screen.

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'esevai-theme';
const listeners = new Set<(choice: ThemeChoice) => void>();
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

let current: ThemeChoice = readChoice();

function apply(): void {
  const dark = current === 'dark' || (current === 'system' && systemDark.matches);
  document.documentElement.classList.toggle('dark', dark);
}

systemDark.addEventListener('change', apply);
apply();

export function setTheme(choice: ThemeChoice): void {
  current = choice;
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* private window: the choice lasts until the page is closed */
  }
  apply();
  listeners.forEach((l) => l(choice));
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState(current);
  useEffect(() => {
    listeners.add(setChoice);
    return () => void listeners.delete(setChoice);
  }, []);
  return [choice, setTheme];
}

const NEXT: Record<ThemeChoice, ThemeChoice> = { light: 'dark', dark: 'system', system: 'light' };
const LABEL: Record<ThemeChoice, string> = { light: 'Light mode', dark: 'Dark mode', system: 'Same as computer' };

// A round button that cycles Light → Dark → Same as computer. The icon shows the current choice.
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [choice, set] = useTheme();
  return (
    <button
      type="button"
      onClick={() => set(NEXT[choice])}
      title={`${LABEL[choice]} (click for ${LABEL[NEXT[choice]].toLowerCase()})`}
      aria-label={`Appearance: ${LABEL[choice]}. Switch to ${LABEL[NEXT[choice]]}`}
      className={`rounded-full p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {choice === 'light' && (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
        {choice === 'dark' && <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
        {choice === 'system' && (
          <>
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </>
        )}
      </svg>
    </button>
  );
}

// Three buttons for the profile page.
export function ThemePicker() {
  const [choice, set] = useTheme();
  return (
    <div role="radiogroup" aria-label="Appearance" className="inline-flex rounded-lg bg-slate-100 p-1">
      {(['light', 'dark', 'system'] as const).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={choice === c}
          onClick={() => set(c)}
          className={`rounded-md px-3 py-1.5 text-sm ${choice === c ? 'bg-surface font-medium text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          {c === 'light' ? 'Light' : c === 'dark' ? 'Dark' : 'Same as computer'}
        </button>
      ))}
    </div>
  );
}
