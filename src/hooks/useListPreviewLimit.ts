/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
