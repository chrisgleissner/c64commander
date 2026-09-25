/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { resolveInputProfile } from "@/lib/input/profiles";
import { setInputModality } from "@/lib/input/inputModality";
import { composeT9Key } from "@/lib/input/t9FieldComposer";
import { isDefaultT9InputEnabled } from "@/lib/input/t9Defaults";

/** Bubble phase on the document, so a field that composes for itself has already had the key. */
export const T9FieldListener = () => {
  const { flags } = useFeatureFlags();
  const enabled = flags.keypad_input_enabled && isDefaultT9InputEnabled();
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!composeT9Key(event, resolveInputProfile("keypad"), performance.now())) return;
      event.preventDefault();
      setInputModality("key-navigation");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
  return null;
};
