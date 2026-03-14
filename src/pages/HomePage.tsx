/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw, Save, RefreshCw, Trash2, Upload, Download, FolderOpen } from "lucide-react";
import { useC64ConfigItems, useC64Connection } from "@/hooks/useC64Connection";
import { useActionTrace } from "@/hooks/useActionTrace";
import { AppBar } from "@/components/AppBar";
import { QuickActionCard } from "@/components/QuickActionCard";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

import { SystemInfo } from "./home/components/SystemInfo";
import { MachineControls } from "./home/components/MachineControls";
import { AudioMixer } from "./home/components/AudioMixer";
import { StreamStatus } from "./home/components/StreamStatus";
import { DriveManager } from "./home/components/DriveManager";
import { PrinterManager } from "./home/components/PrinterManager";
import { LightingSummaryCard } from "./home/components/LightingSummaryCard";
import { UserInterfaceSummaryCard } from "./home/components/UserInterfaceSummaryCard";
import { SummaryConfigCard, SummaryConfigControlRow } from "./home/components/SummaryConfigCard";
import { PowerOffDialog } from "./home/dialogs/PowerOffDialog";
import { SaveConfigDialog } from "./home/dialogs/SaveConfigDialog";
import { LoadConfigDialog } from "./home/dialogs/LoadConfigDialog";
import { ManageConfigDialog } from "./home/dialogs/ManageConfigDialog";
import { toast } from "@/hooks/use-toast";
import { reportUserError } from "@/lib/uiErrors";
import { useAppConfigState } from "@/hooks/useAppConfigState";
import { useHomeActions } from "./home/hooks/useHomeActions";
import { useSharedConfigActions } from "./home/hooks/ConfigActionsContext";
import { ConfigActionsProvider } from "./home/hooks/ConfigActionsContext";
import { buildSidSilenceTargets, silenceSidTargets } from "@/lib/sid/sidSilence";
import { SaveRamDialog } from "./home/dialogs/SaveRamDialog";
import { RestoreSnapshotDialog } from "./home/dialogs/RestoreSnapshotDialog";
import { SnapshotManagerDialog } from "./home/dialogs/SnapshotManagerDialog";
import { useSnapshotStore } from "@/lib/snapshot/snapshotStore";
import type { SnapshotStorageEntry } from "@/lib/snapshot/snapshotTypes";
import { deriveRamDumpFolderDisplayPath } from "@/lib/config/ramDumpFolderStore";

import {
  C64_CARTRIDGE_HOME_ITEMS,
  KEYBOARD_LIGHTING_HOME_ITEMS,
  LED_STRIP_HOME_ITEMS,
  U64_HOME_ITEMS,
  USER_INTERFACE_HOME_ITEMS,
} from "./home/constants";

import { normalizeOptionToken } from "./home/utils/uiLogic";
import { buildConfigKey, readItemOptions, resolveTurboControlValue } from "./home/utils/HomeConfigUtils";

import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <ConfigActionsProvider>
      <HomePageContent />
    </ConfigActionsProvider>
  );
}

function HomePageContent() {
  const { status } = useC64Connection();
  const isActive = status.isConnected;

  const { data: u64SettingsCategory } = useC64ConfigItems(
    "U64 Specific Settings",
    [...U64_HOME_ITEMS],
    isActive || status.isConnecting,
  );
  const { data: c64CartridgeCategory } = useC64ConfigItems(
    "C64 and Cartridge Settings",
    [...C64_CARTRIDGE_HOME_ITEMS],
    isActive || status.isConnecting,
  );
  const { data: ledStripCategory } = useC64ConfigItems(
    "LED Strip Settings",
    [...LED_STRIP_HOME_ITEMS],
    isActive || status.isConnecting,
  );
  const { data: userInterfaceCategory } = useC64ConfigItems(
    "User Interface Settings",
    [...USER_INTERFACE_HOME_ITEMS],
    isActive || status.isConnecting,
  );
  const { data: keyboardLightingCategory } = useC64ConfigItems(
    "Keyboard Lighting",
    [...KEYBOARD_LIGHTING_HOME_ITEMS],
    isActive || status.isConnecting,
  );

  const {
    controls,
    machineTaskId,
    machineExecutionState,
    setMachineExecutionState,
    pauseResumePending,
    folderTaskPending,
    powerOffDialogOpen,
    setPowerOffDialogOpen,
    ramDumpFolder,
    handleAction,
    handlePauseResume,
    handleSaveRam,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
    handleUpdateSnapshotLabel,
    handleRebootClearMemory,
    handlePowerOff,
    confirmPowerOff,
    handleSelectRamDumpFolder,
    handleResetDrives,
    handleResetPrinter,
    runMachineTask,
  } = useHomeActions();
  const {
    appConfigs,
    hasChanges,
    isApplying,
    isSaving,
    revertToInitial,
    saveCurrentConfig,
    loadAppConfig,
    renameAppConfig,
    deleteAppConfig,
  } = useAppConfigState();
  const trace = useActionTrace("HomePage");

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [saveRamDialogOpen, setSaveRamDialogOpen] = useState(false);
  const [snapshotManagerOpen, setSnapshotManagerOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<SnapshotStorageEntry | null>(null);
  const [cpuSpeedDraftIndex, setCpuSpeedDraftIndex] = useState<number | null>(null);
  const { snapshots } = useSnapshotStore();

  const [applyingConfigId, setApplyingConfigId] = useState<string | null>(null);

  const { configWritePending, updateConfigValue, resolveConfigValue } = useSharedConfigActions();
  const [activeSliders, setActiveSliders] = useState<Record<string, number>>({});

  const machineTaskBusy = machineTaskId !== null || pauseResumePending;
  const ramDumpFolderDisplayPath = ramDumpFolder
    ? (ramDumpFolder.displayPath ?? deriveRamDumpFolderDisplayPath(ramDumpFolder.treeUri, ramDumpFolder.rootName))
    : null;
  const ramDumpFolderLabel = ramDumpFolder?.rootName ?? ramDumpFolderDisplayPath ?? "...";

  const inlineSelectTriggerClass =
    "h-auto w-auto border-0 bg-transparent px-0 py-0 text-xs font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:hidden";
  const unavailableLabel = "Not available";

  const u64Category = u64SettingsCategory as Record<string, unknown> | undefined;
  const c64CartridgeConfig = c64CartridgeCategory as Record<string, unknown> | undefined;
  const ledStripConfig = ledStripCategory as Record<string, unknown> | undefined;
  const userInterfaceConfig = userInterfaceCategory as Record<string, unknown> | undefined;
  const keyboardLightingConfig = keyboardLightingCategory as Record<string, unknown> | undefined;
  const cartridgePreferenceOptions = readItemOptions(
    c64CartridgeConfig,
    "C64 and Cartridge Settings",
    "Cartridge Preference",
  ).map((value) => String(value));
  const cartridgePreferenceValue = String(
    resolveConfigValue(c64CartridgeConfig, "C64 and Cartridge Settings", "Cartridge Preference", unavailableLabel),
  );
  const videoModeOptions = readItemOptions(u64Category, "U64 Specific Settings", "System Mode").map((value) =>
    String(value),
  );
  const videoModeValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "System Mode", unavailableLabel),
  );
  const analogVideoOptions = readItemOptions(u64Category, "U64 Specific Settings", "Analog Video Mode").map((value) =>
    String(value),
  );
  const analogVideoValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "Analog Video Mode", unavailableLabel),
  );
  const hdmiResolutionOptions = readItemOptions(u64Category, "U64 Specific Settings", "HDMI Scan Resolution").map(
    (value) => String(value),
  );
  const hdmiResolutionValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "HDMI Scan Resolution", unavailableLabel),
  );
  const digitalVideoOptions = readItemOptions(u64Category, "U64 Specific Settings", "Digital Video Mode").map((value) =>
    String(value),
  );
  const digitalVideoValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "Digital Video Mode", unavailableLabel),
  );
  const hdmiScanOptions = readItemOptions(u64Category, "U64 Specific Settings", "HDMI Scan lines").map((value) =>
    String(value),
  );
  const hdmiScanValue = String(resolveConfigValue(u64Category, "U64 Specific Settings", "HDMI Scan lines", "Disabled"));
  const joystickSwapOptions = readItemOptions(u64Category, "U64 Specific Settings", "Joystick Swapper").map((value) =>
    String(value),
  );
  const joystickSwapValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "Joystick Swapper", "Normal"),
  );
  const serialBusModeOptions = readItemOptions(u64Category, "U64 Specific Settings", "Serial Bus Mode").map((value) =>
    String(value),
  );
  const serialBusModeValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "Serial Bus Mode", unavailableLabel),
  );
  const turboControlOptions = readItemOptions(u64Category, "U64 Specific Settings", "Turbo Control").map((value) =>
    String(value),
  );
  const turboControlValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "Turbo Control", turboControlOptions[0] ?? "Manual"),
  );
  const cpuSpeedOptions = readItemOptions(u64Category, "U64 Specific Settings", "CPU Speed").map((value) =>
    String(value),
  );
  const cpuSpeedValue = String(resolveConfigValue(u64Category, "U64 Specific Settings", "CPU Speed", "1"));
  const badlineTimingOptions = readItemOptions(u64Category, "U64 Specific Settings", "Badline Timing").map((value) =>
    String(value),
  );
  const badlineTimingValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "Badline Timing", unavailableLabel),
  );
  const superCpuDetectOptions = readItemOptions(u64Category, "U64 Specific Settings", "SuperCPU Detect (D0BC)").map(
    (value) => String(value),
  );
  const superCpuDetectValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "SuperCPU Detect (D0BC)", unavailableLabel),
  );
  const userPortPowerOptions = readItemOptions(u64Category, "U64 Specific Settings", "UserPort Power Enable").map(
    (value) => String(value),
  );
  const userPortPowerValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "UserPort Power Enable", unavailableLabel),
  );

  const handleCpuSpeedChange = trace(async function handleCpuSpeedChange(nextValue: string) {
    await updateConfigValue("U64 Specific Settings", "CPU Speed", nextValue, "HOME_CPU_SPEED", "CPU speed updated");

    if (turboControlOptions.length === 0) return;
    const desiredTurbo = resolveTurboControlValue(nextValue, turboControlOptions);
    if (normalizeOptionToken(desiredTurbo) === normalizeOptionToken(turboControlValue)) return;
    await updateConfigValue(
      "U64 Specific Settings",
      "Turbo Control",
      desiredTurbo,
      "HOME_TURBO_CONTROL",
      "Turbo control updated",
      { suppressToast: true },
    );
  });

  const handleSaveToApp = trace(async function handleSaveToApp(name: string) {
    try {
      await saveCurrentConfig(name);
      toast({ title: "Saved to app", description: name });
      setSaveDialogOpen(false);
    } catch (error) {
      reportUserError({
        operation: "APP_CONFIG_SAVE",
        title: "Error",
        description: (error as Error).message,
        error,
        context: { name },
      });
    }
  });

  const handleLoadFromApp = trace(async function handleLoadFromApp(configId: string) {
    const entry = appConfigs.find((config) => config.id === configId);
    if (!entry) return;
    setApplyingConfigId(configId);
    try {
      await loadAppConfig(entry);
      toast({ title: "Config loaded", description: entry.name });
      setLoadDialogOpen(false);
    } catch (error) {
      reportUserError({
        operation: "APP_CONFIG_LOAD",
        title: "Error",
        description: (error as Error).message,
        error,
        context: { name: entry.name },
      });
    } finally {
      setApplyingConfigId(null);
    }
  });

  const effectiveVideoModeOptions = videoModeOptions.length ? videoModeOptions : [videoModeValue];
  const effectiveAnalogVideoOptions = analogVideoOptions.length ? analogVideoOptions : [analogVideoValue];
  const effectiveHdmiResolutionOptions = hdmiResolutionOptions.length ? hdmiResolutionOptions : [hdmiResolutionValue];
  const effectiveDigitalVideoOptions = digitalVideoOptions.length ? digitalVideoOptions : [digitalVideoValue];
  const effectiveHdmiScanOptions = hdmiScanOptions.length ? hdmiScanOptions : [hdmiScanValue];
  const effectiveJoystickSwapOptions = joystickSwapOptions.length ? joystickSwapOptions : [joystickSwapValue];
  const effectiveSerialBusModeOptions = serialBusModeOptions.length ? serialBusModeOptions : [serialBusModeValue];
  const effectiveCartridgePreferenceOptions = cartridgePreferenceOptions.length
    ? cartridgePreferenceOptions
    : [cartridgePreferenceValue];
  const effectiveCpuSpeedOptions = cpuSpeedOptions.length ? cpuSpeedOptions : [cpuSpeedValue];
  const cpuSpeedSliderOptions = effectiveCpuSpeedOptions;
  const cpuSpeedSliderIndex = Math.max(
    0,
    cpuSpeedSliderOptions.findIndex((option) => option === cpuSpeedValue),
  );
  const cpuSpeedDisplayIndex = cpuSpeedDraftIndex ?? cpuSpeedSliderIndex;
  const resolveCpuSpeedOption = (index: number) =>
    cpuSpeedSliderOptions[Math.round(index)] ?? cpuSpeedSliderOptions[0] ?? "1";

  useEffect(() => {
    setCpuSpeedDraftIndex(null);
  }, [cpuSpeedValue]);
  const effectiveTurboControlOptions = turboControlOptions.length ? turboControlOptions : [turboControlValue];
  const effectiveBadlineTimingOptions = badlineTimingOptions.length ? badlineTimingOptions : [badlineTimingValue];
  const effectiveSuperCpuDetectOptions = superCpuDetectOptions.length ? superCpuDetectOptions : [superCpuDetectValue];
  const effectiveUserPortPowerOptions = userPortPowerOptions.length ? userPortPowerOptions : [userPortPowerValue];

  const displayedVideoModeValue = isActive ? videoModeValue : unavailableLabel;
  const displayedAnalogVideoValue = isActive ? analogVideoValue : unavailableLabel;
  const displayedHdmiResolutionValue = isActive ? hdmiResolutionValue : unavailableLabel;
  const displayedDigitalVideoValue = isActive ? digitalVideoValue : unavailableLabel;
  const displayedJoystickSwapValue = isActive ? joystickSwapValue : unavailableLabel;
  const displayedSerialBusModeValue = isActive ? serialBusModeValue : unavailableLabel;
  const displayedCartridgePreferenceValue = isActive ? cartridgePreferenceValue : unavailableLabel;
  const displayedTurboControlValue = isActive ? turboControlValue : unavailableLabel;
  const displayedBadlineTimingValue = isActive ? badlineTimingValue : unavailableLabel;
  const displayedSuperCpuDetectValue = isActive ? superCpuDetectValue : unavailableLabel;
  const displayedUserPortPowerValue = isActive ? userPortPowerValue : unavailableLabel;
  const displayedVideoModeOptions = isActive ? effectiveVideoModeOptions : [unavailableLabel];
  const displayedAnalogVideoOptions = isActive ? effectiveAnalogVideoOptions : [unavailableLabel];
  const displayedHdmiResolutionOptions = isActive ? effectiveHdmiResolutionOptions : [unavailableLabel];
  const displayedDigitalVideoOptions = isActive ? effectiveDigitalVideoOptions : [unavailableLabel];
  const displayedSerialBusModeOptions = isActive ? effectiveSerialBusModeOptions : [unavailableLabel];
  const displayedCartridgePreferenceOptions = isActive ? effectiveCartridgePreferenceOptions : [unavailableLabel];
  const displayedTurboControlOptions = isActive ? effectiveTurboControlOptions : [unavailableLabel];
  const displayedBadlineTimingOptions = isActive ? effectiveBadlineTimingOptions : [unavailableLabel];
  const displayedSuperCpuDetectOptions = isActive ? effectiveSuperCpuDetectOptions : [unavailableLabel];
  const displayedUserPortPowerOptions = isActive ? effectiveUserPortPowerOptions : [unavailableLabel];

  const ramDumpFolderCard = (
    <div className="flex items-center gap-2 text-sm" data-testid="home-ram-folder-row">
      <span className="text-muted-foreground">RAM Folder:</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto px-0 py-0 text-sm font-medium"
        onClick={() => void handleSelectRamDumpFolder()}
        disabled={folderTaskPending || machineTaskBusy}
        data-testid="ram-dump-folder-trigger"
      >
        {folderTaskPending ? "Changing…" : ramDumpFolderLabel}
      </Button>
    </div>
  );

  const cpuSpeedPending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "CPU Speed")]);
  const turboControlPending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "Turbo Control")]);
  const badlineTimingPending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "Badline Timing")]);
  const superCpuDetectPending = Boolean(
    configWritePending[buildConfigKey("U64 Specific Settings", "SuperCPU Detect (D0BC)")],
  );
  const videoModePending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "System Mode")]);
  const hdmiResolutionPending = Boolean(
    configWritePending[buildConfigKey("U64 Specific Settings", "HDMI Scan Resolution")],
  );
  const analogVideoPending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "Analog Video Mode")]);
  const digitalVideoPending = Boolean(
    configWritePending[buildConfigKey("U64 Specific Settings", "Digital Video Mode")],
  );
  const hdmiScanPending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "HDMI Scan lines")]);
  const joystickSwapPending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "Joystick Swapper")]);
  const serialBusModePending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "Serial Bus Mode")]);
  const userPortPowerPending = Boolean(
    configWritePending[buildConfigKey("U64 Specific Settings", "UserPort Power Enable")],
  );
  const cartridgePreferencePending = Boolean(
    configWritePending[buildConfigKey("C64 and Cartridge Settings", "Cartridge Preference")],
  );

  return (
    <div className="min-h-screen pb-24 pt-[var(--app-bar-height)]">
      <AppBar
        title="Home"
        leading={
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/c64commander.png"
              alt="C64 Commander"
              className="h-9 w-auto rounded-md shrink-0 object-contain"
              data-testid="home-header-logo"
            />
            <div className="min-w-0">
              <h1 className="c64-header text-xl truncate" data-testid="home-header-title">
                Home
              </h1>
              <p className="text-xs text-muted-foreground mt-1 truncate" data-testid="home-header-subtitle">
                C64 Commander
              </p>
            </div>
          </div>
        }
      />

      <main className="container py-5 space-y-4">
        {/* System Info */}
        <SystemInfo />

        {/* Machine */}
        <MachineControls
          status={status}
          machineTaskBusy={machineTaskBusy}
          machineExecutionState={machineExecutionState}
          setMachineExecutionState={setMachineExecutionState}
          controls={controls}
          pauseResumePending={pauseResumePending}
          machineTaskId={machineTaskId}
          onPauseResume={handlePauseResume}
          onSaveRam={() => setSaveRamDialogOpen(true)}
          onLoadRam={() => setSnapshotManagerOpen(true)}
          onRebootClearMemory={handleRebootClearMemory}
          onPowerOff={handlePowerOff}
          onAction={handleAction}
          footer={ramDumpFolderCard}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="space-y-2"
          data-section-label="Quick Config"
        >
          <SectionHeader title="Quick Config" />
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3" data-testid="home-quick-config">
              <SummaryConfigCard sectionLabel="CPU" title="CPU" testId="home-cpu-summary">
                <SummaryConfigControlRow
                  controlType="select"
                  disabled={!isActive || turboControlPending}
                  label="Turbo Control"
                  options={displayedTurboControlOptions}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-cpu-turbo-control"
                  value={displayedTurboControlValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "Turbo Control",
                      value,
                      "HOME_TURBO_CONTROL",
                      "Turbo control updated",
                    )
                  }
                />
                <div className="space-y-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">CPU Speed</span>
                    <span className="text-xs font-semibold text-foreground" data-testid="home-cpu-speed-value">
                      {cpuSpeedValue}
                    </span>
                  </div>
                  <Slider
                    value={[cpuSpeedDisplayIndex]}
                    min={0}
                    max={Math.max(cpuSpeedSliderOptions.length - 1, 0)}
                    step={1}
                    disabled={!isActive || cpuSpeedPending || cpuSpeedSliderOptions.length <= 1}
                    onValueChange={(values) => {
                      setCpuSpeedDraftIndex(values[0] ?? 0);
                    }}
                    onValueCommit={(values) => {
                      const nextIndex = values[0] ?? 0;
                      const nextValue = resolveCpuSpeedOption(nextIndex);
                      setCpuSpeedDraftIndex(null);
                      void handleCpuSpeedChange(String(nextValue));
                    }}
                    valueFormatter={(index) => resolveCpuSpeedOption(index)}
                    data-testid="home-cpu-speed-slider"
                  />
                </div>
                <SummaryConfigControlRow
                  disabled={!isActive || badlineTimingPending}
                  label="Badline Timing"
                  options={displayedBadlineTimingOptions}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-cpu-badline-timing"
                  value={displayedBadlineTimingValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "Badline Timing",
                      value,
                      "HOME_BADLINE_TIMING",
                      "Badline timing updated",
                    )
                  }
                />
                <SummaryConfigControlRow
                  disabled={!isActive || superCpuDetectPending}
                  label="SuperCPU Detect"
                  options={displayedSuperCpuDetectOptions}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-cpu-supercpu-detect"
                  value={displayedSuperCpuDetectValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "SuperCPU Detect (D0BC)",
                      value,
                      "HOME_SUPERCPU_DETECT",
                      "SuperCPU detect updated",
                    )
                  }
                />
              </SummaryConfigCard>

              <SummaryConfigCard sectionLabel="Ports" title="Ports" testId="home-ports-summary">
                <SummaryConfigControlRow
                  controlType="select"
                  disabled={!isActive || joystickSwapPending}
                  label="Joystick Input"
                  options={isActive ? effectiveJoystickSwapOptions : [unavailableLabel]}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-joystick-swapper"
                  value={displayedJoystickSwapValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "Joystick Swapper",
                      value,
                      "HOME_JOYSTICK_SWAPPER",
                      "Joystick input updated",
                    )
                  }
                />
                <SummaryConfigControlRow
                  controlType="select"
                  disabled={!isActive || serialBusModePending}
                  label="Serial Bus Mode"
                  options={displayedSerialBusModeOptions}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-serial-bus-mode"
                  value={displayedSerialBusModeValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "Serial Bus Mode",
                      value,
                      "HOME_SERIAL_BUS_MODE",
                      "Serial bus mode updated",
                    )
                  }
                />
                <SummaryConfigControlRow
                  controlType="select"
                  disabled={!isActive || cartridgePreferencePending}
                  label="Cartridge Preference"
                  options={displayedCartridgePreferenceOptions}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-cartridge-preference"
                  value={displayedCartridgePreferenceValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "C64 and Cartridge Settings",
                      "Cartridge Preference",
                      value,
                      "HOME_CARTRIDGE_PREFERENCE",
                      "Cartridge preference updated",
                    )
                  }
                />
                <SummaryConfigControlRow
                  controlType="checkbox"
                  disabled={!isActive || userPortPowerPending}
                  label="User Port Power"
                  options={displayedUserPortPowerOptions}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-user-port-power"
                  value={displayedUserPortPowerValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "UserPort Power Enable",
                      value,
                      "HOME_USER_PORT_POWER",
                      "User port power updated",
                    )
                  }
                />
              </SummaryConfigCard>

              <SummaryConfigCard sectionLabel="Video" title="Video" testId="home-video-summary">
                <SummaryConfigControlRow
                  controlType="select"
                  disabled={!isActive || videoModePending}
                  label="Video Mode"
                  options={displayedVideoModeOptions}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-video-mode"
                  value={displayedVideoModeValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "System Mode",
                      value,
                      "HOME_VIDEO_MODE",
                      "Video mode updated",
                    )
                  }
                />
                <SummaryConfigControlRow
                  controlType="select"
                  disabled={!isActive || hdmiResolutionPending}
                  label="HDMI Resolution"
                  options={displayedHdmiResolutionOptions}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-video-hdmi-resolution"
                  value={displayedHdmiResolutionValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "HDMI Scan Resolution",
                      value,
                      "HOME_HDMI_RESOLUTION",
                      "HDMI resolution updated",
                    )
                  }
                />
                <SummaryConfigControlRow
                  controlType="checkbox"
                  disabled={!isActive || hdmiScanPending}
                  label="HDMI Scan Lines"
                  options={isActive ? effectiveHdmiScanOptions : [unavailableLabel]}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-video-scanlines"
                  value={isActive ? hdmiScanValue : unavailableLabel}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "HDMI Scan lines",
                      value,
                      "HOME_HDMI_SCAN",
                      "HDMI scan lines updated",
                    )
                  }
                />
                <SummaryConfigControlRow
                  controlType="select"
                  disabled={!isActive || analogVideoPending}
                  label="Analog"
                  options={displayedAnalogVideoOptions}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-video-analog"
                  value={displayedAnalogVideoValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "Analog Video Mode",
                      value,
                      "HOME_ANALOG_VIDEO_MODE",
                      "Analog video mode updated",
                    )
                  }
                />
                <SummaryConfigControlRow
                  controlType="select"
                  disabled={!isActive || digitalVideoPending}
                  label="Digital"
                  options={displayedDigitalVideoOptions}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testId="home-video-digital"
                  value={displayedDigitalVideoValue}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      "U64 Specific Settings",
                      "Digital Video Mode",
                      value,
                      "HOME_DIGITAL_VIDEO_MODE",
                      "Digital video mode updated",
                    )
                  }
                />
              </SummaryConfigCard>
            </div>

            <div className="space-y-3" data-testid="home-secondary-cards">
              <UserInterfaceSummaryCard
                category="User Interface Settings"
                config={userInterfaceConfig}
                isActive={isActive}
                selectTriggerClassName={inlineSelectTriggerClass}
                testIdPrefix="home-user-interface"
              />
              <div data-testid="home-lighting-group">
                <SectionHeader title="LED LIGHTING" className="pt-1" />
              </div>
              <LightingSummaryCard
                category="LED Strip Settings"
                config={ledStripConfig}
                isActive={isActive}
                operationPrefix="HOME_LED"
                sectionLabel="Case Light"
                selectTriggerClassName={inlineSelectTriggerClass}
                successLabel="Case light"
                testIdPrefix="home-led"
              />
              <LightingSummaryCard
                category="Keyboard Lighting"
                config={keyboardLightingConfig}
                isActive={isActive}
                operationPrefix="HOME_KEYBOARD_LIGHTING"
                sectionLabel="Keyboard Light"
                selectTriggerClassName={inlineSelectTriggerClass}
                successLabel="Keyboard light"
                testIdPrefix="home-keyboard-lighting"
              />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-3"
          data-section-label="Drives"
        >
          <DriveManager
            isConnected={isActive}
            handleAction={handleAction}
            machineTaskBusy={machineTaskBusy}
            machineTaskId={machineTaskId}
            onResetDrives={handleResetDrives}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.34 }}
          className="space-y-3"
          data-section-label="Printers"
        >
          <PrinterManager
            isConnected={isActive}
            machineTaskBusy={machineTaskBusy}
            machineTaskId={machineTaskId}
            onResetPrinter={handleResetPrinter}
          />
        </motion.div>

        <AudioMixer isConnected={isActive} machineTaskBusy={machineTaskBusy} runMachineTask={runMachineTask} />

        <StreamStatus isConnected={isActive} />

        {/* Config Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-3"
          data-section-label="Config"
        >
          <SectionHeader title="Config">
            {isApplying && <span className="ml-2 text-xs text-muted-foreground">Applying…</span>}
          </SectionHeader>
          <div className="grid grid-cols-4 gap-2">
            <QuickActionCard
              icon={Save}
              label="Save"
              description="To flash"
              variant="success"
              compact
              onClick={() => handleAction(() => controls.saveConfig.mutateAsync(), "Config saved to flash")}
              disabled={!isActive || machineTaskBusy}
              loading={controls.saveConfig.isPending}
            />
            <QuickActionCard
              icon={RefreshCw}
              label="Load"
              description="From flash"
              compact
              onClick={() => handleAction(() => controls.loadConfig.mutateAsync(), "Config loaded from flash")}
              disabled={!isActive || machineTaskBusy}
              loading={controls.loadConfig.isPending}
            />
            <QuickActionCard
              icon={Trash2}
              label="Reset"
              description="To default"
              variant="danger"
              compact
              onClick={() => handleAction(() => controls.resetConfig.mutateAsync(), "Config reset to defaults")}
              disabled={!isActive || machineTaskBusy}
              loading={controls.resetConfig.isPending}
            />
            <QuickActionCard
              icon={Upload}
              label="Save"
              description="To App"
              variant="success"
              compact
              dataTestId="home-config-save-app"
              onClick={() => setSaveDialogOpen(true)}
              disabled={!isActive || isSaving || machineTaskBusy}
              loading={isSaving}
            />
            <QuickActionCard
              icon={Download}
              label="Load"
              description="From App"
              compact
              dataTestId="home-config-load-app"
              onClick={() => setLoadDialogOpen(true)}
              disabled={!isActive || appConfigs.length === 0 || machineTaskBusy}
            />
            <QuickActionCard
              icon={RotateCcw}
              label="Revert"
              description="Changes"
              compact
              dataTestId="home-config-revert-changes"
              onClick={() => handleAction(() => revertToInitial(), "Config reverted")}
              disabled={!isActive || isApplying || !hasChanges || machineTaskBusy}
              loading={isApplying}
            />
            <QuickActionCard
              icon={FolderOpen}
              label="Manage"
              description="App Configs"
              compact
              dataTestId="home-config-manage-app"
              onClick={() => setManageDialogOpen(true)}
              disabled={!isActive || appConfigs.length === 0 || machineTaskBusy}
            />
          </div>
        </motion.div>

        {/* Offline Message */}
        {!isActive && !status.isConnecting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center"
          >
            <p className="text-sm text-destructive font-medium">Unable to connect to C64U</p>
            <p className="text-xs text-muted-foreground mt-1">Check your connection settings</p>
          </motion.div>
        )}
      </main>

      <PowerOffDialog
        open={powerOffDialogOpen}
        onOpenChange={setPowerOffDialogOpen}
        onConfirm={() => void confirmPowerOff()}
        isPending={controls.powerOff.isPending}
      />

      <SaveConfigDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        existingNames={appConfigs.map((c) => c.name)}
        onSave={handleSaveToApp}
        isSaving={isSaving}
      />

      <LoadConfigDialog
        open={loadDialogOpen}
        onOpenChange={setLoadDialogOpen}
        configs={appConfigs}
        onLoad={handleLoadFromApp}
        applyingConfigId={applyingConfigId}
      />

      <ManageConfigDialog
        open={manageDialogOpen}
        onOpenChange={setManageDialogOpen}
        configs={appConfigs}
        onRename={renameAppConfig}
        onDelete={deleteAppConfig}
      />

      <SaveRamDialog
        open={saveRamDialogOpen}
        onOpenChange={setSaveRamDialogOpen}
        onSave={(type, customRanges) => {
          setSaveRamDialogOpen(false);
          void handleSaveRam(type, customRanges);
        }}
        isSaving={machineTaskId === "save-ram"}
      />

      <SnapshotManagerDialog
        open={snapshotManagerOpen}
        onOpenChange={setSnapshotManagerOpen}
        snapshots={snapshots}
        onRestore={(snapshot) => {
          setRestoreTarget(snapshot);
        }}
        onDelete={(id) => {
          handleDeleteSnapshot(id);
        }}
        onUpdateLabel={(id, label) => {
          handleUpdateSnapshotLabel(id, label);
        }}
      />

      <RestoreSnapshotDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        snapshot={restoreTarget}
        onConfirm={() => {
          if (restoreTarget) {
            setSnapshotManagerOpen(false);
            setRestoreTarget(null);
            void handleRestoreSnapshot(restoreTarget);
          }
        }}
        isPending={machineTaskId === "load-ram"}
      />
    </div>
  );
}
