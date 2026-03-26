/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ReactNode } from "react";
import { motion } from "framer-motion";
import { RotateCcw, Power, PowerOff, Pause, Menu, Upload, Play, Download, RefreshCw } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { QuickActionCard } from "@/components/QuickActionCard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProfileActionGrid } from "@/components/layout/PageContainer";

type MachineOverflowAction = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  loading?: boolean;
};

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
  onRebootClearMemory: () => void;
  onPowerOff: () => void;
  onPowerCycle?: () => void;
  overflowActions?: MachineOverflowAction[];
  onAction: (fn: () => Promise<void>, label: string) => void;
  telnetAvailable?: boolean;
  telnetBusy?: boolean;
  telnetActiveActionId?: string | null;
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
  onRebootClearMemory,
  onPowerOff,
  onPowerCycle,
  overflowActions = [],
  onAction,
  telnetAvailable = false,
  telnetBusy = false,
  telnetActiveActionId = null,
  footer,
}: MachineControlsProps) {
  const effectiveBusy = machineTaskBusy || telnetBusy;
  const canRunPowerCycle = telnetAvailable && typeof onPowerCycle === "function";
  const hasOverflowActions = overflowActions.length > 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="space-y-2"
      data-section-label="Quick Actions"
    >
      <SectionHeader
        title="Quick Actions"
        actions={
          hasOverflowActions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  data-testid="home-machine-overflow-trigger"
                >
                  ...
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" data-testid="home-machine-overflow-menu">
                {overflowActions.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    disabled={action.disabled || action.loading}
                    onSelect={() => action.onSelect()}
                    data-testid={`home-machine-overflow-${action.id}`}
                  >
                    {action.loading ? `${action.label}…` : action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      >
        {effectiveBusy && <span className="ml-2 text-xs text-muted-foreground">Working…</span>}
      </SectionHeader>
      <div className="space-y-2">
        <ProfileActionGrid
          compactColumns={4}
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
            onClick={() =>
              onAction(async () => {
                await controls.reset.mutateAsync();
                setMachineExecutionState("running");
              }, "Machine reset")
            }
            disabled={!status.isConnected || effectiveBusy}
            loading={controls.reset.isPending}
          />
          <QuickActionCard
            icon={Power}
            label="Reboot"
            variant="danger"
            className="border-destructive/40 bg-destructive/[0.04]"
            onClick={() => void onRebootClearMemory()}
            disabled={!status.isConnected || effectiveBusy || !telnetAvailable}
            loading={telnetActiveActionId === "rebootClearMemory"}
          />
          <QuickActionCard
            icon={machineExecutionState === "paused" ? Play : Pause}
            label={machineExecutionState === "paused" ? "Resume" : "Pause"}
            className={machineExecutionState === "paused" ? "border-primary/60 bg-primary/10" : undefined}
            onClick={() => void onPauseResume()}
            disabled={!status.isConnected || effectiveBusy}
            loading={pauseResumePending}
          />
          <QuickActionCard
            icon={Menu}
            label="Menu"
            onClick={() => onAction(() => controls.menuButton.mutateAsync() as Promise<void>, "Menu toggled")}
            disabled={!status.isConnected || effectiveBusy}
            loading={controls.menuButton.isPending}
          />
          <QuickActionCard
            icon={Download}
            label="Save RAM"
            dataTestId="home-save-ram"
            onClick={() => void onSaveRam()}
            disabled={!status.isConnected || effectiveBusy}
            loading={machineTaskId === "save-ram"}
          />
          <QuickActionCard
            icon={Upload}
            label="Load RAM"
            dataTestId="home-load-ram"
            onClick={() => void onLoadRam()}
            disabled={!status.isConnected || effectiveBusy}
            loading={machineTaskId === "load-ram"}
          />
          <QuickActionCard
            icon={RefreshCw}
            label="Power Cycle"
            variant="danger"
            className="border-destructive/40 bg-destructive/[0.04]"
            dataTestId="home-power-cycle"
            onClick={() => void onPowerCycle?.()}
            disabled={!status.isConnected || effectiveBusy || !canRunPowerCycle}
            loading={telnetActiveActionId === "powerCycle"}
          />
          <QuickActionCard
            icon={PowerOff}
            label="Power Off"
            variant="danger"
            className="border-destructive/30 bg-destructive/[0.03] opacity-80"
            onClick={() => void onPowerOff()}
            disabled={!status.isConnected || effectiveBusy}
            loading={controls.powerOff.isPending}
          />
        </ProfileActionGrid>
        {footer ? <div data-testid="home-machine-footer">{footer}</div> : null}
      </div>
    </motion.div>
  );
}
