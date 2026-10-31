/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RomDependencyPrompt } from "@/pages/playFiles/components/RomDependencyDialog";
import type { RomDependencyQuestion } from "@/pages/playFiles/resolveLocalRoute";
import type { PlaylistItem } from "@/pages/playFiles/types";
import type { RomListedDialogChoice } from "@/pages/playFiles/romDependencyGate";

/**
 * The question "play it here anyway?", as a promise the play path can await.
 *
 * Leaving the page while it is open answers Cancel, so the play path is never left waiting.
 */
export const useRomDependencyPrompt = () => {
  const [pending, setPending] = useState<RomDependencyPrompt | null>(null);
  const resolveRef = useRef<((choice: RomListedDialogChoice) => void) | null>(null);

  const ask = useCallback(
    (item: PlaylistItem, question: RomDependencyQuestion) =>
      new Promise<RomListedDialogChoice>((resolve) => {
        resolveRef.current?.("cancel");
        resolveRef.current = resolve;
        setPending({ label: item.label, canPlayAnyway: question.canPlayAnyway });
      }),
    [],
  );

  const choose = useCallback((choice: RomListedDialogChoice) => {
    resolveRef.current?.(choice);
    resolveRef.current = null;
    setPending(null);
  }, []);

  useEffect(
    () => () => {
      resolveRef.current?.("cancel");
      resolveRef.current = null;
    },
    [],
  );

  return { pending, ask, choose };
};
