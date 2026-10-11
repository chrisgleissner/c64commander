/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { usePageActivity } from "@/hooks/usePageActivity";

/**
 * Reports whether the page holding it is the page on screen, on mount and on every change, without re-rendering the
 * component that renders it.
 *
 * A visited page stays mounted while another page is shown, so leaving it turns this false where it used to unmount
 * the page. Sending the app to the background leaves the answer unchanged, because that never unmounted a page.
 */
export function ScreenActivityWatch({ onChange }: { onChange: (onScreen: boolean) => void }) {
  const onScreen = usePageActivity();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(onScreen);
  }, [onScreen]);
  return null;
}
