/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaylistItem } from "@/pages/playFiles/types";
import type { RomListedDialogChoice } from "@/pages/playFiles/romDependencyGate";

/**
 * The question "play it here anyway?", as a promise the play path can await.
 *
 * Leaving the page while it is open answers Cancel, so the play path is never left waiting.
 */
export const useRomDependencyPrompt = () => {
  const [label, setLabel] = useState<string | null>(null);
  const resolveRef = useRef<((choice: RomListedDialogChoice) => void) | null>(null);

  const ask = useCallback(
    (item: PlaylistItem) =>
      new Promise<RomListedDialogChoice>((resolve) => {
        resolveRef.current?.("cancel");
        resolveRef.current = resolve;
        setLabel(item.label);
      }),
    [],
  );

  const choose = useCallback((choice: RomListedDialogChoice) => {
    resolveRef.current?.(choice);
    resolveRef.current = null;
    setLabel(null);
  }, []);

  useEffect(
    () => () => {
      resolveRef.current?.("cancel");
      resolveRef.current = null;
    },
    [],
  );

  return { label, ask, choose };
};
