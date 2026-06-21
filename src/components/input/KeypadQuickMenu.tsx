/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TAB_ROUTES } from "@/lib/navigation/tabRoutes";
import { requestDeviceSwitcherOpen, subscribeQuickMenuOpen } from "@/lib/input/keypadCommands";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { useSavedDevices } from "@/hooks/useSavedDevices";

/**
 * The keypad Quick Menu — opened by the Menu key when the focused item has no
 * context menu (wired via {@link subscribeQuickMenuOpen}). It surfaces the same
 * always-reachable high-value actions the dedicated keys provide (jump to a page,
 * Diagnostics, Switch Device) in a discoverable list. Being a Radix dialog it
 * becomes the active focus scope, so it is keypad-navigable with no extra wiring:
 * Up/Down move between entries, OK activates, Back/Esc closes.
 */
export function KeypadQuickMenu() {
  const navigate = useNavigate();
  const savedDevices = useSavedDevices();
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeQuickMenuOpen(() => setOpen(true)), []);

  const run = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

  const canSwitchDevices = savedDevices.devices.length > 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xs" data-testid="keypad-quick-menu">
        <DialogHeader>
          <DialogTitle>Quick menu</DialogTitle>
          <DialogDescription>Jump to a page or open a high-value action.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          {TAB_ROUTES.map((route) => (
            <Button
              key={route.path}
              variant="ghost"
              className="justify-start"
              data-testid={`keypad-quick-menu-tab-${route.label.toLowerCase()}`}
              onClick={() => run(() => navigate(route.path))}
            >
              {route.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            className="justify-start"
            data-testid="keypad-quick-menu-diagnostics"
            onClick={() => run(() => requestDiagnosticsOpen("header"))}
          >
            Diagnostics
          </Button>
          {canSwitchDevices ? (
            <Button
              variant="ghost"
              className="justify-start"
              data-testid="keypad-quick-menu-switch-device"
              onClick={() => run(() => requestDeviceSwitcherOpen())}
            >
              Switch device
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
