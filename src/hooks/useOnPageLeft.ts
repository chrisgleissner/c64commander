/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { usePageActivity } from "@/hooks/usePageActivity";

const useOnPageActivityChange = (becameActive: boolean, run: () => void) => {
  const pageActive = usePageActivity();
  const runRef = useRef(run);
  runRef.current = run;
  const wasActiveRef = useRef(pageActive);

  useEffect(() => {
    const changed = pageActive !== wasActiveRef.current;
    wasActiveRef.current = pageActive;
    if (changed && pageActive === becameActive) runRef.current();
  }, [becameActive, pageActive]);
};

/** Run `onLeft` each time another tab replaces this page on screen, which is when the page used to be unmounted. */
export const useOnPageLeft = (onLeft: () => void) => useOnPageActivityChange(false, onLeft);

/** Run `onReturn` each time this page is shown again after another tab, which used to mount it afresh. */
export const useOnPageReturn = (onReturn: () => void) => useOnPageActivityChange(true, onReturn);
