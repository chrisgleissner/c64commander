/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useNavigate } from "react-router-dom";
import { useAppMode } from "@/lib/appMode/appModeStore";
import { isSurfaceVisible } from "@/lib/appMode/surfaces";

const ACTION_CLASS =
  "flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-normal hover:bg-muted";

type DiagnosticsConnectionActionsProps = {
  onCloseOverflow: () => void;
  onOpenConnectionDetails: () => void;
  onOpenChange: (open: boolean) => void;
};

export function DiagnosticsConnectionActions({
  onCloseOverflow,
  onOpenConnectionDetails,
  onOpenChange,
}: DiagnosticsConnectionActionsProps) {
  const navigate = useNavigate();
  const appMode = useAppMode();
  if (!isSurfaceVisible("quick-menu:switch-device", appMode)) return null;

  return (
    <>
      <button
        type="button"
        className={ACTION_CLASS}
        onClick={() => {
          onCloseOverflow();
          onOpenConnectionDetails();
        }}
        data-testid="diagnostics-connection-details-action"
      >
        Connection details
      </button>
      <button
        type="button"
        className={ACTION_CLASS}
        onClick={() => {
          onCloseOverflow();
          onOpenChange(false);
          navigate("/settings");
        }}
        data-testid="diagnostics-manage-devices-action"
      >
        Manage devices
      </button>
    </>
  );
}
