/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ReactNode, useRef, useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw, Power, PowerOff, Pause, Menu, Upload, Play, Download, RefreshCw, LucideIcon } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { QuickActionCard } from "@/components/QuickActionCard";
import { ProfileActionGrid } from "@/components/layout/PageContainer";
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
  setMachineExecutionState: (s: "running" | "paused" | "unknown") => void;
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
  onAction: (fn: () => Promise<void>, label: string) => void;
  telnetBusy?: boolean;
  footer?: ReactNode;
}

export function MachineControls({
  status,
  machineTaskBusy,
  machineExecutionState,
  setMachineExecutionState,
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
  onAction,
  telnetBusy = false,
  footer,
}: MachineControlsProps) {
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

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="space-y-2"
        data-section-label="Quick Actions"
      >
        <SectionHeader title="Quick Actions">
          {effectiveBusy && <span className="ml-2 text-xs text-muted-foreground">Working…</span>}
        </SectionHeader>
        <div className="space-y-2">
          <ProfileActionGrid
            compactColumns={2}
            mediumColumns={4}
            expandedColumns={4}
            cardDensity="compact"
            testId="home-machine-controls"
          >
            <QuickActionCard
              icon={RotateCcw}
              label="Reset"
              variant="danger"
              className="border-destructive/40 bg-destructive/[0.04]"
              focusId="home-machine-reset"
              focusOrder={100}
              onClick={() =>
                openDestructiveConfirmation({
                  actionName: "Reset",
                  consequence: "This resets the running C64 session.",
                  run: () =>
                    onAction(async () => {
                      await controls.reset.mutateAsync();
                      setMachineExecutionState("running");
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
              focusOrder={110}
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
            <QuickActionCard
              icon={Menu}
              label="Menu"
              focusId="home-machine-menu"
              focusOrder={130}
              onClick={() => void onToggleMenu()}
              disabled={!status.isConnected || effectiveBusy}
              loading={menuLoading}
            />
            {ramActionsVisible ? (
              <>
                <QuickActionCard
                  icon={Download}
                  label="Save RAM"
                  dataTestId="home-save-ram"
                  focusId="home-machine-save-ram"
                  focusOrder={140}
                  onClick={() => void onSaveRam()}
                  disabled={!status.isConnected || effectiveBusy}
                  loading={machineTaskId === "save-ram"}
                />
                <QuickActionCard
                  icon={Upload}
                  label="Load RAM"
                  dataTestId="home-load-ram"
                  focusId="home-machine-load-ram"
                  focusOrder={150}
                  onClick={() => void onLoadRam()}
                  disabled={!status.isConnected || effectiveBusy}
                  loading={machineTaskId === "load-ram"}
                />
              </>
            ) : null}
            {showPowerCycle ? (
              <QuickActionCard
                icon={RefreshCw}
                label="Power Cycle"
                variant="danger"
                className="border-destructive/40 bg-destructive/[0.04]"
                dataTestId="home-power-cycle"
                focusId="home-machine-power-cycle"
                focusOrder={160}
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
            {extraActions.map((action, index) => {
              const Icon = action.icon ?? RefreshCw;
              const requiresConfirmation = REBOOT_CLEAR_MEMORY_ACTION_IDS.has(action.id);
              return (
                <QuickActionCard
                  key={action.id}
                  icon={Icon}
                  label={action.loading ? `${action.label}…` : action.label}
                  dataTestId={`home-machine-inline-${action.id}`}
                  focusId={`home-machine-${action.id}`}
                  focusOrder={170 + index * 2}
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
            })}
            {powerOffVisible ? (
              <QuickActionCard
                icon={PowerOff}
                label="Power Off"
                variant="danger"
                className="border-destructive/30 bg-destructive/[0.03] opacity-80"
                focusId="home-machine-power-off"
                focusOrder={190}
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
      </motion.div>
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
