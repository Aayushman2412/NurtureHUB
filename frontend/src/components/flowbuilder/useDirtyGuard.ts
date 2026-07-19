import { useEffect } from 'react';

/**
 * Guards against losing unsaved work:
 *  - `beforeunload` prompt on tab close / reload,
 *  - a capture-phase click guard that confirms before any in-app link
 *    navigation (sidebar links, back links, ...) while dirty,
 *  - a `popstate` guard so browser Back/Forward (which React Router handles
 *    as an SPA transition — no beforeunload, no anchor click) also confirms.
 *
 * The app uses a plain <BrowserRouter>, so React Router's useBlocker is not
 * available — the capture-phase interception runs before the router's own
 * click handlers and cancels the navigation when the user declines.
 */
export function useDirtyGuard(
  dirty: boolean,
  message = 'You have unsaved changes. Leave without saving?',
) {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome requires returnValue to be set for the prompt to appear.
      e.returnValue = '';
    };

    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest ? (target.closest('a[href]') as HTMLAnchorElement | null) : null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('#') || anchor.target === '_blank') return;
      // External links trigger beforeunload anyway — avoid a double prompt.
      if (anchor.origin && anchor.origin !== window.location.origin) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Back/Forward guard: park a sentinel history entry on top of the current
    // one. Pressing Back pops the sentinel (same URL, no visual change) and
    // fires popstate — decline restores the sentinel, accept goes back for real.
    window.history.pushState(null, '', window.location.href);
    const onPopState = () => {
      if (window.confirm(message)) {
        window.history.back();
      } else {
        window.history.pushState(null, '', window.location.href);
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [dirty, message]);
}
