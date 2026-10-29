import type { MouseEvent, ReactNode } from 'react';
import { navigate } from '../lib/router';

interface Props {
  to: string;
  className?: string;
  children: ReactNode;
}

// A link that changes the page without reloading it. Ctrl/Cmd-click and middle-click still behave like normal links.
export function Link({ to, className, children }: Props) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  }

  return (
    <a href={to} onClick={handleClick} className={className}>
      {children}
    </a>
  );
}
