/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useMemo, useRef, type KeyboardEvent } from "react";

import { useFocusItem } from "@/hooks/useFocusNavigation";
import { FIELD_FRAME_ATTR } from "@/lib/input/ringDom";

/**
 * A field row the keypad selects without focusing its input, on a page and in a dialog alike. OK
 * focuses the input; OK, Back or Escape in the input returns to the row.
 */
export const useFieldFrame = (id: string, order: number, group: string) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useFocusItem<HTMLDivElement>({
    id,
    order,
    group,
    onActivate: () => inputRef.current?.focus(),
  });
  const setFrameRef = useCallback(
    (element: HTMLDivElement | null) => {
      frameRef.current = element;
      focusRef(element);
    },
    [focusRef],
  );
  const blurToFrame = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.currentTarget.blur();
    frameRef.current?.focus();
  }, []);
  const frameProps = useMemo(
    () => ({ ref: setFrameRef, tabIndex: -1, [FIELD_FRAME_ATTR]: "" }) as const,
    [setFrameRef],
  );
  return { inputRef, setFrameRef, blurToFrame, frameProps };
};
