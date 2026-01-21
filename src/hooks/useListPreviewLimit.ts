import { useCallback, useEffect, useState } from 'react';
import { clampListPreviewLimit, getListPreviewLimit, setListPreviewLimit } from '@/lib/uiPreferences';

export const useListPreviewLimit = () => {
  const [limit, setLimitState] = useState(() => getListPreviewLimit());

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ listPreviewLimit?: number }>).detail;
      if (detail?.listPreviewLimit !== undefined) {
        setLimitState(clampListPreviewLimit(detail.listPreviewLimit));
      } else {
        setLimitState(getListPreviewLimit());
      }
    };
    window.addEventListener('c64u-ui-preferences-changed', handler as EventListener);
    return () => window.removeEventListener('c64u-ui-preferences-changed', handler as EventListener);
  }, []);

  const setLimit = useCallback((value: number) => {
    const clamped = clampListPreviewLimit(value);
    setLimitState(clamped);
    setListPreviewLimit(clamped);
  }, []);

  return { limit, setLimit };
};
