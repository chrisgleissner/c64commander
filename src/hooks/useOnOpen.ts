/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";

export const useOnOpen = (open: boolean, onOpen: () => void) => {
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const opened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (opened) onOpen();
  }, [open, onOpen]);
};
