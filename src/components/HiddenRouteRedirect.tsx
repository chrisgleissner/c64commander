/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAppMode } from "@/lib/appMode/appModeStore";
import { redirectTargetFor } from "@/lib/navigation/hiddenRoutes";
import { addLog } from "@/lib/logging";

export const HiddenRouteRedirect = () => {
  const location = useLocation();
  const appMode = useAppMode();
  const target = redirectTargetFor(location.pathname, appMode);
  useEffect(() => {
    if (target !== null) addLog("info", "Hidden route redirected", { path: location.pathname, target });
  }, [location.pathname, target]);
  return target === null ? null : <Navigate to={target} replace />;
};
