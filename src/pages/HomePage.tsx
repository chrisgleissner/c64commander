/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  RotateCcw,
  Save,
  RefreshCw,
  Power,
  Trash2,
  Upload,
  Download,
  FolderOpen,
  AlertCircle,
  Gamepad2,
} from "lucide-react";
import { variant } from "@/generated/variant";
import { useC64ConfigItems, useC64Connection } from "@/hooks/useC64Connection";
import { useActionTrace } from "@/hooks/useActionTrace";
import { AppBar } from "@/components/AppBar";
import { QuickActionCard } from "@/components/QuickActionCard";
import { Button } from "@/components/ui/button";

import { SystemInfo } from "./home/components/SystemInfo";
import { MachineControls } from "./home/components/MachineControls";
import { AudioMixer } from "./home/components/AudioMixer";
import { StreamStatus } from "./home/components/StreamStatus";
import { LiveViewCard } from "@/components/streams/LiveViewCard";
import { DriveManager } from "./home/components/DriveManager";
import { HomeCpuSpeedSlider } from "./home/components/HomeCpuSpeedSlider";
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
import { createConfigWorkflow } from "@/lib/config/configWorkflow";
import {
  applyRemoteConfigFromPath,
  applyRemoteConfigFromTemp,
  saveRemoteConfigFromTemp,
} from "@/lib/config/configTelnetWorkflow";
import { persistConfigSnapshotFile, pickConfigSnapshotFile } from "@/lib/config/configSnapshotStorage";
import { SaveRamDialog } from "./home/dialogs/SaveRamDialog";
import { RestoreSnapshotDialog } from "./home/dialogs/RestoreSnapshotDialog";
import { SnapshotManagerDialog } from "./home/dialogs/SnapshotManagerDialog";
import { RemoteInputSheet } from "@/components/remoteInput/RemoteInputSheet";
import { ReuProgressDialog } from "./home/dialogs/ReuProgressDialog";
import { ClearFlashDialog } from "./home/dialogs/ClearFlashDialog";
import { useSnapshotStore } from "@/lib/snapshot/snapshotStore";
import { deriveRamDumpFolderDisplayPath } from "@/lib/config/ramDumpFolderStore";
import { useReuSnapshotStore, deleteReuSnapshotFromStore, updateReuSnapshotLabel } from "@/lib/reu/reuSnapshotStore";
import { createReuWorkflow } from "@/lib/reu/reuWorkflow";
import { deleteReuSnapshotFile } from "@/lib/reu/reuSnapshotStorage";
import { saveRemoteReuFromTemp, restoreRemoteReu } from "@/lib/reu/reuTelnetWorkflow";
import type { ReuProgressState, ReuRestoreMode } from "@/lib/reu/reuSnapshotTypes";
import { listFtpDirectory, readFtpFile, writeFtpFile } from "@/lib/ftp/ftpClient";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { getPassword } from "@/lib/secureStorage";
import { resolveDeviceHostFromStorage } from "@/lib/c64api";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { base64ToUint8 } from "@/lib/sid/sidUtils";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { createTelnetClient } from "@/lib/telnet/telnetClient";
import { getStoredTelnetPort } from "@/lib/telnet/telnetConfig";
import { resolveTelnetMenuKey } from "@/lib/telnet/telnetTypes";
import { ensureRamDumpFolder } from "@/lib/machine/ramDumpStorage";
import { isNativePlatform, getPlatform } from "@/lib/native/platform";
import type { RestorableSnapshotEntry } from "@/pages/home/types/restorableSnapshots";
import { isReuSnapshotEntry } from "@/pages/home/types/restorableSnapshots";

import {
  C64_CARTRIDGE_HOME_ITEMS,
  HOME_OPTION_DOMAIN_REFS,
  HOME_SUMMARY_QUERY_OPTIONS,
  KEYBOARD_LIGHTING_HOME_ITEMS,
  LED_STRIP_HOME_ITEMS,
  resolveHomeConfigOptions,
  U64_HOME_ITEMS,
  USER_INTERFACE_HOME_ITEMS,
} from "./home/constants";
import { buildOptionDomainKey, useDeviceConfigOptionDomains } from "./home/hooks/useDeviceConfigOptionDomains";

import { normalizeOptionToken } from "./home/utils/uiLogic";
import { buildConfigKey, readItemOptions } from "./home/utils/HomeConfigUtils";

import { SectionHeader } from "@/components/SectionHeader";
import { usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";
import { cn } from "@/lib/utils";
import { PageContainer, PageStack, ProfileActionGrid, ProfileSplitSection } from "@/components/layout/PageContainer";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { useLightingStudio } from "@/hooks/useLightingStudio";
import { useTelnetActions } from "@/hooks/useTelnetActions";
import { TELNET_ACTIONS, type TelnetActionId } from "@/lib/telnet/telnetTypes";
import { withTelnetInteraction } from "@/lib/deviceInteraction/deviceInteractionManager";
import { publishMachineInterrupt } from "@/lib/deviceInteraction/machineInterrupt";
import {
  getMachineExecutionSnapshot,
  resumeMachineExecutionIfPausedBy,
  setMachineExecutionPaused,
} from "@/lib/deviceInteraction/machineExecutionStore";
import { beginMachineTransition } from "@/lib/deviceInteraction/deviceActivityGate";
import { getActiveAction, runWithImplicitAction } from "@/lib/tracing/actionTrace";
import {
  isDeviceControlError,
  useDeviceControl,
  type DeviceControlOperation,
  type DeviceControlResult,
} from "@/lib/deviceControl/deviceControl";
import { deriveDeviceCapabilities, detectStreamingFromConfig } from "@/lib/deviceCapabilities";
import { STREAM_ITEMS } from "@/lib/config/homeStreams";

// HARD18-012b: the Ultimate's entire network stack is down for the whole
// boot duration after a real power cycle - long enough that, unsuppressed,
// two failed polls trip the CONSERVATIVE circuit breaker (threshold 2)
// seconds after the app told the user "Power cycled". Bounded so a device
// that is genuinely still unreachable once this elapses still surfaces.
const POWER_CYCLE_EXPECTED_OUTAGE_MS = 18_000;

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
  const [keyboardLightingRequested, setKeyboardLightingRequested] = useState(true);

  const { data: u64SettingsCategory } = useC64ConfigItems(
    "U64 Specific Settings",
    [...U64_HOME_ITEMS],
    isActive || status.isConnecting,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const { data: c64CartridgeCategory } = useC64ConfigItems(
    "C64 and Cartridge Settings",
    [...C64_CARTRIDGE_HOME_ITEMS],
    isActive || status.isConnecting,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const { data: ledStripCategory } = useC64ConfigItems(
    "LED Strip Settings",
    [...LED_STRIP_HOME_ITEMS],
    isActive || status.isConnecting,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const { data: userInterfaceCategory } = useC64ConfigItems(
    "User Interface Settings",
    [...USER_INTERFACE_HOME_ITEMS],
    isActive || status.isConnecting,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const { data: keyboardLightingCategory } = useC64ConfigItems(
    "Keyboard Lighting",
    [...KEYBOARD_LIGHTING_HOME_ITEMS],
    (isActive || status.isConnecting) && keyboardLightingRequested,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  // Read-only Data Streams probe used to drive the streaming capability. Shares a
  // react-query key with StreamStatus' own read, so this does not add a fetch.
  const { data: dataStreamsCategory } = useC64ConfigItems(
    "Data Streams",
    [...STREAM_ITEMS],
    isActive || status.isConnecting,
    HOME_SUMMARY_QUERY_OPTIONS,
  );

  // Dynamic device capabilities. Feature gates below consume these predicates
  // (supportsStreaming / supportsPowerCycle) rather than raw product-family literals.
  // Capabilities are runtime-derived: streaming from the Data Streams config (VIC/Audio
  // items), else from /v1/info core_version presence (the U64-family marker); power-cycle
  // and Power Off likewise from core_version. No product-family literal gates any feature —
  // a U2 cartridge (no core_version, no /v1/streams) is correctly excluded unless its own
  // config advertises streaming.
  const deviceCapabilities = deriveDeviceCapabilities({
    product: status.deviceInfo?.product,
    firmwareVersion: status.deviceInfo?.firmware_version,
    coreVersion: status.deviceInfo?.core_version,
    streamEndpointsAdvertised: detectStreamingFromConfig(dataStreamsCategory as Record<string, unknown> | undefined),
  });

  const {
    controls,
    machineTaskId,
    machineExecutionState,
    pauseResumePending,
    folderTaskPending,
    powerOffDialogOpen,
    setPowerOffDialogOpen,
    ramDumpFolder,
    handleAction,
    handlePauseResume,
    handleSaveRam,
    handleSaveCpuSnapshot,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
    handleUpdateSnapshotLabel,
    handlePowerOff,
    confirmPowerOff,
    handleSelectRamDumpFolder,
    handleResetDrives,
    handleResetPrinter,
    runMachineTask,
  } = useHomeActions();
  const telnet = useTelnetActions();
  const deviceControl = useDeviceControl({ connected: status.isConnected });
  const {
    appConfigs,
    hasChanges,
    fetchError: configFetchError,
    isApplying,
    isSaving,
    revertToInitial,
    saveCurrentConfig,
    loadAppConfig,
    renameAppConfig,
    deleteAppConfig,
    captureInitialSnapshot,
  } = useAppConfigState();
  const trace = useActionTrace("HomePage");

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [saveRamDialogOpen, setSaveRamDialogOpen] = useState(false);
  const [clearFlashDialogOpen, setClearFlashDialogOpen] = useState(false);
  const [snapshotManagerOpen, setSnapshotManagerOpen] = useState(false);
  const [remoteInputSheetOpen, setRemoteInputSheetOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<RestorableSnapshotEntry | null>(null);
  const [reuProgress, setReuProgress] = useState<ReuProgressState | null>(null);
  const [reuTaskPending, setReuTaskPending] = useState(false);
  const [deviceControlActionId, setDeviceControlActionId] = useState<DeviceControlOperation | null>(null);
  const [configFileTaskPending, setConfigFileTaskPending] = useState<"save" | "load" | null>(null);
  const { snapshots } = useSnapshotStore();
  const { snapshots: reuSnapshots } = useReuSnapshotStore();

  const [applyingConfigId, setApplyingConfigId] = useState<string | null>(null);

  const { configWritePending, updateConfigValue, resolveConfigValue } = useSharedConfigActions();
  const {
    openStudio,
    openContextLens,
    resolved: lightingResolved,
    manualLockEnabled,
    lockCurrentLook,
    unlockCurrentLook,
    markManualLightingChange,
    isActiveProfileModified,
  } = useLightingStudio();
  const handleOpenStudio = () => {
    setKeyboardLightingRequested(true);
    openStudio();
  };
  const handleOpenContextLens = () => {
    setKeyboardLightingRequested(true);
    openContextLens();
  };
  const { value: lightingStudioEnabled } = useFeatureFlag("lighting_studio_enabled");
  const { value: remoteInputEnabled } = useFeatureFlag("remote_input_enabled");
  const { value: reuSnapshotEnabled } = useFeatureFlag("home_telnet_reu_snapshot_enabled");
  const { value: ramSnapshotsEnabled } = useFeatureFlag("ram_snapshots_enabled");
  const { value: homeTelnetConfigActionsEnabled } = useFeatureFlag("home_telnet_config_actions_enabled");
  const { value: homeTelnetDriveActionsEnabled } = useFeatureFlag("home_telnet_drive_actions_enabled");
  const { value: homeTelnetPrinterActionsEnabled } = useFeatureFlag("home_telnet_printer_actions_enabled");
  const { value: homeTelnetPowerCycleEnabled } = useFeatureFlag("home_telnet_power_cycle_enabled");
  const { value: homeTelnetClearRamRebootEnabled } = useFeatureFlag("home_telnet_clear_ram_reboot_enabled");
  const { value: liveViewEnabled } = useFeatureFlag("live_view_enabled");
  const { value: audioMirrorEnabled } = useFeatureFlag("audio_mirror_enabled");
  const { value: videoMirrorEnabled } = useFeatureFlag("video_mirror_enabled");
  const { value: avSyncTestsEnabled } = useFeatureFlag("av_sync_tests_enabled");
  const deviceControlBusy = deviceControlActionId !== null;
  const machineTaskBusy = machineTaskId !== null || pauseResumePending || deviceControlBusy || reuTaskPending;
  const allSnapshots: RestorableSnapshotEntry[] = [...snapshots, ...(reuSnapshotEnabled ? reuSnapshots : [])].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const getTelnetSupport = (actionId: TelnetActionId) => telnet.getActionSupport(actionId);
  const getTelnetDisabledReason = (actionId: TelnetActionId) => {
    const support = getTelnetSupport(actionId);
    return support.status === "supported"
      ? null
      : (support.reason ?? `${TELNET_ACTIONS[actionId].label} is unavailable.`);
  };
  const getRequiredTelnetTarget = (actionId: TelnetActionId) => {
    const support = getTelnetSupport(actionId);
    if (support.status !== "supported" || !support.target) {
      throw new Error(support.reason ?? `${TELNET_ACTIONS[actionId].label} is unavailable on this device.`);
    }
    return support.target;
  };
  const powerCycleSupportedByProduct = deviceCapabilities.supportsPowerCycle;
  const powerCycleSupport = telnet.isAvailable ? getTelnetSupport("powerCycle") : null;
  const powerCycleVisible = homeTelnetPowerCycleEnabled && powerCycleSupportedByProduct && telnet.isAvailable;
  const powerCycleDisabledReason =
    powerCycleSupport?.status === "unsupported"
      ? (powerCycleSupport.reason ?? `${TELNET_ACTIONS.powerCycle.label} is unavailable.`)
      : null;
  const saveReuDisabledReason = telnet.isAvailable ? getTelnetDisabledReason("saveReuMemory") : null;
  const saveConfigDisabledReason = telnet.isAvailable ? getTelnetDisabledReason("saveConfigToFile") : null;
  const clearFlashDisabledReason = telnet.isAvailable ? getTelnetDisabledReason("clearFlashConfig") : null;

  const uint8ToBase64 = (value: Uint8Array) => {
    let binary = "";
    value.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  };

  const resolveFtpOptions = async () => {
    const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
    const password = await getPassword();
    return {
      host,
      port: getStoredFtpPort(),
      username: "user",
      password: password ?? "",
    };
  };

  const withConnectedReuTelnetSession = async <T,>(
    callback: (session: ReturnType<typeof createTelnetSession>, menuKey: "F5" | "F1") => Promise<T>,
  ) => {
    if (!telnet.isAvailable) {
      throw new Error("Telnet is unavailable for REU actions on this device.");
    }
    const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
    const port = getStoredTelnetPort();
    const password = await getPassword();
    const transport = createTelnetClient();
    const session = createTelnetSession(transport);
    const menuKey = resolveTelnetMenuKey(status.deviceInfo?.product) ?? "F5";

    const runSession = async () => {
      await session.connect(host, port, password ?? undefined);
      try {
        return await callback(session, menuKey);
      } finally {
        await session.disconnect();
      }
    };
    const activeAction = getActiveAction();
    if (activeAction) {
      return withTelnetInteraction(
        { action: activeAction, actionId: "home-reu-workflow", intent: "user", host, port },
        runSession,
      );
    }
    return runWithImplicitAction("home.reu.telnet", (action) =>
      withTelnetInteraction({ action, actionId: "home-reu-workflow", intent: "user", host, port }, runSession),
    );
  };

  const createHomeReuWorkflow = () =>
    createReuWorkflow({
      ensureLocalSnapshotStorage: async () => {
        if (!isNativePlatform()) {
          throw new Error("REU snapshots are only supported on native builds.");
        }
        if (getPlatform() === "android") {
          await ensureRamDumpFolder();
        }
      },
      listRemoteTempFiles: async () => {
        const ftpOptions = await resolveFtpOptions();
        const result = await listFtpDirectory({ ...ftpOptions, path: "/Temp" });
        return result.entries
          .filter((entry) => entry.type === "file")
          .map((entry) => ({
            name: entry.name,
            path: entry.path,
            size: entry.size,
            modifiedAt: entry.modifiedAt,
          }));
      },
      listRemoteStorageRoots: async () => {
        const ftpOptions = await resolveFtpOptions();
        const result = await listFtpDirectory({ ...ftpOptions, path: "/" });
        return result.entries.filter((entry) => entry.type === "dir").map((entry) => entry.name);
      },
      readRemoteFile: async (path) => {
        const ftpOptions = await resolveFtpOptions();
        const result = await readFtpFile({ ...ftpOptions, path });
        return base64ToUint8(result.data);
      },
      writeRemoteFile: async (path, bytes) => {
        const ftpOptions = await resolveFtpOptions();
        await writeFtpFile({
          ...ftpOptions,
          path,
          data: uint8ToBase64(bytes),
        });
      },
      runSaveRemoteReu: () =>
        withConnectedReuTelnetSession((session, menuKey) =>
          saveRemoteReuFromTemp(session, menuKey, getRequiredTelnetTarget("saveReuMemory")),
        ),
      runRestoreRemoteReu: (fileName, mode, folderName) =>
        withConnectedReuTelnetSession((session, menuKey) =>
          restoreRemoteReu(session, menuKey, fileName, mode, folderName),
        ),
    });

  const withConnectedConfigTelnetSession = async <T,>(
    callback: (session: ReturnType<typeof createTelnetSession>, menuKey: "F5" | "F1") => Promise<T>,
  ) => {
    if (!telnet.isAvailable) {
      throw new Error("Telnet is unavailable for config file actions on this device.");
    }
    const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
    const port = getStoredTelnetPort();
    const password = await getPassword();
    const transport = createTelnetClient();
    const session = createTelnetSession(transport);
    const menuKey = resolveTelnetMenuKey(status.deviceInfo?.product) ?? "F5";

    const runSession = async () => {
      await session.connect(host, port, password ?? undefined);
      try {
        return await callback(session, menuKey);
      } finally {
        await session.disconnect();
      }
    };
    const activeAction = getActiveAction();
    if (activeAction) {
      return withTelnetInteraction(
        { action: activeAction, actionId: "home-config-file-workflow", intent: "user", host, port },
        runSession,
      );
    }
    return runWithImplicitAction("home.config-file.telnet", (action) =>
      withTelnetInteraction({ action, actionId: "home-config-file-workflow", intent: "user", host, port }, runSession),
    );
  };

  const createHomeConfigFileWorkflow = () =>
    createConfigWorkflow({
      ensureLocalSnapshotStorage: async () => {
        if (!isNativePlatform()) {
          throw new Error("Config snapshots are only supported on native builds.");
        }
        if (getPlatform() === "android") {
          await ensureRamDumpFolder();
        }
      },
      listRemoteTempFiles: async () => {
        const ftpOptions = await resolveFtpOptions();
        const result = await listFtpDirectory({ ...ftpOptions, path: "/Temp" });
        return result.entries
          .filter((entry) => entry.type === "file")
          .map((entry) => ({
            name: entry.name,
            path: entry.path,
            size: entry.size,
            modifiedAt: entry.modifiedAt,
          }));
      },
      readRemoteFile: async (path) => {
        const ftpOptions = await resolveFtpOptions();
        const result = await readFtpFile({ ...ftpOptions, path });
        return base64ToUint8(result.data);
      },
      writeRemoteFile: async (path, bytes) => {
        const ftpOptions = await resolveFtpOptions();
        await writeFtpFile({
          ...ftpOptions,
          path,
          data: uint8ToBase64(bytes),
        });
      },
      persistLocalSnapshot: persistConfigSnapshotFile,
      runSaveRemoteConfig: () =>
        withConnectedConfigTelnetSession((session, menuKey) =>
          saveRemoteConfigFromTemp(session, menuKey, getRequiredTelnetTarget("saveConfigToFile")),
        ),
      runApplyRemoteConfig: (fileName) =>
        withConnectedConfigTelnetSession((session, menuKey) => applyRemoteConfigFromTemp(session, menuKey, fileName)),
      runApplyRemoteConfigByPath: (path) =>
        withConnectedConfigTelnetSession((session, menuKey) => applyRemoteConfigFromPath(session, menuKey, path)),
    });

  const runReuWorkflow = async <T,>(
    operation: string,
    failureTitle: string,
    successTitle: string,
    runner: () => Promise<T>,
    successDescription?: (result: T) => string | undefined,
  ) => {
    setReuTaskPending(true);
    try {
      const result = await runner();
      toast({ title: successTitle, description: successDescription?.(result) });
      return result;
    } catch (error) {
      reportUserError({
        operation,
        title: failureTitle,
        description: (error as Error).message,
        error,
      });
      return undefined;
    } finally {
      setReuTaskPending(false);
      setReuProgress(null);
    }
  };

  const handleDeleteStoredSnapshot = async (snapshot: RestorableSnapshotEntry) => {
    if (isReuSnapshotEntry(snapshot)) {
      await deleteReuSnapshotFile(snapshot);
      deleteReuSnapshotFromStore(snapshot.id);
      return;
    }
    handleDeleteSnapshot(snapshot.id);
  };

  const handleUpdateStoredSnapshotLabel = (snapshot: RestorableSnapshotEntry, label: string) => {
    if (isReuSnapshotEntry(snapshot)) {
      updateReuSnapshotLabel(snapshot.id, label);
      return;
    }
    handleUpdateSnapshotLabel(snapshot.id, label);
  };

  const executeTelnetAction = async ({
    actionId,
    successTitle,
    failureOperation,
    failureTitle,
    onSuccess,
  }: {
    actionId: TelnetActionId;
    successTitle: string;
    failureOperation: string;
    failureTitle: string;
    onSuccess?: () => void;
  }) => {
    try {
      await telnet.executeAction(actionId);
      toast({ title: successTitle });
      onSuccess?.();
    } catch (error) {
      reportUserError({
        operation: failureOperation,
        title: failureTitle,
        description: (error as Error).message,
        error,
        context: { actionId },
      });
    }
  };

  const executeDeviceControl = async <T extends DeviceControlResult>({
    actionId,
    run,
    successTitle,
    failureOperation,
    failureTitle,
    onSuccess,
  }: {
    actionId: DeviceControlOperation;
    run: () => Promise<T>;
    successTitle: string | ((result: T) => string);
    failureOperation: string;
    failureTitle: string;
    onSuccess?: (result: T) => void;
  }) => {
    setDeviceControlActionId(actionId);
    try {
      const result = await run();
      toast({ title: typeof successTitle === "function" ? successTitle(result) : successTitle });
      onSuccess?.(result);
    } catch (error) {
      reportUserError({
        operation: failureOperation,
        title: failureTitle,
        description: (error as Error).message,
        error,
        context: isDeviceControlError(error)
          ? {
              deviceControlOperation: error.operation,
              transport: error.transport,
              endpoint: error.endpoint,
              request: error.request,
              response: error.response,
            }
          : undefined,
      });
    } finally {
      setDeviceControlActionId((current) => (current === actionId ? null : current));
    }
  };

  const handlePowerCycle = async () => {
    if (!status.isConnected || machineTaskBusy || telnet.isBusy) return;
    await executeTelnetAction({
      actionId: "powerCycle",
      successTitle: "Power cycled",
      failureOperation: "HOME_POWER_CYCLE",
      failureTitle: "Power cycle failed",
      // HARD18-022 (M3): stop any armed Play session in place instead of
      // letting auto-advance relaunch content on the freshly power-cycled
      // machine once the current track's nominal duration elapses.
      onSuccess: () => {
        // HARD18-022: stop an armed Play session in place. HARD19-032:
        // publishMachineInterrupt also restores a pending pause-mute and sets
        // "running" synchronously, so a power-cycle-while-paused does not strand
        // the SID mixer muted.
        void publishMachineInterrupt({ reason: "home-reset", label: "Power cycle" });
        // HARD18-012b: arm the expected-outage window now, at the moment the
        // boot outage actually begins - begin+immediately-end applies the
        // cooldown starting from right now rather than leaving the
        // transition "active" indefinitely.
        beginMachineTransition(POWER_CYCLE_EXPECTED_OUTAGE_MS)();
      },
    });
  };

  const handleRebootClearMemory = async () => {
    if (!status.isConnected || machineTaskBusy || telnet.isBusy) return;
    await executeTelnetAction({
      actionId: "rebootClearMemory",
      successTitle: "Machine rebooting",
      failureOperation: "HOME_REBOOT_CLEAR_MEMORY",
      failureTitle: "Reboot failed",
      // HARD18-022 (M3): see handlePowerCycle above. HARD19-032: restore a
      // pending pause-mute via publishMachineInterrupt.
      onSuccess: () => {
        void publishMachineInterrupt({ reason: "home-reset", label: "Reboot (Clr Mem)" });
      },
    });
  };

  const handleReboot = async () => {
    if (!status.isConnected || machineTaskBusy || telnet.isBusy) return;
    await executeDeviceControl({
      actionId: "rebootKeepRam",
      run: () => deviceControl.rebootKeepRam(),
      successTitle: "Machine rebooting",
      failureOperation: "HOME_REBOOT_KEEP_MEMORY",
      failureTitle: "Reboot failed",
      // HARD18-022 (M3): see handlePowerCycle above. HARD19-032: restore a
      // pending pause-mute via publishMachineInterrupt.
      onSuccess: () => {
        void publishMachineInterrupt({ reason: "home-reset", label: "Reboot" });
      },
    });
  };

  const handleMenuToggle = async () => {
    if (!status.isConnected || machineTaskBusy || telnet.isBusy) return;
    await executeDeviceControl({
      actionId: "toggleMenu",
      run: () => deviceControl.toggleMenu(),
      successTitle: (result) => (result.menuOpen ? "Menu opened" : "Menu closed"),
      failureOperation: "HOME_MENU_TOGGLE",
      failureTitle: "Menu toggle failed",
      onSuccess: (result) => {
        // HARD20-009: the Ultimate menu freezes the running machine, so mirror
        // that temporary state into Play's existing pause-timeline contract.
        // HARD21-004: tag the menu freeze with source "menu" and resume ONLY a
        // menu-induced pause on close — never a pause the user set from Play or
        // Home (those carry a different source). On open, only pause if the
        // machine is actually running, so an existing user pause keeps its own
        // source (never overwrite it to "menu"), leaving it untouched on close.
        if (result.menuOpen) {
          if (getMachineExecutionSnapshot().state === "running") {
            setMachineExecutionPaused({ pausedBy: "menu" });
          }
        } else {
          resumeMachineExecutionIfPausedBy("menu");
        }
      },
    });
  };

  const handleSaveReu = async () => {
    if (!status.isConnected || machineTaskBusy || telnet.isBusy) return;
    const workflow = createHomeReuWorkflow();
    await runReuWorkflow(
      "HOME_SAVE_REU",
      "Save REU failed",
      "REU snapshot saved",
      () => workflow.saveSnapshot((progress) => setReuProgress(progress)),
      (result) => result.metadata.content_name,
    );
  };

  const handleConfirmRestore = async (mode?: ReuRestoreMode) => {
    if (!restoreTarget) return;
    setSnapshotManagerOpen(false);
    setRestoreTarget(null);
    if (!isReuSnapshotEntry(restoreTarget)) {
      await handleRestoreSnapshot(restoreTarget);
      return;
    }

    const resolvedMode = mode ?? "load-into-reu";
    const workflow = createHomeReuWorkflow();
    const reuResult = await runReuWorkflow(
      "HOME_RESTORE_REU",
      "Restore REU failed",
      mode === "preload-on-startup" ? "REU preload configured" : "REU image loaded",
      () => workflow.restoreSnapshot(restoreTarget, resolvedMode, (progress) => setReuProgress(progress)),
      () => restoreTarget.metadata.content_name,
    );
    // HARD19-011: loading a REU image into the live session repurposes the
    // machine, so stop an armed Play session in place instead of letting
    // auto-advance launch over it. "preload-on-startup" only configures the next
    // boot and changes nothing now, so it does not take over the machine.
    if (reuResult !== undefined && resolvedMode === "load-into-reu") {
      void publishMachineInterrupt({
        reason: "home-reset",
        label: restoreTarget.metadata.content_name || "REU image",
      });
    }
  };

  const clearRamRebootSupport = telnet.isAvailable ? getTelnetSupport("rebootClearMemory") : null;
  const clearRamRebootVisible =
    homeTelnetClearRamRebootEnabled && telnet.isAvailable && clearRamRebootSupport?.status !== "unsupported";
  const machineExtraActions = [
    ...(remoteInputEnabled
      ? [
          {
            id: "openRemoteInput",
            label: "Remote Input",
            icon: Gamepad2,
            onSelect: () => setRemoteInputSheetOpen(true),
            disabled: !isActive,
          },
        ]
      : []),
    ...(clearRamRebootVisible
      ? [
          {
            id: "rebootClearMemory",
            label: "Reboot (Clr Mem)",
            icon: Power,
            variant: "danger" as const,
            className: "border-destructive/40 bg-destructive/[0.04]",
            onSelect: handleRebootClearMemory,
            disabled: !isActive || machineTaskBusy || telnet.isBusy,
            loading: telnet.activeActionId === "rebootClearMemory",
          },
        ]
      : []),
    ...(reuSnapshotEnabled
      ? [
          {
            id: "saveReuMemory",
            label: TELNET_ACTIONS.saveReuMemory.label,
            icon: Save,
            onSelect: handleSaveReu,
            disabled: !isActive || machineTaskBusy || telnet.isBusy || saveReuDisabledReason !== null,
            loading: telnet.activeActionId === "saveReuMemory",
            reason: saveReuDisabledReason,
          },
        ]
      : []),
  ];

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

  // Permitted values for every summary dropdown are interrogated from the concrete device
  // (cached per-firmware); we never present hard-coded, model-specific option lists.
  const optionDomains = useDeviceConfigOptionDomains("home-summary", HOME_OPTION_DOMAIN_REFS, isActive);
  const optionsFor = (category: string, itemName: string, liveOptions: string[], fallbackValue: string) =>
    resolveHomeConfigOptions(
      liveOptions,
      optionDomains[buildOptionDomainKey(category, itemName)]?.options,
      fallbackValue,
    );
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
  const ramExpansionOptions = readItemOptions(
    c64CartridgeConfig,
    "C64 and Cartridge Settings",
    "RAM Expansion Unit",
  ).map((value) => String(value));
  const ramExpansionValue = String(
    resolveConfigValue(c64CartridgeConfig, "C64 and Cartridge Settings", "RAM Expansion Unit", unavailableLabel),
  );
  const reuSizeOptions = readItemOptions(c64CartridgeConfig, "C64 and Cartridge Settings", "REU Size").map((value) =>
    String(value),
  );
  const reuSizeValue = String(
    resolveConfigValue(c64CartridgeConfig, "C64 and Cartridge Settings", "REU Size", unavailableLabel),
  );
  const userPortPowerOptions = readItemOptions(u64Category, "U64 Specific Settings", "UserPort Power Enable").map(
    (value) => String(value),
  );
  const userPortPowerValue = String(
    resolveConfigValue(u64Category, "U64 Specific Settings", "UserPort Power Enable", unavailableLabel),
  );

  const handleSaveToApp = trace(async function handleSaveToApp(name: string) {
    try {
      const { failedCategories } = await saveCurrentConfig(name);
      if (failedCategories.length > 0) {
        // HARD19-023: don't claim the full setup was saved when categories were unreadable.
        toast({
          title: "Saved to app — some settings couldn't be read",
          description: `Not saved: ${failedCategories.join(", ")}. Try again when the device is idle for a complete profile.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Saved to app", description: name });
      }
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

  const localConfigFileActionsAvailable = telnet.isAvailable && isNativePlatform();
  const advancedHomeConfigActionsVisible = homeTelnetConfigActionsEnabled;

  const handleSaveToFile = trace(async function handleSaveToFile() {
    setConfigFileTaskPending("save");
    try {
      const workflow = createHomeConfigFileWorkflow();
      const result = await workflow.saveSnapshot();
      toast({ title: "Config saved to file", description: result.fileName });
    } catch (error) {
      reportUserError({
        operation: "HOME_CONFIG_SAVE_FILE",
        title: "Save config to file failed",
        description: (error as Error).message,
        error,
      });
    } finally {
      setConfigFileTaskPending(null);
    }
  });

  const handleLoadFromFile = trace(async function handleLoadFromFile() {
    setConfigFileTaskPending("load");
    try {
      const picked = await pickConfigSnapshotFile({ preferredFolder: ramDumpFolder });
      const workflow = createHomeConfigFileWorkflow();
      await workflow.applyLocalSnapshot(picked.name, picked.bytes);
      toast({ title: "Config loaded from file", description: picked.name });
    } catch (error) {
      reportUserError({
        operation: "HOME_CONFIG_LOAD_FILE",
        title: "Load config from file failed",
        description: (error as Error).message,
        error,
      });
    } finally {
      setConfigFileTaskPending(null);
    }
  });

  const effectiveVideoModeOptions = optionsFor(
    "U64 Specific Settings",
    "System Mode",
    videoModeOptions,
    videoModeValue,
  );
  const effectiveAnalogVideoOptions = optionsFor(
    "U64 Specific Settings",
    "Analog Video Mode",
    analogVideoOptions,
    analogVideoValue,
  );
  const effectiveHdmiResolutionOptions = optionsFor(
    "U64 Specific Settings",
    "HDMI Scan Resolution",
    hdmiResolutionOptions,
    hdmiResolutionValue,
  );
  const effectiveDigitalVideoOptions = optionsFor(
    "U64 Specific Settings",
    "Digital Video Mode",
    digitalVideoOptions,
    digitalVideoValue,
  );
  const effectiveHdmiScanOptions = optionsFor(
    "U64 Specific Settings",
    "HDMI Scan lines",
    hdmiScanOptions,
    hdmiScanValue,
  );
  const effectiveJoystickSwapOptions = optionsFor(
    "U64 Specific Settings",
    "Joystick Swapper",
    joystickSwapOptions,
    joystickSwapValue,
  );
  const effectiveSerialBusModeOptions = optionsFor(
    "U64 Specific Settings",
    "Serial Bus Mode",
    serialBusModeOptions,
    serialBusModeValue,
  );
  const effectiveCartridgePreferenceOptions = optionsFor(
    "C64 and Cartridge Settings",
    "Cartridge Preference",
    cartridgePreferenceOptions,
    cartridgePreferenceValue,
  );
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
  const effectiveCpuSpeedOptions = optionsFor("U64 Specific Settings", "CPU Speed", cpuSpeedOptions, cpuSpeedValue);
  const effectiveTurboControlOptions = optionsFor(
    "U64 Specific Settings",
    "Turbo Control",
    turboControlOptions,
    turboControlValue,
  );
  const effectiveBadlineTimingOptions = optionsFor(
    "U64 Specific Settings",
    "Badline Timing",
    badlineTimingOptions,
    badlineTimingValue,
  );
  const effectiveSuperCpuDetectOptions = optionsFor(
    "U64 Specific Settings",
    "SuperCPU Detect (D0BC)",
    superCpuDetectOptions,
    superCpuDetectValue,
  );
  const effectiveRamExpansionOptions = optionsFor(
    "C64 and Cartridge Settings",
    "RAM Expansion Unit",
    ramExpansionOptions,
    ramExpansionValue,
  );
  const effectiveReuSizeOptions = optionsFor("C64 and Cartridge Settings", "REU Size", reuSizeOptions, reuSizeValue);
  const effectiveUserPortPowerOptions = optionsFor(
    "U64 Specific Settings",
    "UserPort Power Enable",
    userPortPowerOptions,
    userPortPowerValue,
  );

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
  const displayedRamExpansionValue = isActive ? ramExpansionValue : unavailableLabel;
  const displayedReuSizeValue = isActive ? reuSizeValue : unavailableLabel;
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
  const displayedRamExpansionOptions = isActive ? effectiveRamExpansionOptions : [unavailableLabel];
  const displayedReuSizeOptions = isActive ? effectiveReuSizeOptions : [unavailableLabel];
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
  const hdmiScanPending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "HDMI Scan lines")]);
  const joystickSwapPending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "Joystick Swapper")]);
  const serialBusModePending = Boolean(configWritePending[buildConfigKey("U64 Specific Settings", "Serial Bus Mode")]);
  const userPortPowerPending = Boolean(
    configWritePending[buildConfigKey("U64 Specific Settings", "UserPort Power Enable")],
  );
  const cartridgePreferencePending = Boolean(
    configWritePending[buildConfigKey("C64 and Cartridge Settings", "Cartridge Preference")],
  );
  const ramExpansionPending = Boolean(
    configWritePending[buildConfigKey("C64 and Cartridge Settings", "RAM Expansion Unit")],
  );
  const reuSizePending = Boolean(configWritePending[buildConfigKey("C64 and Cartridge Settings", "REU Size")]);

  const ramExpansionModeToken = normalizeOptionToken(ramExpansionValue);
  const ramExpansionAvailable =
    ramExpansionOptions.length > 0 && ramExpansionModeToken !== normalizeOptionToken(unavailableLabel);
  const reuSizeVisible = isActive && ramExpansionAvailable && ramExpansionModeToken === normalizeOptionToken("Enabled");
  const pageShellClassName = usePrimaryPageShellClassName();

  const handleRevertInitialConfig = async () => {
    try {
      const result = await revertToInitial();

      if (result.status === "missing-snapshot") {
        const shouldCaptureSnapshot =
          typeof window !== "undefined" &&
          window.confirm("No initial snapshot yet. Capture the current device config now?");
        if (shouldCaptureSnapshot) {
          const snapshot = await captureInitialSnapshot();
          if (snapshot) {
            toast({
              title: "Initial snapshot captured",
              description: "Run Revert again to restore this new baseline.",
            });
            return;
          }
        }
        toast({
          title: "Initial snapshot unavailable",
          description: "Capture the current device config first, then run Revert again.",
        });
        return;
      }

      if (result.status === "verification-failed") {
        reportUserError({
          operation: "Config revert",
          title: "Config revert verification failed",
          description: result.message,
          context: {
            mismatchCount: result.mismatchCount,
            mismatches: result.mismatches.slice(0, 5),
          },
        });
        return;
      }

      // HARD19-023/024: the revert succeeded, but flag partial coverage instead of
      // claiming full verification or inventing false mismatches.
      if (result.unverifiedCategories?.length || result.baselineIncomplete) {
        const caveats: string[] = [];
        if (result.unverifiedCategories?.length) {
          caveats.push(`couldn't re-read ${result.unverifiedCategories.join(", ")} to verify`);
        }
        if (result.baselineIncomplete) {
          caveats.push("the saved baseline was missing some categories, which weren't restored");
        }
        toast({
          title: "Config reverted — with caveats",
          description: `${caveats.join("; ")}.`,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Config reverted",
        description: "Verified against the initial snapshot.",
      });
    } catch (error) {
      reportUserError({
        operation: "Config revert",
        title: "Config revert failed",
        description: "Unable to restore the initial config snapshot.",
        error,
      });
    }
  };

  return (
    <div className={pageShellClassName}>
      <AppBar
        title="Home"
        leading={
          <div className="flex min-h-11 items-center gap-2 min-w-0">
            <img
              src={variant.assets.public.homeLogoPng}
              alt={variant.displayName}
              className="h-9 w-auto rounded-xl shrink-0 object-contain shadow-sm sm:h-11"
              data-testid="home-header-logo"
            />
            <div className="min-w-0 flex items-center">
              <h1 className="c64-header text-xl leading-none truncate" data-testid="home-header-title">
                Home
              </h1>
            </div>
          </div>
        }
      />

      <PageContainer>
        <PageStack className="gap-4">
          {/* System Info */}
          <SystemInfo />

          {/* Machine */}
          <MachineControls
            status={status}
            machineTaskBusy={machineTaskBusy}
            machineExecutionState={machineExecutionState}
            controls={controls}
            pauseResumePending={pauseResumePending}
            machineTaskId={machineTaskId}
            onPauseResume={handlePauseResume}
            onSaveRam={() => setSaveRamDialogOpen(true)}
            onLoadRam={() => setSnapshotManagerOpen(true)}
            ramActionsVisible={ramSnapshotsEnabled}
            onPowerOff={handlePowerOff}
            onReboot={() => void handleReboot()}
            onToggleMenu={() => void handleMenuToggle()}
            powerOffVisible={deviceCapabilities.supportsPowerCycle}
            powerCycleVisible={powerCycleVisible}
            onPowerCycle={powerCycleDisabledReason === null ? () => void handlePowerCycle() : undefined}
            powerCycleDisabledReason={powerCycleDisabledReason}
            rebootLoading={deviceControlActionId === "rebootKeepRam"}
            menuLoading={deviceControlActionId === "toggleMenu"}
            powerCycleLoading={telnet.activeActionId === "powerCycle"}
            extraActions={machineExtraActions}
            onAction={handleAction}
            telnetBusy={telnet.isBusy}
            footer={ramSnapshotsEnabled ? ramDumpFolderCard : null}
          />

          {liveViewEnabled && (audioMirrorEnabled || videoMirrorEnabled) && deviceCapabilities.supportsStreaming ? (
            <div data-section-label="Live View">
              <LiveViewCard
                audioEnabled={audioMirrorEnabled}
                videoEnabled={videoMirrorEnabled}
                showAvSyncTests={avSyncTestsEnabled}
              />
            </div>
          ) : null}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="space-y-2"
            data-section-label="Quick Config"
          >
            <SectionHeader title="Quick Config" />
            <ProfileSplitSection minColumnWidth="20rem" testId="home-quick-config-layout">
              <div className="space-y-3" data-testid="home-quick-config">
                <SummaryConfigCard
                  sectionLabel="CPU & RAM"
                  title="CPU & RAM"
                  testId="home-cpu-summary"
                  focusId="home-cpu-summary"
                  focusOrder={500}
                >
                  <SummaryConfigControlRow
                    controlType="select"
                    disabled={!isActive || turboControlPending}
                    focusId="home-cpu-turbo-control"
                    focusOrder={10}
                    focusParentId="home-cpu-summary"
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
                  <HomeCpuSpeedSlider
                    isActive={isActive}
                    cpuSpeedOptions={effectiveCpuSpeedOptions}
                    cpuSpeedValue={cpuSpeedValue}
                    keypadFocusParentId="home-cpu-summary"
                    turboControlOptions={effectiveTurboControlOptions}
                    turboControlValue={turboControlValue}
                  />
                  <SummaryConfigControlRow
                    disabled={!isActive || badlineTimingPending}
                    focusId="home-cpu-badline-timing"
                    focusOrder={60}
                    focusParentId="home-cpu-summary"
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
                    focusId="home-cpu-supercpu-detect"
                    focusOrder={70}
                    focusParentId="home-cpu-summary"
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
                  <SummaryConfigControlRow
                    disabled={!isActive || ramExpansionPending}
                    focusId="quickconfig-ram-expansion"
                    focusOrder={80}
                    focusParentId="home-cpu-summary"
                    label="RAM Expansion"
                    options={displayedRamExpansionOptions}
                    selectTriggerClassName={inlineSelectTriggerClass}
                    testId="quickconfig-ram-expansion"
                    value={displayedRamExpansionValue}
                    onValueChange={(value) =>
                      void updateConfigValue(
                        "C64 and Cartridge Settings",
                        "RAM Expansion Unit",
                        value,
                        "HOME_RAM_EXPANSION",
                        "RAM expansion updated",
                      )
                    }
                  />
                  {reuSizeVisible && (
                    <SummaryConfigControlRow
                      disabled={!isActive || reuSizePending}
                      focusId="quickconfig-ram-size"
                      focusOrder={90}
                      focusParentId="home-cpu-summary"
                      label="RAM Size (REU)"
                      options={displayedReuSizeOptions}
                      selectTriggerClassName={inlineSelectTriggerClass}
                      testId="quickconfig-ram-size"
                      value={displayedReuSizeValue}
                      onValueChange={(value) =>
                        void updateConfigValue(
                          "C64 and Cartridge Settings",
                          "REU Size",
                          value,
                          "HOME_REU_SIZE",
                          "RAM size updated",
                        )
                      }
                    />
                  )}
                </SummaryConfigCard>

                <SummaryConfigCard
                  sectionLabel="Ports"
                  title="Ports"
                  testId="home-ports-summary"
                  focusId="home-ports-summary"
                  focusOrder={510}
                >
                  <SummaryConfigControlRow
                    controlType="select"
                    disabled={!isActive || joystickSwapPending}
                    focusId="home-joystick-swapper"
                    focusOrder={10}
                    focusParentId="home-ports-summary"
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
                    focusId="home-serial-bus-mode"
                    focusOrder={20}
                    focusParentId="home-ports-summary"
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
                    focusId="home-cartridge-preference"
                    focusOrder={30}
                    focusParentId="home-ports-summary"
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
                    focusId="home-user-port-power"
                    focusOrder={40}
                    focusParentId="home-ports-summary"
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

                <SummaryConfigCard
                  sectionLabel="Video"
                  title="Video"
                  testId="home-video-summary"
                  focusId="home-video-summary"
                  focusOrder={520}
                >
                  <SummaryConfigControlRow
                    controlType="select"
                    disabled={!isActive || videoModePending}
                    focusId="home-video-mode"
                    focusOrder={10}
                    focusParentId="home-video-summary"
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
                    focusId="home-video-hdmi-resolution"
                    focusOrder={20}
                    focusParentId="home-video-summary"
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
                    focusId="home-video-scanlines"
                    focusOrder={30}
                    focusParentId="home-video-summary"
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
                    focusId="home-video-analog"
                    focusOrder={40}
                    focusParentId="home-video-summary"
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
                    focusId="home-video-digital"
                    focusOrder={50}
                    focusParentId="home-video-summary"
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
                  optionDomains={optionDomains}
                  selectTriggerClassName={inlineSelectTriggerClass}
                  testIdPrefix="home-user-interface"
                />
                <div data-testid="home-lighting-group">
                  <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/60 bg-card/50 p-3">
                    <div className="space-y-2">
                      <SectionHeader title="LED LIGHTING" className="pt-0" />
                      {lightingStudioEnabled ? (
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span
                            className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1"
                            data-testid="home-lighting-profile-chip"
                          >
                            {lightingResolved.activeProfile
                              ? `${lightingResolved.activeProfile.name}${isActiveProfileModified ? " *" : ""}`
                              : "Device look"}
                          </span>
                          {lightingResolved.activeAutomationChip ? (
                            <span
                              className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1"
                              data-testid="home-lighting-automation-chip"
                            >
                              {lightingResolved.activeAutomationChip}
                            </span>
                          ) : null}
                          {manualLockEnabled ? (
                            <span
                              className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1"
                              data-testid="home-lighting-lock-chip"
                            >
                              Manual lock
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {lightingStudioEnabled ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleOpenContextLens}
                          data-testid="home-lighting-why"
                        >
                          Why this look?
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={manualLockEnabled ? unlockCurrentLook : lockCurrentLook}
                          data-testid="home-lighting-lock-toggle"
                        >
                          {manualLockEnabled ? "Resume auto" : "Hold look"}
                        </Button>
                        <Button size="sm" onClick={handleOpenStudio} data-testid="home-lighting-studio">
                          Studio
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <LightingSummaryCard
                  category="LED Strip Settings"
                  config={ledStripConfig}
                  isActive={isActive}
                  onManualLightingChange={markManualLightingChange}
                  operationPrefix="HOME_LED"
                  sectionLabel="Case Light"
                  selectTriggerClassName={inlineSelectTriggerClass}
                  successLabel="Case light"
                  testIdPrefix="home-led"
                />
                {keyboardLightingRequested ? (
                  <LightingSummaryCard
                    category="Keyboard Lighting"
                    config={keyboardLightingConfig}
                    isActive={isActive}
                    onManualLightingChange={markManualLightingChange}
                    operationPrefix="HOME_KEYBOARD_LIGHTING"
                    sectionLabel="Keyboard Light"
                    selectTriggerClassName={inlineSelectTriggerClass}
                    successLabel="Keyboard light"
                    testIdPrefix="home-keyboard-lighting"
                  />
                ) : null}
              </div>
            </ProfileSplitSection>
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
              telnetAvailable={homeTelnetDriveActionsEnabled && telnet.isAvailable}
              telnetBusy={telnet.isBusy}
              telnetActiveActionId={telnet.activeActionId}
              getTelnetActionSupport={telnet.getActionSupport}
              onTelnetAction={async (actionId) => {
                const successTitles: Partial<Record<TelnetActionId, string>> = {
                  driveAReset: "Drive A reset",
                  driveBTurnOn: "Drive B turned on",
                  iecTurnOn: "Soft IEC Drive turned on",
                  iecReset: "Soft IEC Drive reset",
                  iecSetDir: "Soft IEC directory set",
                };
                await executeTelnetAction({
                  actionId: actionId as TelnetActionId,
                  successTitle:
                    successTitles[actionId as TelnetActionId] ??
                    `${TELNET_ACTIONS[actionId as TelnetActionId]?.label ?? "Drive action"} completed`,
                  failureOperation: "HOME_DRIVE_TELNET",
                  failureTitle: "Drive action failed",
                });
              }}
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
              telnetAvailable={homeTelnetPrinterActionsEnabled && telnet.isAvailable}
              telnetBusy={telnet.isBusy}
              telnetActiveActionId={telnet.activeActionId}
              getTelnetActionSupport={telnet.getActionSupport}
              onTelnetAction={async (actionId) => {
                const successTitles: Partial<Record<TelnetActionId, string>> = {
                  printerTurnOn: "Printer turned on",
                  printerFlush: "Printer flushed",
                  printerReset: "Printer reset",
                };
                await executeTelnetAction({
                  actionId: actionId as TelnetActionId,
                  successTitle:
                    successTitles[actionId as TelnetActionId] ??
                    `${TELNET_ACTIONS[actionId as TelnetActionId]?.label ?? "Printer action"} completed`,
                  failureOperation: "HOME_PRINTER_TELNET",
                  failureTitle: "Printer action failed",
                });
              }}
            />
          </motion.div>

          <AudioMixer isConnected={isActive} machineTaskBusy={machineTaskBusy} runMachineTask={runMachineTask} />

          {deviceCapabilities.supportsStreaming ? <StreamStatus isConnected={isActive} /> : null}

          {/* Config Actions */}
          {/*
           * Keypad focus ring (C64U Remote) reads top→bottom, so order bands
           * follow DOM order: MachineControls 100–190, Drives 300–390 (Reset 300,
           * per-drive ON/OFF toggles 310/320/330; mount/status/selects reserved
           * for M2.2/M2.5), Printers 400–490 (Reset 400, ON/OFF toggle 410;
           * bus/config selects reserved for M2.5), and these Config actions
           * 600–690 (they render last). The persistent TabBar sits above all page
           * content at 1000+.
           */}
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
            <ProfileActionGrid compactColumns={2} mediumColumns={4} expandedColumns={4} cardDensity="compact">
              <QuickActionCard
                icon={Save}
                label="Save"
                description="To flash"
                variant="success"
                focusId="home-config-save-flash"
                focusOrder={600}
                onClick={() => handleAction(() => controls.saveConfig.mutateAsync(), "Config saved to flash")}
                disabled={!isActive || machineTaskBusy}
                loading={controls.saveConfig.isPending}
              />
              <QuickActionCard
                icon={RefreshCw}
                label="Load"
                description="From flash"
                focusId="home-config-load-flash"
                focusOrder={610}
                onClick={() => handleAction(() => controls.loadConfig.mutateAsync(), "Config loaded from flash")}
                disabled={!isActive || machineTaskBusy}
                loading={controls.loadConfig.isPending}
              />
              <QuickActionCard
                icon={Trash2}
                label="Reset"
                description="To default"
                variant="danger"
                focusId="home-config-reset"
                focusOrder={620}
                onClick={() => handleAction(() => controls.resetConfig.mutateAsync(), "Config reset to defaults")}
                disabled={!isActive || machineTaskBusy}
                loading={controls.resetConfig.isPending}
              />
              <QuickActionCard
                icon={Upload}
                label="Save"
                description="To App"
                variant="success"
                dataTestId="home-config-save-app"
                focusId="home-config-save-app"
                focusOrder={630}
                onClick={() => setSaveDialogOpen(true)}
                disabled={!isActive || isSaving || machineTaskBusy}
                loading={isSaving}
              />
              <QuickActionCard
                icon={Download}
                label="Load"
                description="From App"
                dataTestId="home-config-load-app"
                focusId="home-config-load-app"
                focusOrder={640}
                onClick={() => setLoadDialogOpen(true)}
                disabled={!isActive || appConfigs.length === 0 || machineTaskBusy}
              />
              <QuickActionCard
                icon={RotateCcw}
                label="Revert"
                description="Changes"
                dataTestId="home-config-revert-changes"
                focusId="home-config-revert-changes"
                focusOrder={650}
                onClick={() => void handleRevertInitialConfig()}
                disabled={!isActive || isApplying || !hasChanges || machineTaskBusy}
                loading={isApplying}
              />
              <QuickActionCard
                icon={FolderOpen}
                label="Manage"
                description="App Configs"
                dataTestId="home-config-manage-app"
                focusId="home-config-manage-app"
                focusOrder={660}
                onClick={() => setManageDialogOpen(true)}
                disabled={!isActive || appConfigs.length === 0 || machineTaskBusy}
              />
              {advancedHomeConfigActionsVisible && localConfigFileActionsAvailable && (
                <QuickActionCard
                  icon={Download}
                  label="Save"
                  description={saveConfigDisabledReason ?? "To File"}
                  dataTestId="home-config-save-file"
                  focusId="home-config-save-file"
                  focusOrder={670}
                  onClick={() => void handleSaveToFile()}
                  disabled={!isActive || machineTaskBusy || telnet.isBusy || saveConfigDisabledReason !== null}
                  loading={configFileTaskPending === "save"}
                />
              )}
              {advancedHomeConfigActionsVisible && localConfigFileActionsAvailable && (
                <QuickActionCard
                  icon={Download}
                  label="Load"
                  description="From File"
                  dataTestId="home-config-load-file"
                  focusId="home-config-load-file"
                  focusOrder={680}
                  onClick={() => void handleLoadFromFile()}
                  disabled={!isActive || machineTaskBusy || telnet.isBusy}
                  loading={configFileTaskPending === "load"}
                />
              )}
              {advancedHomeConfigActionsVisible && telnet.isAvailable && (
                <QuickActionCard
                  icon={Trash2}
                  label="Clear Flash"
                  description={clearFlashDisabledReason ?? "Factory Reset"}
                  variant="danger"
                  dataTestId="home-config-clear-flash"
                  focusId="home-config-clear-flash"
                  focusOrder={690}
                  onClick={() => setClearFlashDialogOpen(true)}
                  disabled={!isActive || machineTaskBusy || telnet.isBusy || clearFlashDisabledReason !== null}
                  loading={telnet.activeActionId === "clearFlashConfig"}
                />
              )}
            </ProfileActionGrid>
          </motion.div>

          {/* Config Fetch Error */}
          {configFetchError && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-4"
              data-testid="config-fetch-error"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Config snapshot unavailable</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Could not load the initial configuration. Revert and save may be incomplete.
                </p>
              </div>
            </motion.div>
          )}

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
        </PageStack>
      </PageContainer>

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
        onSaveReu={reuSnapshotEnabled ? handleSaveReu : undefined}
        onSaveCpu={() => {
          setSaveRamDialogOpen(false);
          void handleSaveCpuSnapshot();
        }}
        isSaving={machineTaskId === "save-ram" || machineTaskId === "save-cpu" || reuTaskPending}
        telnetAvailable={telnet.isAvailable}
        telnetBusy={telnet.isBusy}
        telnetSaveReuDisabledReason={saveReuDisabledReason}
      />

      {remoteInputEnabled ? (
        <RemoteInputSheet open={remoteInputSheetOpen} onOpenChange={setRemoteInputSheetOpen} />
      ) : null}

      <SnapshotManagerDialog
        open={snapshotManagerOpen}
        onOpenChange={setSnapshotManagerOpen}
        snapshots={allSnapshots}
        showReuFilter={reuSnapshotEnabled}
        onRestore={(snapshot) => {
          setRestoreTarget(snapshot);
        }}
        onDelete={(id) => {
          const snapshot = allSnapshots.find((entry) => entry.id === id);
          if (snapshot) {
            void handleDeleteStoredSnapshot(snapshot);
          }
        }}
        onUpdateLabel={(id, label) => {
          const snapshot = allSnapshots.find((entry) => entry.id === id);
          if (snapshot) {
            handleUpdateStoredSnapshotLabel(snapshot, label);
          }
        }}
      />

      <RestoreSnapshotDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        snapshot={restoreTarget}
        onConfirm={(mode) => {
          void handleConfirmRestore(mode);
        }}
        isPending={machineTaskId === "load-ram" || reuTaskPending}
      />
      <ReuProgressDialog open={reuTaskPending} progress={reuProgress} />

      <ClearFlashDialog
        open={clearFlashDialogOpen}
        onOpenChange={setClearFlashDialogOpen}
        onConfirm={() => {
          setClearFlashDialogOpen(false);
          void (async () => {
            try {
              await telnet.executeAction("clearFlashConfig");
              toast({ title: "Flash configuration cleared" });
            } catch (error) {
              reportUserError({
                operation: "HOME_CLEAR_FLASH",
                title: "Clear flash failed",
                description: (error as Error).message,
                error,
              });
            }
          })();
        }}
        isPending={telnet.activeActionId === "clearFlashConfig"}
      />
    </div>
  );
}
