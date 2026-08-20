/* Shim for `next/navigation` in the standalone browser build: hash routing
   over the same URL shapes the Next.js router uses. */
import { useSyncExternalStore, useCallback } from 'react';

const subscribe = (cb: () => void): (() => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

const currentPath = (): string => {
  const h = window.location.hash.replace(/^#/, '');
  return h || '/';
};

export function usePathname(): string {
  return useSyncExternalStore(subscribe, currentPath, () => '/');
}

export function useRouter(): { push: (href: string) => void; replace: (href: string) => void } {
  const push = useCallback((href: string) => {
    window.location.hash = href;
  }, []);
  return { push, replace: push };
}
