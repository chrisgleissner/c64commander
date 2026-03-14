/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { registerNavigationGuard } from "@/lib/navigation/navigationGuards";

export function useImportNavigationGuards(isImportNavigationBlocked: boolean) {
  useEffect(() => {
    if (!isImportNavigationBlocked) return;
    return registerNavigationGuard(() =>
      window.confirm("Importing items will stop if you leave this page. Leave anyway?"),
    );
  }, [isImportNavigationBlocked]);

  useEffect(() => {
    if (!isImportNavigationBlocked) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isImportNavigationBlocked]);
}
