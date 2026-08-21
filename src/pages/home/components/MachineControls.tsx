/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ReactNode, useRef, useState } from "react";
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
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
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
};

type PendingDestructiveAction = MachineActionConfirmation & {
  run: () => void | Promise<void>;
  isDisabled: () => boolean;
};

const REBOOT_CLEAR_MEMORY_ACTION_IDS = new Set(["rebootClearMemory"]);

export interface MachineControlsProps {
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
  footer?: ReactNode;
}

export function MachineControls({
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
  footer,
}: MachineControlsProps) {
  // Quick Actions drop to two columns on the compact profile (320 CSS px across), which
  // leaves each tile about 150px wide — narrower than "Game Mode" wants. The shorter
  // face is compact-only; every wider profile keeps the full feature name.
  const { profile } = useDisplayProfile();
  const gameModeLabel = profile === "compact" ? "Game" : "Game Mode";
  const effectiveBusy = machineTaskBusy || telnetBusy;
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<PendingDestructiveAction | null>(null);
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
  const otherSafeExtraActions = safeExtraActions.filter((action) => action !== remoteInputAction);
  const destructiveExtraActions = extraActions.filter((action) => action.variant === "danger");

  const renderExtraAction = (action: MachineExtraAction, focusOrder: number) => {
    const Icon = action.icon ?? RefreshCw;
    const requiresConfirmation = REBOOT_CLEAR_MEMORY_ACTION_IDS.has(action.id);
    return (
      <QuickActionCard
        key={action.id}
        icon={Icon}
        label={action.loading ? `${action.label}…` : action.label}
        dataTestId={`home-machine-inline-${action.id}`}
        focusId={`home-machine-${action.id}`}
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
            {/* Frequent and safe first, destructive last in increasing severity, pairs
                kept adjacent, and one focus group throughout — splitting the grid would
                cost a keypad user a ring level to descend into. */}
            {gameModeVisible ? (
              <QuickActionCard
                icon={Joystick}
                label={gameModeLabel}
                dataTestId="home-machine-inline-openGameMode"
                focusId="home-machine-openGameMode"
                focusOrder={100}
                onClick={() => onGameMode?.()}
                disabled={!status.isConnected}
              />
            ) : null}
            {remoteInputAction ? renderExtraAction(remoteInputAction, 105) : null}
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
                <QuickActionCard
                  icon={Download}
                  label="Save RAM"
                  dataTestId="home-save-ram"
                  focusId="home-machine-save-ram"
                  focusOrder={150}
                  onClick={() => void onSaveRam()}
                  disabled={!status.isConnected || effectiveBusy}
                  loading={machineTaskId === "save-ram"}
                />
                <QuickActionCard
                  icon={Upload}
                  label="Load RAM"
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
            <QuickActionCard
              icon={Power}
              label="Reboot"
              variant="danger"
              className="border-destructive/40 bg-destructive/[0.04]"
              focusId="home-machine-reboot"
              focusOrder={180}
              onClick={() =>
                openDestructiveConfirmation({
                  actionName: "Reboot",
                  consequence: "This reboots the C64 Ultimate and interrupts the current session.",
                  run: onReboot,
                  isDisabled: () => !machineGuardsRef.current.isConnected || machineGuardsRef.current.effectiveBusy,
                })
              }
              disabled={!status.isConnected || effectiveBusy}
              loading={rebootLoading}
            />
            {destructiveExtraActions.map((action, index) => renderExtraAction(action, 190 + index * 2))}
            {showPowerCycle ? (
              <QuickActionCard
                icon={RefreshCw}
                label="Power Cycle"
                variant="danger"
                className="border-destructive/40 bg-destructive/[0.04]"
                dataTestId="home-power-cycle"
                focusId="home-machine-power-cycle"
                focusOrder={200}
                onClick={() =>
                  openDestructiveConfirmation({
                    actionName: "Power Cycle",
                    consequence: "This power-cycles the C64 Ultimate and interrupts the current session.",
                    run: () => onPowerCycle?.(),
                    isDisabled: () => machineGuardsRef.current.powerCycleDisabled,
                  })
                }
                disabled={powerCycleDisabled}
                loading={powerCycleLoading}
              />
            ) : null}
            {powerOffVisible ? (
              <QuickActionCard
                icon={PowerOff}
                label="Power Off"
                variant="danger"
                className="border-destructive/30 bg-destructive/[0.03] opacity-80"
                focusId="home-machine-power-off"
                focusOrder={210}
                onClick={() => void onPowerOff()}
                disabled={!status.isConnected || effectiveBusy}
                loading={controls.powerOff.isPending}
              />
            ) : null}
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
          {footer ? <div data-testid="home-machine-footer">{footer}</div> : null}
        </div>
      </CollapsibleSection>
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
