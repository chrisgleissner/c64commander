/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { usePageActivity } from "@/hooks/usePageActivity";
import { remoteInputRequestBus } from "@/lib/input/latchedCommandBus";

/**
 * Answer "Open Remote Input" from search. Home and Play each own a sheet, and a visited page stays mounted
 * behind the one on screen, so only the page on screen claims the request: a hidden page that claimed it
 * would open a sheet nobody can see. A request raised on another page latches until a host page is shown.
 */
export const useRemoteInputOpenRequest = (openSheet: () => void) => {
  const pageActive = usePageActivity();
  const openSheetRef = useRef(openSheet);
  openSheetRef.current = openSheet;

  useEffect(() => {
    if (!pageActive) return;
    if (remoteInputRequestBus.takePending() !== null) openSheetRef.current();
    return remoteInputRequestBus.subscribe(() => {
      remoteInputRequestBus.takePending();
      openSheetRef.current();
    });
  }, [pageActive]);
};
