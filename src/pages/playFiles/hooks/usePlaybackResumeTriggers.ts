import { useEffect } from 'react';

/**
 * Triggers a callback when the app likely resumed after being backgrounded/locked.
 *
 * This intentionally wires multiple signals because Android/WebView behavior can vary
 * across versions and OEM power management.
 */
export const usePlaybackResumeTriggers = (onResume: () => void) => {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const onVisible = () => {
      if (document.hidden) return;
      onResume();
    };
    const onFocus = () => {
      onResume();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [onResume]);
};
