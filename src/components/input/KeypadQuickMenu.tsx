/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TAB_ROUTES, visibleTabIndexes } from "@/lib/navigation/tabRoutes";
import { useAppMode } from "@/lib/appMode/appModeStore";
import { isSurfaceVisible } from "@/lib/appMode/surfaces";
import {
  requestDeviceSwitcherOpen,
  requestMachineCommand,
  subscribeQuickMenuOpen,
  type QuickMenuSource,
} from "@/lib/input/keypadCommands";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { requestSearchOpen } from "@/lib/search/overlayState";
import { navigateToSearchTarget } from "@/lib/search/navigate";
import { toast } from "@/hooks/use-toast";
import { GAME_MODE_HOST_PATHS, startGameMode } from "@/lib/remoteInput/gameModeLaunch";
import { useGameModeAvailable } from "@/hooks/useGameModeAvailable";
import { useAvMirror } from "@/hooks/useAvMirror";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { variant } from "@/generated/variant";
import { APP_SETTINGS_KEYS, loadRemoteFunction1Action, loadRemoteFunction3Action } from "@/lib/config/appSettings";
import { REMOTE_FUNCTION_ACTION_LABELS } from "@/lib/input/functionKeyShortcuts";
import {
  loadShowSectionDescriptions,
  requestSectionsBulk,
  saveShowSectionDescriptions,
  subscribeShowSectionDescriptions,
} from "@/lib/ui/collapsibleSectionStore";
import { findNewestToastAction, type ToastActionTarget } from "@/lib/input/toastAction";

/** Lands on the F1/F3 card in Settings, the same way a search result for it would. */
const REMOTE_FUNCTION_SETTINGS_TARGET = {
  kind: "control",
  path: "/settings",
  scope: "settings",
  sectionId: "play-and-disk",
  testId: "settings-remote-function-actions",
} as const;

/** Names the key, as `KeyboardEvent.key` reports it, that presses an entry while the menu is open. */
const SHORTCUT_KEY_ATTR = "data-quick-menu-key";

/**
 * Presses the entry whose keycap matches the key. The keycaps name the keys that reach each entry
 * from anywhere, but an open overlay owns the keyboard, so with the menu open they did nothing.
 */
const pressEntryForKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  const entry = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(`[${SHORTCUT_KEY_ATTR}]`)).find(
    (candidate) => candidate.getAttribute(SHORTCUT_KEY_ATTR) === event.key,
  );
  if (!entry || entry.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  entry.click();
};

/** The physical key that reaches this entry directly, drawn as the keycap it is. */
const ShortcutKey = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-sm border border-border bg-muted px-1 py-0.5 font-sans text-xs font-semibold text-muted-foreground">
    {children}
  </kbd>
);

/**
 * The Quick Menu — opened by the keypad's Menu key when the focused item has no context menu, or by
 * the app bar's own button (wired via {@link subscribeQuickMenuOpen}). It surfaces the
 * always-reachable high-value actions the dedicated keys provide (jump to a page, Diagnostics,
 * Switch Device) in a discoverable list, plus the actions that belong to the page it was opened on.
 * Being a Radix dialog it becomes the active focus scope, so it is keypad-navigable with no extra
 * wiring: Up/Down move between entries, OK activates, Back/Esc closes.
 */
export function KeypadQuickMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const savedDevices = useSavedDevices();
  const gameModeAvailable = useGameModeAvailable();
  const mirror = useAvMirror();
  const appMode = useAppMode();
  const shows = (id: Parameters<typeof isSurfaceVisible>[0]) => isSurfaceVisible(id, appMode);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<QuickMenuSource>("keypad");
  const [functionActions, setFunctionActions] = useState(
    () => [loadRemoteFunction1Action(), loadRemoteFunction3Action()] as const,
  );
  /** Set while this menu is closing in order to hand focus to something else it opened. */
  const handingOverFocusRef = useRef(false);
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

  useEffect(() => {
    const sync = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (
        key !== APP_SETTINGS_KEYS.REMOTE_FUNCTION_1_ACTION_KEY &&
        key !== APP_SETTINGS_KEYS.REMOTE_FUNCTION_3_ACTION_KEY
      )
        return;
      setFunctionActions([loadRemoteFunction1Action(), loadRemoteFunction3Action()]);
    };
    window.addEventListener("c64u-app-settings-updated", sync);
    return () => window.removeEventListener("c64u-app-settings-updated", sync);
  }, []);

  const run = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

  const canSwitchDevices = savedDevices.devices.length > 1 && shows("quick-menu:switch-device");

  /*
   * Both section entries are always listed on a page that has sections, rather than one entry whose
   * wording flips. A single entry means reading it to find out which way it will go; two mean the
   * one you want is always in the same place. Whichever would do nothing is disabled, so the menu
   * still says which of them is available.
   */
  const [toastAction, setToastAction] = useState<ToastActionTarget | null>(null);
  useEffect(() => {
    if (open) setToastAction(findNewestToastAction());
  }, [open]);

  const [sectionCounts, setSectionCounts] = useState({ total: 0, closed: 0 });
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    // Cached pages keep their cards in the document while hidden; only the page on screen is counted.
    const page = document.querySelector('[data-slot-active="true"]') ?? document;
    const cards = page.querySelectorAll("[data-section-label][data-open]");
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
      <DialogContent
        className="flex max-h-[85dvh] max-w-xs flex-col overflow-hidden"
        data-testid="keypad-quick-menu"
        onKeyDown={pressEntryForKey}
        /*
         * Focus is normally restored to whatever opened this menu. Not when the menu is closing in
         * order to open the search overlay or land on a Settings control: this dialog animates out
         * over 200 ms, Radix keeps it mounted until that finishes, and its focus scope then pulled
         * focus off the search field the overlay had already taken — closing the soft keyboard a
         * fifth of a second after it appeared.
         */
        onCloseAutoFocus={(event) => {
          if (!handingOverFocusRef.current) return;
          handingOverFocusRef.current = false;
          event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Quick menu</DialogTitle>
          <DialogDescription>
            {fromKeypad ? "Jump to a page or open a high-value action." : "Actions for this page."}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 grid min-h-0 flex-1 gap-1.5 overflow-y-auto px-1">
          {/*
            The top entry, on both sources: search is the way around the app for someone who does
            not know where a thing lives, which is exactly why they opened this menu. Opening it
            closes this dialog FIRST and opens the overlay on the next tick — stacking two Radix
            focus scopes and letting one unmount under the other is a known source of stray focus
            and swallowed Back presses in this codebase (spec.md section 5.7).
          */}
          <Button
            variant="ghost"
            className="justify-start gap-3"
            data-testid="keypad-quick-menu-search"
            data-quick-menu-key={fromKeypad ? "7" : undefined}
            onClick={() => {
              handingOverFocusRef.current = true;
              setOpen(false);
              setTimeout(() => requestSearchOpen({ source: "quick-menu" }), 0);
            }}
          >
            {fromKeypad ? <ShortcutKey>7</ShortcutKey> : null}
            Search
          </Button>
          {toastAction ? (
            <Button
              variant="ghost"
              className="justify-start"
              data-testid="keypad-quick-menu-toast-action"
              onClick={() =>
                run(() => {
                  if (toastAction.press()) return;
                  toast({
                    title: "Notification already closed",
                    description: `${toastAction.label} did not run.`,
                  });
                })
              }
            >
              Notification: {toastAction.label}
            </Button>
          ) : null}
          {/* Live View's mark in the header badge says a stream is running; this is where it stops. */}
          {mirror.anyLive && shows("quick-menu:stop-live-view") ? (
            <Button
              variant="ghost"
              className="justify-start"
              data-testid="keypad-quick-menu-stop-live-view"
              onClick={() => run(() => void mirror.stopAll())}
            >
              Stop Live View
            </Button>
          ) : null}
          {fromKeypad
            ? visibleTabIndexes(appMode).map((tabIndex, position) => (
                <Button
                  key={TAB_ROUTES[tabIndex].path}
                  variant="ghost"
                  className="justify-start gap-3"
                  data-testid={`keypad-quick-menu-tab-${TAB_ROUTES[tabIndex].label.toLowerCase()}`}
                  data-quick-menu-key={String(position + 1)}
                  onClick={() => run(() => navigate(TAB_ROUTES[tabIndex].path))}
                >
                  <ShortcutKey>{position + 1}</ShortcutKey>
                  {TAB_ROUTES[tabIndex].label}
                </Button>
              ))
            : null}
          {/* The machine controls carry their own keys too. They live in Home's Quick actions grid,
              which is where they read best, but that is ten presses from a cold arrival; naming the
              key here is how a keypad user finds the short way without reading the manual. */}
          {fromKeypad && shows("quick-menu:machine-pause") ? (
            <>
              <Button
                variant="ghost"
                className="justify-start gap-3"
                data-testid="keypad-quick-menu-machine-pause"
                data-quick-menu-key="8"
                onClick={() => run(() => requestMachineCommand("pauseResume"))}
              >
                <ShortcutKey>8</ShortcutKey>
                Pause / Resume machine
              </Button>
              <Button
                variant="ghost"
                className="justify-start gap-3"
                data-testid="keypad-quick-menu-machine-reset"
                data-quick-menu-key="9"
                onClick={() => run(() => requestMachineCommand("reset"))}
              >
                <ShortcutKey>9</ShortcutKey>
                Reset machine
              </Button>
            </>
          ) : null}
          {/* Carried here as well as on `0`, so the shortcut is discoverable without
              reading the manual — in the same place the page jumps already are. */}
          {gameModeAvailable && shows("quick-menu:game-mode") ? (
            <Button
              variant="ghost"
              className="justify-start gap-3"
              data-testid="keypad-quick-menu-game-mode"
              data-quick-menu-key={fromKeypad ? "0" : undefined}
              onClick={() =>
                run(() => {
                  // Only Home and Play mount the Remote Input sheet that answers the request.
                  if (!GAME_MODE_HOST_PATHS.has(location.pathname)) navigate(TAB_ROUTES[0].path);
                  void startGameMode();
                })
              }
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
                data-testid="keypad-quick-menu-sections-expand"
                onClick={() => run(() => requestSectionsBulk(true))}
                disabled={sectionCounts.closed === 0}
              >
                Expand all sections
              </Button>
              <Button
                variant="ghost"
                className="justify-start"
                data-testid="keypad-quick-menu-sections-collapse"
                onClick={() => run(() => requestSectionsBulk(false))}
                disabled={sectionCounts.closed === sectionCounts.total}
              >
                Collapse all sections
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
            data-quick-menu-key={fromKeypad ? "*" : undefined}
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
              data-quick-menu-key={fromKeypad ? "#" : undefined}
              onClick={() => run(() => requestDeviceSwitcherOpen())}
            >
              {fromKeypad ? <ShortcutKey>#</ShortcutKey> : null}
              Switch device
            </Button>
          ) : null}
          {/* Last: reference for the two function keys, not a destination; the entries above are what the menu is opened for. */}
          {String(variant.id) === "c64u-remote" ? (
            <div className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="keypad-quick-menu-function-summary">
              F1: {REMOTE_FUNCTION_ACTION_LABELS[functionActions[0]]} · F3:{" "}
              {REMOTE_FUNCTION_ACTION_LABELS[functionActions[1]]}
              {shows("settings:play-and-disk-machine-rows") ? (
                <Button
                  variant="link"
                  className="ml-1 h-auto min-h-11 px-1"
                  data-testid="keypad-quick-menu-configure-function-keys"
                  onClick={() => {
                    handingOverFocusRef.current = true;
                    run(
                      () =>
                        void navigateToSearchTarget(REMOTE_FUNCTION_SETTINGS_TARGET, {
                          navigate,
                          currentPath: location.pathname,
                          label: "Remote function keys",
                          onToast: (message) => toast({ title: message, variant: "destructive" }),
                        }),
                    );
                  }}
                >
                  Configure
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
