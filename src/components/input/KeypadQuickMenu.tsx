/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TAB_ROUTES } from "@/lib/navigation/tabRoutes";
import { requestDeviceSwitcherOpen, subscribeQuickMenuOpen, type QuickMenuSource } from "@/lib/input/keypadCommands";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { startGameMode } from "@/lib/remoteInput/gameModeLaunch";
import { useFeatureFlagValue } from "@/hooks/useFeatureFlags";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import {
  loadShowSectionDescriptions,
  requestSectionsBulk,
  saveShowSectionDescriptions,
  subscribeShowSectionDescriptions,
} from "@/lib/ui/collapsibleSectionStore";

/**
 * The keypad Quick Menu — opened by the Menu key when the focused item has no
 * context menu (wired via {@link subscribeQuickMenuOpen}). It surfaces the same
 * always-reachable high-value actions the dedicated keys provide (jump to a page,
 * Diagnostics, Switch Device) in a discoverable list. Being a Radix dialog it
 * becomes the active focus scope, so it is keypad-navigable with no extra wiring:
 * Up/Down move between entries, OK activates, Back/Esc closes.
 */
/** The physical key that reaches this entry directly, drawn as the keycap it is. */
const ShortcutKey = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex min-w-6 shrink-0 items-center justify-center rounded border border-border bg-muted px-1 py-0.5 font-sans text-xs font-semibold text-muted-foreground">
    {children}
  </kbd>
);

export function KeypadQuickMenu() {
  const navigate = useNavigate();
  const savedDevices = useSavedDevices();
  const remoteInputEnabled = useFeatureFlagValue("remote_input_enabled");
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<QuickMenuSource>("keypad");
  // Only a keypad user needs the page jumps and the key names. Someone who tapped the app bar has
  // the tab bar in front of them, and a key legend names keys their device may not have.
  const fromKeypad = source === "keypad";

  useEffect(
    () =>
      subscribeQuickMenuOpen((nextSource) => {
        setSource(nextSource ?? "keypad");
        setOpen(true);
      }),
    [],
  );

  const run = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

  const canSwitchDevices = savedDevices.devices.length > 1;

  /*
   * The section entries only appear on a page that has sections, and the wording is the action the
   * press performs. "Expand all" shows while anything is still closed, so the entry is the one a
   * reader who wants to scroll the whole page reaches for; once everything is open it becomes
   * "Collapse all", which is the way back to reading the page as an index.
   */
  const [sectionCounts, setSectionCounts] = useState({ total: 0, closed: 0 });
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const cards = document.querySelectorAll("[data-section-label][data-open]");
    let closed = 0;
    for (const card of cards) if (card.getAttribute("data-open") === "false") closed += 1;
    setSectionCounts({ total: cards.length, closed });
  }, [open]);

  const showDescriptions = useSyncExternalStore(
    subscribeShowSectionDescriptions,
    loadShowSectionDescriptions,
    () => false,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/*
        Bounded and scrollable. The menu now carries the page entries, the section actions and the
        high-value actions; at twelve entries it is taller than the 427px of the smallest supported
        screen, and an unbounded dialog simply ran off the bottom with no way to reach the last
        item. The header stays put and the list is what scrolls.
      */}
      <DialogContent className="flex max-h-[85dvh] max-w-xs flex-col overflow-hidden" data-testid="keypad-quick-menu">
        <DialogHeader>
          <DialogTitle>Quick menu</DialogTitle>
          <DialogDescription>
            {fromKeypad ? "Jump to a page or open a high-value action." : "Actions for this page."}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 grid min-h-0 flex-1 gap-1.5 overflow-y-auto px-1">
          {fromKeypad
            ? TAB_ROUTES.map((route, index) => (
                <Button
                  key={route.path}
                  variant="ghost"
                  className="justify-start gap-3"
                  data-testid={`keypad-quick-menu-tab-${route.label.toLowerCase()}`}
                  onClick={() => run(() => navigate(route.path))}
                >
                  <ShortcutKey>{index + 1}</ShortcutKey>
                  {route.label}
                </Button>
              ))
            : null}
          {/* Carried here as well as on `0`, so the shortcut is discoverable without
              reading the manual — in the same place the page jumps already are. */}
          {remoteInputEnabled ? (
            <Button
              variant="ghost"
              className="justify-start gap-3"
              data-testid="keypad-quick-menu-game-mode"
              onClick={() => run(() => void startGameMode())}
            >
              {fromKeypad ? <ShortcutKey>0</ShortcutKey> : null}
              Game Mode
            </Button>
          ) : null}
          {sectionCounts.total > 0 ? (
            <>
              <Button
                variant="ghost"
                className="justify-start"
                data-testid="keypad-quick-menu-sections-toggle"
                onClick={() => run(() => requestSectionsBulk(sectionCounts.closed > 0))}
              >
                {sectionCounts.closed > 0 ? "Expand all sections" : "Collapse all sections"}
              </Button>
              <Button
                variant="ghost"
                className="justify-start"
                data-testid="keypad-quick-menu-section-descriptions"
                aria-pressed={showDescriptions}
                onClick={() => run(() => saveShowSectionDescriptions(!showDescriptions))}
              >
                {showDescriptions ? "Hide card descriptions" : "Show card descriptions"}
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            className="justify-start"
            data-testid="keypad-quick-menu-diagnostics"
            onClick={() => run(() => requestDiagnosticsOpen("header"))}
          >
            {fromKeypad ? <ShortcutKey>✱</ShortcutKey> : null}
            Diagnostics
          </Button>
          {canSwitchDevices ? (
            <Button
              variant="ghost"
              className="justify-start gap-3"
              data-testid="keypad-quick-menu-switch-device"
              onClick={() => run(() => requestDeviceSwitcherOpen())}
            >
              {fromKeypad ? <ShortcutKey>#</ShortcutKey> : null}
              Switch device
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
