/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useRef, useState } from "react";
import {
  RotateCcw,
  Power,
  PowerOff,
  Pause,
  Menu,
  Upload,
  Play,
  Download,
  RefreshCw,
  Joystick,
  Zap,
  LucideIcon,
} from "lucide-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { QuickActionCard } from "@/components/QuickActionCard";
import { ProfileActionGrid } from "@/components/layout/PageContainer";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { publishMachineInterrupt } from "@/lib/deviceInteraction/machineInterrupt";
import {
  MachineActionConfirmationDialog,
  type MachineActionConfirmation,
} from "@/pages/home/dialogs/MachineActionConfirmationDialog";

type MachineExtraAction = {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  reason?: string | null;
  variant?: "default" | "danger" | "success";
  className?: string;
  /** A word about what this action has, when there is one — the tune Resume would restore. */
  description?: string | null;
  /**
   * Overrides the generated testid and focus id. The promoted music actions keep the ids they had
   * as their own section, because the tour spotlights them and the screenshot corpus names them.
   */
  testId?: string;
  focusId?: string;
};

type PendingDestructiveAction = MachineActionConfirmation & {
  run: () => void | Promise<void>;
  isDisabled: () => boolean;
};

const REBOOT_CLEAR_MEMORY_ACTION_IDS = new Set(["rebootClearMemory"]);

export interface MachineControlsProps {
  /**
   * Draws the card's header without its body while Home is in its offline arrangement, WITHOUT
   * writing to the section store, so the user's own open/closed choice survives (spec.md 6.2).
   */
  forceClosed?: boolean;

  status: { isConnected: boolean; isConnecting: boolean };
  machineTaskBusy: boolean;
  machineExecutionState: "running" | "paused" | "unknown";
  controls: {
    reset: { mutateAsync: () => Promise<unknown>; isPending: boolean };
    reboot: { mutateAsync: () => Promise<unknown>; isPending: boolean };
    powerOff: { mutateAsync: () => Promise<unknown>; isPending: boolean };
    menuButton: { mutateAsync: () => Promise<unknown>; isPending: boolean };
  };
  pauseResumePending: boolean;
  machineTaskId: string | null;
  onPauseResume: () => void;
  onSaveRam: () => void;
  onLoadRam: () => void;
  ramActionsVisible?: boolean;
  onPowerOff: () => void;
  onReboot: () => void;
  onToggleMenu: () => void;
  /** REST `machine:poweroff` is U64-family only (runtime-gated on `/v1/info.core_version`). */
  powerOffVisible?: boolean;
  powerCycleVisible?: boolean;
  onPowerCycle?: () => void;
  powerCycleDisabledReason?: string | null;
  rebootLoading?: boolean;
  menuLoading?: boolean;
  powerCycleLoading?: boolean;
  extraActions?: MachineExtraAction[];
  /** The one action that starts play rather than maintaining the machine; leads the grid. */
  gameModeVisible?: boolean;
  onGameMode?: () => void;
  onAction: (fn: () => Promise<void>, label: string) => void;
  telnetBusy?: boolean;
}

export function MachineControls({
  forceClosed,
  status,
  machineTaskBusy,
  machineExecutionState,
  controls,
  pauseResumePending,
  machineTaskId,
  onPauseResume,
  onSaveRam,
  onLoadRam,
  ramActionsVisible = false,
  onPowerOff,
  onReboot,
  onToggleMenu,
  powerOffVisible = true,
  powerCycleVisible,
  onPowerCycle,
  powerCycleDisabledReason = null,
  rebootLoading = false,
  menuLoading = false,
  powerCycleLoading = false,
  extraActions = [],
  gameModeVisible = false,
  onGameMode,
  onAction,
  telnetBusy = false,
}: MachineControlsProps) {
  // Quick Action tiles carry one word. The grid is two columns on the compact profile at
  // 320 CSS px, so "Game Mode" and "Remote Input" wrapped there, and on wider profiles the
  // second word only repeated what the icon and the tile's own position already say.
  const effectiveBusy = machineTaskBusy || telnetBusy;
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<PendingDestructiveAction | null>(null);
  const [powerSheetOpen, setPowerSheetOpen] = useState(false);
  const machineGuardsRef = useRef({ isConnected: status.isConnected, effectiveBusy: false, powerCycleDisabled: true });
  const canRunPowerCycle = typeof onPowerCycle === "function";
  const showPowerCycle = powerCycleVisible ?? canRunPowerCycle;
  const powerCycleDisabled =
    !status.isConnected || effectiveBusy || Boolean(powerCycleDisabledReason) || !canRunPowerCycle;
  machineGuardsRef.current = {
    isConnected: status.isConnected,
    effectiveBusy,
    powerCycleDisabled,
  };
  const disabledCapabilityNotes = extraActions
    .filter((action) => action.disabled && action.reason)
    .map((action) => ({
      id: action.id,
      label: action.label,
      reason: action.reason as string,
    }));

  const openDestructiveConfirmation = (action: PendingDestructiveAction) => {
    if (action.isDisabled()) return;
    setPendingDestructiveAction(action);
  };

  const handleConfirmDestructiveAction = () => {
    const action = pendingDestructiveAction;
    if (!action) return;
    setPendingDestructiveAction(null);
    if (action.isDisabled()) return;
    void action.run();
  };

  // The ring follows the DOM, so grouping the destructive tiles is a matter of
  // where they are rendered, not of their focusOrder. Extras arrive interleaved,
  // which is what used to scatter the red tiles through the safe ones.
  const safeExtraActions = extraActions.filter((action) => action.variant !== "danger");
  /*
   * Remote Input sits beside Game Mode rather than after Pause.
   *
   * The two are the same thing at different depths — Game Mode is Remote Input with the joystick
   * up and the screen mirrored — so a reader looking for one is looking at the other. Coming
   * through `extraActions` put it after Menu and Pause, which are unrelated machine controls, and
   * on a four-column grid that placed it on the far side of the row from its pair.
   */
  const remoteInputAction = safeExtraActions.find((action) => action.id === "openRemoteInput") ?? null;
  /*
   * The promoted actions are a contiguous run at the end of the safe tiles.
   *
   * They used to be their own section above this one. This app is a remote control first and a
   * standalone player second, so a banner of its own over-weighted the second. Radio immediately
   * before Resume and Recent is what makes those two readable: proximity does the work a longer
   * label would, and every tile here stays one word.
   */
  const promotedActions = safeExtraActions.filter((action) => action.id.startsWith("promoted."));
  /*
   * The grid reads watch, listen, operate, careful.
   *
   * Live View leads with Game and Input: all three are ways to use the machine from here, and
   * keeping them together is the whole point of the first band. The music trio follows as its own
   * band. Then the operational tiles, and the ones that interrupt the machine last, as they always
   * were. Nothing that stops your C64 sits next to something that does not.
   */
  const watchActions = promotedActions.filter((action) => action.id === "promoted.home.section.live-view");
  const listenActions = promotedActions.filter((action) => !watchActions.includes(action));
  const otherSafeExtraActions = safeExtraActions.filter(
    (action) => action !== remoteInputAction && !promotedActions.includes(action),
  );
  const destructiveExtraActions = extraActions.filter((action) => action.variant === "danger");

  /**
   * The rows of the Power sheet, in increasing severity.
   *
   * Each keeps the confirmation it had as a tile — the fold changes where an action is reached
   * from, not what it asks before running. Power Off is the one whose confirmation lives on Home
   * (`PowerOffDialog`) rather than in `MachineActionConfirmationDialog`, so it runs `onPowerOff`
   * directly and that dialog still asks.
   */
  const powerActions: {
    id: string;
    label: string;
    icon: LucideIcon;
    consequence: string;
    disabled: boolean;
    loading: boolean;
    activate: () => void;
  }[] = [
    {
      id: "reboot",
      label: "Reboot",
      icon: Power,
      consequence: "Reboots the C64 Ultimate and interrupts the current session.",
      disabled: !status.isConnected || effectiveBusy,
      loading: rebootLoading,
      activate: () =>
        openDestructiveConfirmation({
          actionName: "Reboot",
          consequence: "This reboots the C64 Ultimate and interrupts the current session.",
          run: onReboot,
          isDisabled: () => !machineGuardsRef.current.isConnected || machineGuardsRef.current.effectiveBusy,
        }),
    },
    ...destructiveExtraActions.map((action) => ({
      id: action.id,
      label: action.label,
      icon: action.icon ?? RefreshCw,
      consequence: REBOOT_CLEAR_MEMORY_ACTION_IDS.has(action.id)
        ? "Reboots the C64 Ultimate, clears memory, and interrupts the current session."
        : (action.reason ?? "Interrupts whatever the C64 is doing."),
      disabled: Boolean(action.disabled),
      loading: Boolean(action.loading),
      activate: () => {
        if (!REBOOT_CLEAR_MEMORY_ACTION_IDS.has(action.id)) {
          void action.onSelect();
          return;
        }
        openDestructiveConfirmation({
          actionName: action.label,
          consequence: "This reboots the C64 Ultimate, clears memory, and interrupts the current session.",
          run: action.onSelect,
          isDisabled: () => Boolean(action.disabled),
        });
      },
    })),
    ...(showPowerCycle
      ? [
          {
            id: "power-cycle",
            label: "Power Cycle",
            icon: RefreshCw,
            consequence: "Cuts the power and restores it, interrupting the current session.",
            disabled: powerCycleDisabled,
            loading: powerCycleLoading,
            activate: () =>
              openDestructiveConfirmation({
                actionName: "Power Cycle",
                consequence: "This power-cycles the C64 Ultimate and interrupts the current session.",
                run: () => onPowerCycle?.(),
                isDisabled: () => machineGuardsRef.current.powerCycleDisabled,
              }),
          },
        ]
      : []),
    ...(powerOffVisible
      ? [
          {
            id: "power-off",
            label: "Power Off",
            icon: PowerOff,
            consequence: "Turns the C64 Ultimate off. It has to be switched on by hand afterwards.",
            disabled: !status.isConnected || effectiveBusy,
            loading: controls.powerOff.isPending,
            activate: () => void onPowerOff(),
          },
        ]
      : []),
  ];

  const renderExtraAction = (action: MachineExtraAction, focusOrder: number) => {
    const Icon = action.icon ?? RefreshCw;
    const requiresConfirmation = REBOOT_CLEAR_MEMORY_ACTION_IDS.has(action.id);
    return (
      <QuickActionCard
        key={action.id}
        icon={Icon}
        label={action.loading ? `${action.label}…` : action.label}
        description={action.description ?? undefined}
        dataTestId={action.testId ?? `home-machine-inline-${action.id}`}
        focusId={action.focusId ?? `home-machine-${action.id}`}
        focusOrder={focusOrder}
        onClick={() => {
          if (!requiresConfirmation) {
            void action.onSelect();
            return;
          }
          openDestructiveConfirmation({
            actionName: action.label,
            consequence: "This reboots the C64 Ultimate, clears memory, and interrupts the current session.",
            run: action.onSelect,
            isDisabled: () => Boolean(action.disabled),
          });
        }}
        disabled={action.disabled}
        loading={action.loading}
        variant={action.variant}
        className={action.className}
      />
    );
  };

  return (
    <>
      <CollapsibleSection
        scope="home"
        id="quick-actions"
        forceClosed={forceClosed}
        title="Quick Actions"
        icon={Zap}
        defaultOpen
        testId="home-quick-actions"
        badge={effectiveBusy && <span className="text-xs text-muted-foreground">Working…</span>}
      >
        <div className="space-y-2">
          <ProfileActionGrid
            compactColumns={2}
            mediumColumns={4}
            expandedColumns={4}
            cardDensity="compact"
            testId="home-machine-controls"
          >
            {/* Watch, listen, operate, careful — destructive last in increasing severity, pairs kept
                adjacent, and one focus group throughout: splitting the grid would cost a keypad
                user a ring level to descend into. */}
            {watchActions.map((action, index) => renderExtraAction(action, 90 + index * 2))}
            {gameModeVisible ? (
              <QuickActionCard
                icon={Joystick}
                label="Game"
                dataTestId="home-machine-inline-openGameMode"
                focusId="home-machine-openGameMode"
                focusOrder={100}
                onClick={() => onGameMode?.()}
                disabled={!status.isConnected}
              />
            ) : null}
            {remoteInputAction ? renderExtraAction(remoteInputAction, 105) : null}
            {listenActions.map((action, index) => renderExtraAction(action, 106 + index * 2))}
            <QuickActionCard
              icon={Menu}
              label="Menu"
              focusId="home-machine-menu"
              focusOrder={110}
              onClick={() => void onToggleMenu()}
              disabled={!status.isConnected || effectiveBusy}
              loading={menuLoading}
            />
            <QuickActionCard
              icon={machineExecutionState === "paused" ? Play : Pause}
              label={machineExecutionState === "paused" ? "Resume" : "Pause"}
              className={machineExecutionState === "paused" ? "border-primary/60 bg-primary/10" : undefined}
              focusId="home-machine-pause-resume"
              focusOrder={120}
              onClick={() => void onPauseResume()}
              disabled={!status.isConnected || effectiveBusy}
              loading={pauseResumePending}
            />
            {otherSafeExtraActions.map((action, index) => renderExtraAction(action, 130 + index * 2))}
            {ramActionsVisible ? (
              <>
                {/*
                  "Backup" and "Restore", not "Save RAM" and "Load RAM".
                  Both old labels were two words, which wrapped and so made every tile in the row
                  21.6px taller, and "Load RAM" was wrong besides: it opens the snapshot library,
                  it does not load anything. Neither could be shortened to "Snapshot", the word the
                  dialogs and the library use for the thing being written — at four columns it
                  needs 72.3px against 58.6px of tile, and one word cannot wrap, so it is cut.
                  Backup is the verb Datel's own Action Replay manual uses for exactly this
                  operation on exactly this machine ("makes backups by taking a snapshot of the
                  whole of the computer's memory"), it pairs with Restore without explanation, and
                  neither word is on a Config tile, which is where a user's other Save and Load
                  live. "Snapshot" stays the noun everywhere else.
                */}
                <QuickActionCard
                  icon={Download}
                  label="Backup"
                  dataTestId="home-save-ram"
                  focusId="home-machine-save-ram"
                  focusOrder={150}
                  onClick={() => void onSaveRam()}
                  disabled={!status.isConnected || effectiveBusy}
                  loading={machineTaskId === "save-ram"}
                />
                <QuickActionCard
                  icon={Upload}
                  label="Restore"
                  dataTestId="home-load-ram"
                  focusId="home-machine-load-ram"
                  focusOrder={160}
                  onClick={() => void onLoadRam()}
                  disabled={!status.isConnected || effectiveBusy}
                  loading={machineTaskId === "load-ram"}
                />
              </>
            ) : null}
            <QuickActionCard
              icon={RotateCcw}
              label="Reset"
              variant="danger"
              className="border-destructive/40 bg-destructive/[0.04]"
              focusId="home-machine-reset"
              focusOrder={170}
              onClick={() =>
                openDestructiveConfirmation({
                  actionName: "Reset",
                  consequence: "This resets the running C64 session.",
                  run: () =>
                    onAction(async () => {
                      await controls.reset.mutateAsync();
                      // HARD19-031: publish the machine takeover so an armed
                      // playlist stops instead of auto-advancing over the freshly
                      // reset machine. HARD19-032: restore any pending pause-mute
                      // so a reset-while-paused does not strand the SID mixer
                      // muted. publishMachineInterrupt sets "running" synchronously.
                      void publishMachineInterrupt({ reason: "home-reset", label: "Reset" });
                    }, "Machine reset"),
                  isDisabled: () => !machineGuardsRef.current.isConnected || machineGuardsRef.current.effectiveBusy,
                })
              }
              disabled={!status.isConnected || effectiveBusy}
              loading={controls.reset.isPending}
            />
            {/*
              Reset keeps its own tile; everything that reboots or cuts power is behind this one.
              Reset is among the most-reached controls in the app and has to stay one tap. The
              other four are not: rebooting or powering down the Ultimate is a thing you do at the
              end of a session, not during one, and as four red tiles they were a third of the
              grid and the largest block of it a first-time reader met.
            */}
            <QuickActionCard
              icon={Power}
              label="Power"
              variant="danger"
              className="border-destructive/40 bg-destructive/[0.04]"
              dataTestId="home-power-actions"
              focusId="home-machine-power"
              focusOrder={180}
              onClick={() => setPowerSheetOpen(true)}
              disabled={powerActions.every((action) => action.disabled)}
              loading={powerActions.some((action) => action.loading)}
            />
          </ProfileActionGrid>
          {disabledCapabilityNotes.length > 0 ? (
            <div className="space-y-1" data-testid="home-machine-capability-notes">
              {disabledCapabilityNotes.map((note) => (
                <p key={note.id} className="text-xs text-muted-foreground" data-testid={`home-machine-note-${note.id}`}>
                  {note.label}: {note.reason}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </CollapsibleSection>
      <AppSheet open={powerSheetOpen} onOpenChange={setPowerSheetOpen}>
        <AppSheetContent className="overflow-hidden p-0 sm:w-[min(100vw-2rem,32rem)]" data-testid="home-power-sheet">
          <AppSheetHeader>
            <AppSheetTitle>Power</AppSheetTitle>
            <AppSheetDescription>
              Each of these interrupts whatever the C64 is doing. You are asked to confirm first.
            </AppSheetDescription>
          </AppSheetHeader>
          <AppSheetBody className="space-y-2 px-4 py-4 sm:px-5">
            {powerActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  data-testid={`home-power-action-${action.id}`}
                  className="flex w-full min-h-11 items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/[0.04] px-3 py-2 text-left transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={action.disabled || action.loading}
                  onClick={() => {
                    // Closed first, so the confirmation dialog is not opened behind this sheet.
                    setPowerSheetOpen(false);
                    action.activate();
                  }}
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {action.loading ? `${action.label}…` : action.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{action.consequence}</span>
                  </span>
                </button>
              );
            })}
          </AppSheetBody>
        </AppSheetContent>
      </AppSheet>
      <MachineActionConfirmationDialog
        open={pendingDestructiveAction !== null}
        action={pendingDestructiveAction}
        onOpenChange={(open) => {
          if (!open) setPendingDestructiveAction(null);
        }}
        onConfirm={handleConfirmDestructiveAction}
      />
    </>
  );
}
