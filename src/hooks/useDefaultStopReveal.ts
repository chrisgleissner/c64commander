/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef } from "react";
import { focusRingElement, revealRingElementAfterLayout } from "@/lib/input/ringDom";

/** Keep a restored page's default stop visible while its content finishes settling. */
export const useDefaultStopReveal = () => {
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRef.current?.(), []);
  return useCallback((element: HTMLElement) => {
    focusRingElement(element);
    cancelRef.current?.();
    cancelRef.current = revealRingElementAfterLayout(element);
  }, []);
};
