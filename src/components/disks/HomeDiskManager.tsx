/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Disc, ArrowLeftRight, ArrowRightLeft, HardDrive, X, Folder, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsivePathText } from "@/components/ResponsivePathText";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SelectableActionList,
  type ActionListItem,
  type ActionListMenuItem,
} from "@/components/lists/SelectableActionList";
import {
  AddItemsProgressOverlay,
  type AddItemsProgressState,
} from "@/components/itemSelection/AddItemsProgressOverlay";
import { ItemSelectionDialog, type SourceGroup } from "@/components/itemSelection/ItemSelectionDialog";
import { SOURCE_LABELS } from "@/lib/sourceNavigation/sourceTerms";
import { toast } from "@/hooks/use-toast";
import { useC64ConfigItems, useC64Connection, useC64Drives } from "@/hooks/useC64Connection";
import { useListPreviewLimit } from "@/hooks/useListPreviewLimit";
import { useLocalSources } from "@/hooks/useLocalSources";
import { useActionTrace } from "@/hooks/useActionTrace";
import { useArchiveClientSettings } from "@/pages/playFiles/hooks/useArchiveClientSettings";
import { createArchiveClient } from "@/lib/archive/client";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import { getC64API } from "@/lib/c64api";
import { addErrorLog, addLog } from "@/lib/logging";
import { reportUserError } from "@/lib/uiErrors";
import { cn } from "@/lib/utils";
import {
  mountDiskToDrive,
  finalizeDiskWriteBack,
  discardDiskWriteBack,
  hasShownDiskWriteBackAdvisory,
  markDiskWriteBackAdvisoryShown,
  hasShownArchiveDiskWriteBackAdvisory,
  markArchiveDiskWriteBackAdvisoryShown,
  getMaterializedWorkPath,
  getMaterializedDiskId,
  type DiskMountWriteBackDependencies,
} from "@/lib/disks/diskMount";
import { buildDiskWriteBackDependencies } from "@/lib/disks/diskWriteBackDependencies";
import { getOnOffButtonClass } from "@/lib/ui/buttonStyles";
import {
  createDiskEntry,
  getDiskFolderPath,
  getDiskName,
  getLeafFolderName,
  isDiskImagePath,
  normalizeDiskPath,
  type DiskEntry,
} from "@/lib/disks/diskTypes";
import { assignDiskGroupsByPrefix } from "@/lib/disks/diskGrouping";
import { pickDiskGroupColor } from "@/lib/disks/diskGroupColors";
import { useDiskLibrary } from "@/hooks/useDiskLibrary";
import { SHARED_DISK_LIBRARY_ID } from "@/lib/disks/diskStore";
import { createArchiveSourceLocation } from "@/lib/sourceNavigation/archiveSourceAdapter";
import { createUltimateSourceLocation } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { createLocalSourceLocation, resolveLocalRuntimeFile } from "@/lib/sourceNavigation/localSourceAdapter";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { getLocalSourceListingMode, requireLocalSourceEntries } from "@/lib/sourceNavigation/localSourcesStore";
import { LocalSourceListingError } from "@/lib/sourceNavigation/localSourceErrors";
import { prepareDirectoryInput } from "@/lib/sourceNavigation/localSourcesStore";
import type { SelectedItem, SourceEntry, SourceLocation, SourceRecursiveFailure } from "@/lib/sourceNavigation/types";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { redactTreeUri } from "@/lib/native/safUtils";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { discoverConfigCandidates } from "@/lib/config/configDiscovery";
import { resolvePlaybackConfig } from "@/lib/config/configResolution";
import {
  describeConfigOrigin,
  resolvePlaybackConfigUiState,
  resolveStoredConfigOrigin,
} from "@/lib/config/playbackConfig";
import { formatDiskDosStatus } from "@/lib/disks/dosStatusFormatter";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useScreenActivity } from "@/hooks/useScreenActivity";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";
import { ProfileSplitSection } from "@/components/layout/PageContainer";
import { HOME_SUMMARY_QUERY_OPTIONS } from "@/pages/home/constants";
import {
  buildOptionDomainKey,
  useDeviceConfigOptionDomains,
  type DeviceConfigItemRef,
} from "@/pages/home/hooks/useDeviceConfigOptionDomains";
import {
  buildBusIdOptions,
  buildTypeOptions,
  normalizeDriveDevices,
  type DriveDeviceClass,
} from "@/lib/drives/driveDevices";
import {
  DRIVE_BUS_ID_DEFAULTS,
  DRIVE_BUS_ID_ITEM,
  DRIVE_CONFIG_CATEGORY,
  DRIVE_DEFAULT_BUS_ID,
  DRIVE_DEFAULT_TYPE,
  DRIVE_KEYS,
  DRIVE_TYPE_ITEM,
  getCategoryConfigValue,
  getDriveConfigValue,
  getStatusMessageColorClass,
  INLINE_META_SELECT_CLASS,
  LocationIcon,
  ROW1_CONTROL_CLASS,
  SOFT_IEC_BUS_ID_DEFAULTS,
  SOFT_IEC_CONTROL,
  SOFT_IEC_DEFAULT_PATH_FALLBACK,
  SOFT_IEC_DEFAULT_PATH_ITEM,
  buildDriveLabel,
  buildDrivePath,
  formatBytes,
  formatDate,
  normalizeDirectoryPath,
  parseBusId,
  parseDriveType,
  resolveDriveBusId,
  resolveDriveStatusRaw,
  resolveDriveType,
  resolveSoftIecServiceError,
  resolveSoftIecDefaultPath,
  resolveStatusDisplaySeverity,
  type DriveKey,
} from "@/components/disks/HomeDiskManagerSupport";

const isTestEnvironment =
  typeof process !== "undefined" && (process.env.VITEST === "true" || process.env.NODE_ENV === "test");
const ACTIVE_ADD_ITEMS_PROGRESS_STATES = new Set<AddItemsProgressState["status"]>([
  "scanning",
  "ingesting",
  "committing",
]);
const DRIVE_MUTATION_SETTLE_MS = isTestEnvironment ? 1 : 1500;

/** Yields control back to the renderer for one event loop tick. */
const yieldToRenderer = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const waitAtLeast = async (startedAt: number, durationMs: number) => {
  if (isTestEnvironment || durationMs <= 0) return;
  const elapsed = Date.now() - startedAt;
  if (elapsed < durationMs) {
    await new Promise((resolve) => setTimeout(resolve, durationMs - elapsed));
  }
};

const waitForDriveMutationSettle = () => new Promise<void>((resolve) => setTimeout(resolve, DRIVE_MUTATION_SETTLE_MS));

const parseArchiveSelectionPath = (selectionPath: string) => {
  const [resultId, rawCategory] = selectionPath.split("/");
  const category = Number(rawCategory);
  if (!resultId || Number.isNaN(category)) {
    throw new Error(`Invalid archive selection: ${selectionPath}`);
  }
  return { resultId, category };
};

type FocusableDiskButtonProps = ComponentProps<typeof Button> & {
  focusId: string;
  focusOrder: number;
  focusGroup?: string;
};

const DISKS_LIBRARY_FOCUS_ORDER = {
  addDisks: 600,
  mountSheetAddDisks: 610,
} as const;

const driveFocusOrder = (driveIndex: number, offset: number) => 100 + driveIndex * 100 + offset;

const FocusableDiskButton = ({
  focusId,
  focusOrder,
  focusGroup = "disks-drive-controls",
  disabled,
  ...props
}: FocusableDiskButtonProps) => {
  const focusRef = useFocusItem<HTMLButtonElement>({
    id: focusId,
    order: focusOrder,
    group: focusGroup,
    disabled: Boolean(disabled),
  });

  return <Button ref={focusRef} disabled={disabled} {...props} />;
};

// Every drive config item whose Bus ID range / Drive Type choices must be sourced from the device.
const DISK_MANAGER_OPTION_DOMAIN_REFS: DeviceConfigItemRef[] = [
  { category: DRIVE_CONFIG_CATEGORY.a, item: DRIVE_BUS_ID_ITEM },
  { category: DRIVE_CONFIG_CATEGORY.a, item: DRIVE_TYPE_ITEM },
  { category: DRIVE_CONFIG_CATEGORY.b, item: DRIVE_BUS_ID_ITEM },
  { category: DRIVE_CONFIG_CATEGORY.b, item: DRIVE_TYPE_ITEM },
  { category: SOFT_IEC_CONTROL.category, item: SOFT_IEC_CONTROL.busItem },
];

export const HomeDiskManager = () => {
  const { profile } = useDisplayProfile();
  const screenActive = useScreenActivity();
  const { status } = useC64Connection();
  const { data: drivesData, dataUpdatedAt: drivesDataUpdatedAt = 0 } = useC64Drives(HOME_SUMMARY_QUERY_OPTIONS);
  const trace = useActionTrace("HomeDiskManager");

  const diskLibrary = useDiskLibrary(SHARED_DISK_LIBRARY_ID);
  const disksById = useMemo(
    () => Object.fromEntries(diskLibrary.disks.map((disk) => [disk.id, disk])),
    [diskLibrary.disks],
  );

  const [activeDrive, setActiveDrive] = useState<DriveKey | null>(null);
  const [activeDisk, setActiveDisk] = useState<DiskEntry | null>(null);
  const [driveErrors, setDriveErrors] = useState<Record<string, string>>({});
  // Timestamp each per-drive operation error so the drive poll can clear a stale
  // error once a later successful /v1/drives poll supersedes it (mirrors the
  // mountedByDrive / drivePowerOverride reconciliation below). Without this a
  // transient mount/eject failure (e.g. a slow mount aborted as "Host
  // unreachable") sticks on the drive status until the page is re-mounted, even
  // though subsequent polls succeed and the sibling drive shows OK.
  const driveErrorsSetAtRef = useRef<Record<string, number>>({});
  const [mountedByDrive, setMountedByDrive] = useState<Record<string, string>>({});
  const mountedByDriveSetAtRef = useRef<Record<string, number>>({});
  const mountCompletionGenerationRef = useRef<Record<DriveKey, number>>({ a: 0, b: 0 });
  const [drivePowerOverride, setDrivePowerOverride] = useState<Record<string, boolean>>({});
  const drivePowerOverrideSetAtRef = useRef<Record<string, number>>({});
  const [drivePowerPending, setDrivePowerPending] = useState<Record<string, boolean>>({});
  const [driveResetPending, setDriveResetPending] = useState<Record<string, boolean>>({});
  const [driveMutationPending, setDriveMutationPending] = useState<Record<string, boolean>>({});
  const [browserOpen, setBrowserOpen] = useState(false);
  const [softIecDirectoryBrowserOpen, setSoftIecDirectoryBrowserOpen] = useState(false);
  const [addItemsProgress, setAddItemsProgress] = useState<AddItemsProgressState>({
    status: "idle",
    count: 0,
    elapsedMs: 0,
    total: null,
    message: null,
  });
  const addItemsAbortRef = useRef<AbortController | null>(null);
  const cancelAddItemsScan = useCallback(() => {
    const controller = addItemsAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
  }, []);
  const [showAddItemsOverlay, setShowAddItemsOverlay] = useState(false);
  const [addItemsSurface, setAddItemsSurface] = useState<"dialog" | "page">("dialog");
  const [isAddingItems, setIsAddingItems] = useState(false);
  const addItemsStartedAtRef = useRef<number | null>(null);
  const addItemsOverlayStartedAtRef = useRef<number | null>(null);
  const addItemsOverlayActiveRef = useRef(false);
  const [groupDialogDisk, setGroupDialogDisk] = useState<DiskEntry | null>(null);
  const [groupName, setGroupName] = useState("");
  const [renameDialogDisk, setRenameDialogDisk] = useState<DiskEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteDialogDisk, setDeleteDialogDisk] = useState<DiskEntry | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectedDiskIds, setSelectedDiskIds] = useState<Set<string>>(new Set());
  const localSourceInputRef = useRef<HTMLInputElement | null>(null);
  const { sources: localSources, addSourceFromPicker } = useLocalSources();
  const { archiveConfig, commoserveEnabled } = useArchiveClientSettings();
  const { limit: listPreviewLimit } = useListPreviewLimit();
  const isAndroid = getPlatform() === "android" && isNativePlatform();

  const api = getC64API();
  const queryClient = useQueryClient();
  const [driveConfigPending, setDriveConfigPending] = useState<Record<DriveKey, boolean>>({ a: false, b: false });
  const [softIecConfigPending, setSoftIecConfigPending] = useState(false);
  const refreshDrivesFromDevice = useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: ["c64-drives"],
      queryFn: () => api.getDrives(),
      staleTime: 0,
    });
  }, [api, queryClient]);
  // HARD18-025 / HARD19-008: the FTP write-back deps are built by the shared
  // buildDiskWriteBackDependencies (host/port/password resolved fresh per call
  // against the currently selected device), so the Play page's executePlayPlan
  // disk case can pass the SAME deps.
  const runDriveMutationWithSettledPolling = useCallback(
    async <T,>(operation: () => Promise<T>) => {
      const pollingPause = pollingPauseRegistry.acquirePause();
      try {
        await queryClient.cancelQueries({ queryKey: ["c64-drives"], type: "active" });
        const result = await operation();
        await queryClient.invalidateQueries({ queryKey: ["c64-drives"], refetchType: "none" });
        await waitForDriveMutationSettle();
        return result;
      } finally {
        pollingPause.release();
      }
    },
    [queryClient],
  );
  const { data: driveAConfig } = useC64ConfigItems(
    DRIVE_CONFIG_CATEGORY.a,
    [DRIVE_BUS_ID_ITEM, DRIVE_TYPE_ITEM],
    status.isConnected || status.isConnecting,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const { data: driveBConfig } = useC64ConfigItems(
    DRIVE_CONFIG_CATEGORY.b,
    [DRIVE_BUS_ID_ITEM, DRIVE_TYPE_ITEM],
    status.isConnected || status.isConnecting,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const { data: softIecConfig } = useC64ConfigItems(
    SOFT_IEC_CONTROL.category,
    [SOFT_IEC_CONTROL.busItem, SOFT_IEC_DEFAULT_PATH_ITEM],
    status.isConnected || status.isConnecting,
    HOME_SUMMARY_QUERY_OPTIONS,
  );

  // Bus-ID ranges (numeric min/max — Soft IEC accepts 8-30, not just 8-11) and Drive Type choices
  // (device enum) are interrogated from the concrete device, cached per-firmware, never hard-coded.
  const optionDomains = useDeviceConfigOptionDomains(
    "disks-drives",
    DISK_MANAGER_OPTION_DOMAIN_REFS,
    status.isConnected,
  );
  const busDefaultsFor = (category: string, item: string, fallback: readonly number[]): number[] => {
    const domain = optionDomains[buildOptionDomainKey(category, item)];
    if (domain?.min !== undefined && domain.max !== undefined && domain.max >= domain.min) {
      return Array.from({ length: domain.max - domain.min + 1 }, (_, index) => domain.min! + index);
    }
    // HARD16-011 doctrine exception: numeric IEC bus range, low divergence risk;
    // the current value is merged in and the device min/max wins once resolved.
    return [...fallback];
  };
  // HARD16-011: Drive Type is a model-diverging string enum; when the device has
  // not reported its values, offer nothing here so the current value only is
  // shown (buildTypeOptions merges it) — never a fabricated model-specific list.
  const typeOptionsFor = (category: string, item: string): readonly string[] => {
    const domainOptions = optionDomains[buildOptionDomainKey(category, item)]?.options;
    return domainOptions && domainOptions.length ? domainOptions : [];
  };

  const normalizedDriveModel = useMemo(() => normalizeDriveDevices(drivesData ?? null), [drivesData]);
  const softIecDevice = normalizedDriveModel.devices.find((entry) => entry.class === SOFT_IEC_CONTROL.class) ?? null;

  const localSourcesById = useMemo(() => new Map(localSources.map((source) => [source.id, source])), [localSources]);

  const sourceGroups: SourceGroup[] = useMemo(() => {
    const ultimateSource = createUltimateSourceLocation();
    const localGroupSources = localSources.map((source) => createLocalSourceLocation(source));
    const groups: SourceGroup[] = [
      { label: SOURCE_LABELS.local, sources: localGroupSources },
      { label: SOURCE_LABELS.c64u, sources: [ultimateSource] },
    ];
    if (commoserveEnabled) {
      groups.push({
        label: SOURCE_LABELS.commoserve,
        sources: [createArchiveSourceLocation(archiveConfig)],
      });
    }
    return groups;
  }, [archiveConfig, commoserveEnabled, localSources]);
  const archiveConfigs = useMemo((): Record<string, ArchiveClientConfigInput> => {
    if (!commoserveEnabled) return {};
    return { [archiveConfig.id]: archiveConfig };
  }, [archiveConfig, commoserveEnabled]);
  const softIecDirectorySourceGroups: SourceGroup[] = useMemo(() => {
    const ultimateSource = createUltimateSourceLocation();
    return [{ label: SOURCE_LABELS.c64u, sources: [ultimateSource] }];
  }, []);

  const discoverDiskPlaybackConfig = useCallback(
    async (source: SourceLocation, entry: { path: string; name: string }) => {
      if (source.type !== "local" && source.type !== "ultimate") {
        return {
          configRef: null,
          configOrigin: resolveStoredConfigOrigin(null, null),
          configOverrides: null,
          configCandidates: null,
        };
      }

      if (typeof source.listEntries !== "function") {
        addLog("warn", "Disk playback config discovery skipped", {
          sourceType: source.type,
          sourceId: source.type === "local" ? source.id : null,
          path: entry.path,
          reason: "listEntries unavailable",
        });
        return {
          configRef: null,
          configOrigin: resolveStoredConfigOrigin(null, null),
          configOverrides: null,
          configCandidates: null,
        };
      }

      try {
        const candidates = await discoverConfigCandidates({
          sourceType: source.type,
          sourceId: source.type === "local" ? source.id : null,
          sourceRootPath: source.rootPath,
          targetFile: { name: entry.name, path: entry.path },
          listEntries: source.listEntries,
        });
        const resolved = resolvePlaybackConfig({ candidates });
        return {
          configRef: resolved.configRef,
          configOrigin: resolved.configOrigin,
          configOverrides: resolved.configOverrides,
          configCandidates: resolved.configCandidates,
        };
      } catch (error) {
        addErrorLog("Disk playback config discovery failed", {
          sourceType: source.type,
          sourceId: source.type === "local" ? source.id : null,
          path: entry.path,
          fileName: entry.name,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          configRef: null,
          configOrigin: resolveStoredConfigOrigin(null, null),
          configOverrides: null,
          configCandidates: null,
        };
      }
    },
    [],
  );

  useEffect(() => {
    setSelectedDiskIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set(Array.from(prev).filter((id) => Boolean(disksById[id])));
      return next.size === prev.size ? prev : next;
    });
  }, [disksById]);

  useEffect(() => {
    if (!drivesData?.drives?.length || drivesDataUpdatedAt <= 0) return;
    setMountedByDrive((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((drive) => {
        const setAt = mountedByDriveSetAtRef.current[drive];
        if (typeof setAt !== "number" || drivesDataUpdatedAt < setAt) return;
        const overrideDiskId = next[drive];
        if (overrideDiskId) {
          const overriddenDisk = disksById[overrideDiskId];
          if (overriddenDisk?.location === "local") {
            // resolveMountedDiskId's poll-based fallback only ever matches
            // "ultimate"-location disks (it compares image_path/image_file
            // against disk.path), so a local (uploaded-blob) disk's mount can
            // never be re-derived from the poll once this override is gone.
            // Clearing it as soon as any poll lands (the original design,
            // intended for error/power overrides) made rotation and
            // eject-before-delete stop working the instant the mount
            // succeeded. Keep the override while the poll still shows the
            // same uploaded filename mounted; only clear when the drive
            // genuinely reports something else (empty or a different
            // image). See HARD9-038.
            const driveInfo = drivesData?.drives?.find((entry) => entry[drive])?.[drive];
            const polledBasename = driveInfo?.image_file ? getDiskName(driveInfo.image_file) : null;
            // HARD19-007: a materialized mount path-mounts an internal work file
            // (c64commander-disk-work-<drive>.<type>), so the poll reports the work
            // filename, never the original disk's basename — which cleared the
            // override on the first poll, degrading the label to the work filename
            // and losing rotation + delete-protection. Also keep the override when
            // the poll shows the drive's expected work file.
            const workPath = getMaterializedWorkPath(drive as "a" | "b");
            const workBasename = workPath ? getDiskName(workPath) : null;
            if (
              polledBasename &&
              (polledBasename === getDiskName(overriddenDisk.path) || polledBasename === workBasename)
            ) {
              return;
            }
          }
        }
        delete next[drive];
        delete mountedByDriveSetAtRef.current[drive];
        changed = true;
      });
      return changed ? next : prev;
    });
    setDrivePowerOverride((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        const setAt = drivePowerOverrideSetAtRef.current[key];
        if (typeof setAt !== "number" || drivesDataUpdatedAt < setAt) return;
        delete next[key];
        delete drivePowerOverrideSetAtRef.current[key];
        changed = true;
      });
      return changed ? next : prev;
    });
    // Clear a stale per-drive operation error once a later successful poll
    // supersedes it. A missing/newer timestamp is left untouched so an error
    // raised after this poll's data is not cleared prematurely.
    setDriveErrors((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        const setAt = driveErrorsSetAtRef.current[key];
        if (typeof setAt !== "number" || drivesDataUpdatedAt < setAt) return;
        delete next[key];
        delete driveErrorsSetAtRef.current[key];
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [drivesData?.drives, drivesDataUpdatedAt]);

  // Stamp each per-drive error with the time it was (re)set so the poll
  // reconciliation above can tell which errors a later successful poll
  // supersedes. Re-stamping on every change keeps repeated failures accurate.
  useEffect(() => {
    const now = Date.now();
    Object.keys(driveErrors).forEach((key) => {
      driveErrorsSetAtRef.current[key] = now;
    });
    Object.keys(driveErrorsSetAtRef.current).forEach((key) => {
      if (!(key in driveErrors)) delete driveErrorsSetAtRef.current[key];
    });
  }, [driveErrors]);

  useEffect(() => {
    prepareDirectoryInput(localSourceInputRef.current);
  }, [toast]);

  useEffect(() => {
    if (!ACTIVE_ADD_ITEMS_PROGRESS_STATES.has(addItemsProgress.status)) return undefined;
    const interval = window.setInterval(() => {
      const startedAt = addItemsStartedAtRef.current ?? Date.now();
      setAddItemsProgress((prev) => ({
        ...prev,
        elapsedMs: Date.now() - startedAt,
      }));
    }, 500);
    return () => window.clearInterval(interval);
  }, [addItemsProgress.status]);

  useEffect(() => {
    if (browserOpen) {
      setAddItemsSurface("dialog");
    }
  }, [browserOpen]);

  useEffect(() => {
    if (browserOpen) return;
    if (ACTIVE_ADD_ITEMS_PROGRESS_STATES.has(addItemsProgress.status)) return;
    setAddItemsProgress({
      status: "idle",
      count: 0,
      elapsedMs: 0,
      total: null,
      message: null,
    });
  }, [addItemsProgress.status, browserOpen]);

  useEffect(() => {
    if (browserOpen) return;
    if (addItemsProgress.status !== "scanning") return;
    if (addItemsSurface !== "page") {
      setAddItemsSurface("page");
    }
  }, [addItemsProgress.status, addItemsSurface, browserOpen]);

  useEffect(() => {
    if (addItemsProgress.status === "scanning") return;
    if (addItemsSurface === "page" && isAddingItems) return;
    if (addItemsSurface !== "dialog") {
      setAddItemsSurface("dialog");
    }
  }, [addItemsProgress.status, addItemsSurface, isAddingItems]);

  useEffect(
    () => () => {
      mountCompletionGenerationRef.current = {
        a: (mountCompletionGenerationRef.current.a ?? 0) + 1,
        b: (mountCompletionGenerationRef.current.b ?? 0) + 1,
      };
    },
    [],
  );

  useEffect(() => {
    if (screenActive) return;
    mountCompletionGenerationRef.current = {
      a: (mountCompletionGenerationRef.current.a ?? 0) + 1,
      b: (mountCompletionGenerationRef.current.b ?? 0) + 1,
    };
  }, [screenActive]);

  const handleAutoConfirmStart = useCallback(() => {
    setAddItemsSurface("page");
    setIsAddingItems(true);
    setShowAddItemsOverlay(true);
    addItemsOverlayStartedAtRef.current = Date.now();
    addItemsOverlayActiveRef.current = true;
  }, []);

  const showNoDiskWarning = useCallback(() => {
    reportUserError({
      operation: "DISK_IMPORT",
      title: "No disks found",
      description: "Found no disk file.",
    });
  }, [reportUserError]);

  const toggleSelectAll = () => {
    setSelectedDiskIds(allSelected ? new Set() : new Set(allDiskIds));
  };

  const handleDiskSelect = (disk: DiskEntry, selected: boolean) => {
    setSelectedDiskIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(disk.id);
      } else {
        next.delete(disk.id);
      }
      return next;
    });
  };

  const allDiskIds = useMemo(() => diskLibrary.disks.map((disk) => disk.id), [diskLibrary.disks]);
  const selectedCount = selectedDiskIds.size;
  const allSelected = selectedCount > 0 && selectedCount === allDiskIds.length;

  const groupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    diskLibrary.disks.forEach((disk) => {
      if (!disk.group) return;
      counts.set(disk.group, (counts.get(disk.group) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({
        name,
        count,
        color: pickDiskGroupColor(name),
      }));
  }, [diskLibrary.disks]);
  const sortedDisks = useMemo(
    () => diskLibrary.disks.slice().sort((a, b) => a.path.localeCompare(b.path)),
    [diskLibrary.disks],
  );

  const handleMountDisk = trace(async (drive: DriveKey, disk: DiskEntry) => {
    const mountGeneration = (mountCompletionGenerationRef.current[drive] ?? 0) + 1;
    mountCompletionGenerationRef.current = {
      ...mountCompletionGenerationRef.current,
      [drive]: mountGeneration,
    };
    setDriveMutationPending((prev) => ({ ...prev, [drive]: true }));
    try {
      const runtimeFile = diskLibrary.runtimeFiles[disk.id];
      // Match Play's mount mode (mountDiskToDrive/mountDriveUpload both
      // default to "readwrite") so a disk mounted from the library behaves
      // the same as one launched via Play - games saving high scores/state
      // to the user's own D64s must not fail with DOS 26 "WRITE PROTECT ON".
      // See HARD9-012.
      const outcome = await runDriveMutationWithSettledPolling(() =>
        mountDiskToDrive(api, drive, disk, runtimeFile, {
          archiveConfigs,
          writeBack: buildDiskWriteBackDependencies(),
        }),
      );
      if (mountCompletionGenerationRef.current[drive] !== mountGeneration) {
        addLog("debug", "Ignoring stale disk mount completion", {
          drive,
          diskId: disk.id,
          path: disk.path,
          mountGeneration,
          currentGeneration: mountCompletionGenerationRef.current[drive] ?? 0,
        });
        return;
      }
      mountedByDriveSetAtRef.current[drive] = Date.now();
      setMountedByDrive((prev) => ({ ...prev, [drive]: disk.id }));
      setDriveErrors((prev) => ({ ...prev, [drive]: "" }));
      toast({
        title: "Disk mounted",
        description: `${disk.name} mounted in ${buildDriveLabel(drive)}`,
      });
      // HARD18-025: only the residual case (materialization unavailable or
      // failed) risks silent save loss - device-native and materialized
      // mounts persist writes, so neither needs the advisory.
      if (outcome?.persistence === "transient" && !hasShownDiskWriteBackAdvisory()) {
        markDiskWriteBackAdvisoryShown();
        toast({
          title: "Changes to this disk won't be saved back",
          description: "This disk isn't on writable local storage, so in-game saves will be lost when it's remounted.",
        });
      } else if (
        // HARD19-014 (D2): an archive/CommoServe disk materializes but its write-back
        // only persists to a short-lived in-memory cache, so warn (once) with
        // session-scoped wording that its saves are not durable.
        outcome?.persistence === "materialized" &&
        outcome.writeBackTarget?.kind === "archive-cache" &&
        !hasShownArchiveDiskWriteBackAdvisory()
      ) {
        markArchiveDiskWriteBackAdvisoryShown();
        toast({
          title: "Changes are kept only for this session",
          description:
            "This disk is from an online archive, so in-game saves are held temporarily and are lost when the app restarts or after a while. Copy it to a local folder to keep changes.",
        });
      }
    } catch (error) {
      if (mountCompletionGenerationRef.current[drive] !== mountGeneration) {
        addLog("debug", "Ignoring stale disk mount failure", {
          drive,
          diskId: disk.id,
          path: disk.path,
          mountGeneration,
          currentGeneration: mountCompletionGenerationRef.current[drive] ?? 0,
          error: (error as Error).message,
        });
        return;
      }
      setDriveErrors((prev) => ({
        ...prev,
        [drive]: (error as Error).message,
      }));
      addErrorLog("Disk mount failed (UI)", {
        drive,
        path: disk.path,
        location: disk.location,
        endpoint: `/v1/drives/${drive}:mount`,
        baseUrl: api.getBaseUrl(),
        deviceHost: api.getDeviceHost(),
        demoMode: status.state === "DEMO_ACTIVE",
        error: (error as Error).message,
      });
      reportUserError({
        operation: "DISK_MOUNT",
        title: "Mount failed",
        description: (error as Error).message,
        error,
        context: {
          drive,
          path: disk.path,
          location: disk.location,
          endpoint: `/v1/drives/${drive}:mount`,
          baseUrl: api.getBaseUrl(),
          deviceHost: api.getDeviceHost(),
          demoMode: status.state === "DEMO_ACTIVE",
        },
      });
    } finally {
      setDriveMutationPending((prev) => ({ ...prev, [drive]: false }));
    }
  });

  const handleEject = trace(async (drive: DriveKey) => {
    setDriveMutationPending((prev) => ({ ...prev, [drive]: true }));
    try {
      await runDriveMutationWithSettledPolling(() => api.unmountDrive(drive));
      // HARD18-025: read the materialized work-dir image back and re-persist
      // it to the source now that the drive has released it. Best-effort -
      // a failed write-back must not undo the eject the user just asked for.
      // HARD19-005: pass the current device so a write-back only runs against the
      // device the disk was actually materialized on — never overwriting the local
      // source with a different device's stale work file.
      const writeBackResult = await finalizeDiskWriteBack(drive, buildDiskWriteBackDependencies(), api.getDeviceHost());
      mountedByDriveSetAtRef.current[drive] = Date.now();
      setMountedByDrive((prev) => ({ ...prev, [drive]: "" }));
      setDriveErrors((prev) => ({ ...prev, [drive]: "" }));
      if (writeBackResult.attempted && !writeBackResult.success) {
        toast({
          title: `${buildDriveLabel(drive)} ejected, but changes weren't saved`,
          description: writeBackResult.error.message,
          variant: "destructive",
        });
      } else if (!writeBackResult.attempted && writeBackResult.reason === "device-mismatch") {
        // HARD19-005: the disk was mounted on another device; its saves were not
        // written back here (doing so would corrupt this device's work file).
        toast({
          title: `${buildDriveLabel(drive)} ejected — changes not saved here`,
          description: "This disk was mounted on a different device. Switch back to that device to save its changes.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Disk ejected",
          description: `${buildDriveLabel(drive)} cleared`,
        });
      }
    } catch (error) {
      setDriveErrors((prev) => ({
        ...prev,
        [drive]: (error as Error).message,
      }));
      reportUserError({
        operation: "DISK_EJECT",
        title: "Eject failed",
        description: (error as Error).message,
        error,
        context: { drive },
      });
    } finally {
      setDriveMutationPending((prev) => ({ ...prev, [drive]: false }));
    }
  });

  const handleToggleDrivePower = trace(
    async (driveKey: string, driveLabel: string, targetEnabled: boolean, errorKey: string) => {
      if (!status.isConnected) return;
      setDrivePowerPending((prev) => ({ ...prev, [errorKey]: true }));
      drivePowerOverrideSetAtRef.current[errorKey] = Date.now();
      setDrivePowerOverride((prev) => ({ ...prev, [errorKey]: targetEnabled }));
      try {
        if (targetEnabled) {
          await api.driveOn(driveKey);
        } else {
          await api.driveOff(driveKey);
        }
        setDriveErrors((prev) => ({ ...prev, [errorKey]: "" }));
        toast({
          title: targetEnabled ? "Drive powered on" : "Drive powered off",
          description: `${driveLabel} ${targetEnabled ? "enabled" : "disabled"}.`,
        });
        queryClient.invalidateQueries({ queryKey: ["c64-drives"] });
      } catch (error) {
        setDrivePowerOverride((prev) => {
          const next = { ...prev };
          delete next[errorKey];
          return next;
        });
        delete drivePowerOverrideSetAtRef.current[errorKey];
        setDriveErrors((prev) => ({
          ...prev,
          [errorKey]: (error as Error).message,
        }));
        reportUserError({
          operation: "DRIVE_POWER",
          title: "Drive power toggle failed",
          description: (error as Error).message,
          error,
          context: { driveKey, driveLabel, targetEnabled },
        });
      } finally {
        setDrivePowerPending((prev) => ({ ...prev, [errorKey]: false }));
      }
    },
  );

  const handleResetDrive = trace(async (driveKey: string, driveLabel: string, errorKey: string) => {
    if (!status.isConnected || driveResetPending[errorKey]) return;
    setDriveResetPending((prev) => ({ ...prev, [errorKey]: true }));
    try {
      const typedDriveKey = driveKey as DriveKey;
      mountCompletionGenerationRef.current = {
        ...mountCompletionGenerationRef.current,
        [typedDriveKey]: (mountCompletionGenerationRef.current[typedDriveKey] ?? 0) + 1,
      };
      await api.resetDrive(driveKey);
      delete mountedByDriveSetAtRef.current[typedDriveKey];
      setMountedByDrive((prev) => {
        const next = { ...prev };
        delete next[typedDriveKey];
        return next;
      });
      await refreshDrivesFromDevice();
      setDriveErrors((prev) => ({ ...prev, [errorKey]: "" }));
      toast({
        title: `${driveLabel} reset`,
        description: `${driveLabel} was reset.`,
      });
    } catch (error) {
      setDriveErrors((prev) => ({
        ...prev,
        [errorKey]: (error as Error).message,
      }));
      reportUserError({
        operation: "RESET_DRIVES",
        title: "Drive reset failed",
        description: (error as Error).message,
        error,
        context: { driveKey, driveLabel },
      });
    } finally {
      setDriveResetPending((prev) => ({ ...prev, [errorKey]: false }));
    }
  });

  const resolveMountedDiskId = (drive: DriveKey) => {
    const driveInfo = drivesData?.drives?.find((entry) => entry[drive])?.[drive];
    const mountedOverride = mountedByDrive[drive];
    if (mountedOverride === "") return null;
    if (mountedOverride) return mountedOverride;
    if (!driveInfo?.image_file) return null;
    // HARD19-007: a materialized mount path-mounts an internal work file, so the
    // poll reports the work filename. Map it back to the materialized disk so
    // rotation and delete-while-mounted protection keep working after the
    // component's optimistic override is lost.
    const workPath = getMaterializedWorkPath(drive);
    if (workPath && getDiskName(driveInfo.image_file) === getDiskName(workPath)) {
      return getMaterializedDiskId(drive);
    }
    const fullPath = buildDrivePath(driveInfo.image_path, driveInfo.image_file);
    if (!fullPath) return null;
    const disk = diskLibrary.disks.find((entry) => entry.location === "ultimate" && entry.path === fullPath);
    return disk?.id ?? null;
  };

  const withRetry = async <T,>(operation: string, run: () => Promise<T>, attempts = 2) => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        lastError = error as Error;
        if (attempt >= attempts) break;
        addErrorLog("Drive config update retry", {
          operation,
          attempt,
          attempts,
          error: lastError.message,
        });
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 120);
        });
      }
    }
    throw new Error(`${operation} failed: ${lastError?.message ?? "unknown error"}`);
  };

  const handleDriveConfigUpdate = trace(
    async (
      drive: DriveKey,
      itemName: string,
      value: string | number,
      successTitle: string,
      successDescription: string,
    ) => {
      if (!status.isConnected) return;
      setDriveConfigPending((prev) => ({ ...prev, [drive]: true }));
      try {
        const category = DRIVE_CONFIG_CATEGORY[drive];
        await withRetry(`${buildDriveLabel(drive)} ${itemName} update`, () =>
          api.setConfigValue(category, itemName, value),
        );
        setDriveErrors((prev) => ({ ...prev, [drive]: "" }));
        toast({ title: successTitle, description: successDescription });
        await Promise.all([
          queryClient.invalidateQueries({
            predicate: (query) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === "c64-config-items" &&
              query.queryKey[1] === category,
          }),
          queryClient.invalidateQueries({ queryKey: ["c64-drives"] }),
        ]);
      } catch (error) {
        setDriveErrors((prev) => ({
          ...prev,
          [drive]: (error as Error).message,
        }));
        reportUserError({
          operation: "DRIVE_CONFIG_UPDATE",
          title: "Drive setting update failed",
          description: (error as Error).message,
          error,
          context: { drive, itemName, value },
        });
      } finally {
        setDriveConfigPending((prev) => ({ ...prev, [drive]: false }));
      }
    },
  );

  const handleSoftIecConfigUpdate = trace(
    async (
      itemName: "IEC Drive" | "Soft Drive Bus ID" | "Default Path",
      value: string | number,
      successTitle: string,
      successDescription: string,
    ) => {
      if (!status.isConnected) return false;
      setSoftIecConfigPending(true);
      try {
        await withRetry(`Soft IEC ${itemName} update`, () =>
          api.setConfigValue(SOFT_IEC_CONTROL.category, itemName, value),
        );
        setDriveErrors((prev) => ({ ...prev, softiec: "" }));
        toast({ title: successTitle, description: successDescription });
        await Promise.all([
          refreshDrivesFromDevice(),
          queryClient.invalidateQueries({
            predicate: (query) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === "c64-config-items" &&
              query.queryKey[1] === SOFT_IEC_CONTROL.category,
          }),
        ]);
        return true;
      } catch (error) {
        setDriveErrors((prev) => ({
          ...prev,
          softiec: (error as Error).message,
        }));
        reportUserError({
          operation: "SOFT_IEC_CONFIG_UPDATE",
          title: "Soft IEC setting update failed",
          description: (error as Error).message,
          error,
          context: { itemName, value },
        });
        return false;
      } finally {
        setSoftIecConfigPending(false);
      }
    },
  );

  const handleSoftIecDirectorySelect = trace(async (source: SourceLocation, selections: SelectedItem[]) => {
    if (!status.isConnected) {
      reportUserError({
        operation: "SOFT_IEC_CONFIG_UPDATE",
        title: "Offline",
        description: "Connect to select a default directory.",
      });
      return false;
    }
    if (source.type !== "ultimate") {
      reportUserError({
        operation: "SOFT_IEC_CONFIG_UPDATE",
        title: "Unsupported source",
        description: "Default Path must be selected from C64U storage.",
      });
      return false;
    }

    const directorySelection = selections.find((selection) => selection.type === "dir");
    if (!directorySelection) {
      reportUserError({
        operation: "SOFT_IEC_CONFIG_UPDATE",
        title: "Select directory",
        description: "Choose a folder. File selection is not supported for Default Path.",
      });
      return false;
    }

    const directoryPath = normalizeDirectoryPath(directorySelection.path);
    return handleSoftIecConfigUpdate(
      SOFT_IEC_DEFAULT_PATH_ITEM,
      directoryPath,
      "Soft IEC default path updated",
      `Default Path set to ${directoryPath}`,
    );
  });

  const handleRotate = trace(async (drive: DriveKey, direction: 1 | -1) => {
    const currentId = resolveMountedDiskId(drive);
    if (!currentId) return;
    const current = disksById[currentId];
    if (!current?.group) return;

    const groupDisks = diskLibrary.disks
      .filter((disk) => disk.group === current.group)
      .slice()
      .sort((a, b) => {
        const orderA = a.importOrder ?? null;
        const orderB = b.importOrder ?? null;
        if (orderA !== null && orderB !== null) {
          return orderA - orderB;
        }
        return a.name.localeCompare(b.name);
      });

    if (groupDisks.length < 2) return;
    const index = groupDisks.findIndex((disk) => disk.id === current.id);
    const nextIndex = (index + direction + groupDisks.length) % groupDisks.length;
    const nextDisk = groupDisks[nextIndex];
    if (!nextDisk) return;
    await handleMountDisk(drive, nextDisk);
  });

  const handleDeleteDisk = trace(async (disk: DiskEntry, options: { suppressToast?: boolean } = {}) => {
    const mountedDrives = DRIVE_KEYS.filter((drive) => resolveMountedDiskId(drive) === disk.id);
    if (mountedDrives.length > 0) {
      try {
        // HARD18-017: a bare unmountDrive + deleting the override leaves
        // resolveMountedDiskId falling through to the (not-yet-settled)
        // polled drive state, ghost-mounting the card until the next poll
        // lands. Reuse handleEject's body per mounted drive - settle
        // polling through the mutation, then force the override to empty
        // with a fresh timestamp - so the card reflects "unmounted"
        // immediately, before the disk is removed from the library.
        await Promise.all(
          mountedDrives.map((drive) => runDriveMutationWithSettledPolling(() => api.unmountDrive(drive))),
        );
        // HARD18-025: the disk is being removed from the library outright -
        // there is no source left to write back to, so drop any pending
        // materialized-mount entry instead of spending an FTP round trip.
        mountedDrives.forEach((drive) => discardDiskWriteBack(drive));
        setMountedByDrive((prev) => {
          const next = { ...prev };
          mountedDrives.forEach((drive) => {
            mountedByDriveSetAtRef.current[drive] = Date.now();
            next[drive] = "";
          });
          return next;
        });
        if (!options.suppressToast) {
          toast({
            title: "Disk removed",
            description: "Disk ejected from mounted drives.",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "Disk eject failed");
        addErrorLog("Disk eject failed", { diskId: disk.id, drives: mountedDrives, error: message });
        reportUserError({
          operation: "DISK_EJECT_BEFORE_DELETE",
          title: "Disk eject failed",
          description: "The disk was not removed from the collection because it is still mounted.",
          error,
          context: { diskId: disk.id, drives: mountedDrives },
        });
        return false;
      }
    }
    diskLibrary.removeDisk(disk.id);
    return true;
  });

  const handleBulkDelete = async () => {
    const disksToRemove = diskLibrary.disks.filter((disk) => selectedDiskIds.has(disk.id));
    if (!disksToRemove.length) {
      setBulkDeleteOpen(false);
      return;
    }
    const results = await Promise.all(disksToRemove.map((disk) => handleDeleteDisk(disk, { suppressToast: true })));
    const removedCount = results.filter(Boolean).length;
    setSelectedDiskIds(new Set());
    setBulkDeleteOpen(false);
    toast({
      title: "Disks removed",
      description: `${removedCount} disk(s) removed from the library.`,
    });
  };

  const handleAddDiskSelections = useCallback(
    trace(async (source: SourceLocation, selections: SelectedItem[]) => {
      if (isAddingItems) return false;
      let abortController: AbortController | null = null;
      let handleConnectionChange: EventListener | null = null;
      try {
        const startedAt = Date.now();
        addItemsStartedAtRef.current = startedAt;
        const localTreeUri =
          source.type === "local" ? (localSourcesById.get(source.id)?.android?.treeUri ?? null) : null;
        if (localTreeUri) {
          addLog("debug", "SAF disk scan started", {
            sourceId: source.id,
            treeUri: redactTreeUri(localTreeUri),
            rootPath: source.rootPath,
          });
        }
        if (!browserOpen) {
          setAddItemsSurface("page");
          if (!addItemsOverlayActiveRef.current) {
            setShowAddItemsOverlay(true);
            addItemsOverlayStartedAtRef.current = Date.now();
            addItemsOverlayActiveRef.current = true;
          }
        }
        setIsAddingItems(true);
        setAddItemsProgress({
          status: "scanning",
          count: 0,
          elapsedMs: 0,
          total: null,
          message: "Scanning…",
        });
        abortController = new AbortController();
        const activeAbortController = abortController;
        addItemsAbortRef.current = activeAbortController;
        const abortSignal = activeAbortController.signal;
        const selectedDeviceIdAtStart = getSavedDevicesSnapshot().selectedDeviceId;
        const createAbortError = () => {
          if (typeof DOMException !== "undefined") {
            return new DOMException("Add items scan cancelled", "AbortError");
          }
          const error = new Error("Add items scan cancelled");
          error.name = "AbortError";
          return error;
        };
        const throwIfAborted = () => {
          if (abortSignal.aborted) {
            throw createAbortError();
          }
          if (getSavedDevicesSnapshot().selectedDeviceId !== selectedDeviceIdAtStart) {
            activeAbortController.abort();
            throw createAbortError();
          }
        };
        handleConnectionChange = (event: Event) => {
          const detail = (event as CustomEvent<{ reason?: string }>).detail;
          if (detail?.reason !== "saved-device-switch") return;
          activeAbortController.abort();
        };
        if (typeof window !== "undefined") {
          window.addEventListener("c64u-connection-change", handleConnectionChange);
        }
        await yieldToRenderer();
        let processed = 0;
        let lastUpdate = 0;

        const updateProgress = (delta: number) => {
          throwIfAborted();
          processed += delta;
          const now = Date.now();
          if (now - lastUpdate < 120) return;
          lastUpdate = now;
          setAddItemsProgress((prev) => ({
            ...prev,
            count: processed,
            elapsedMs: now - startedAt,
          }));
        };

        if (source.type === "commoserve") {
          const config = archiveConfigs[source.id];
          if (!config) {
            throw new Error(`Archive source configuration unavailable for ${source.name}.`);
          }
          const archiveClient = createArchiveClient(config);
          const runtimeFiles: Record<string, File> = {};
          const disks: DiskEntry[] = [];

          for (const [index, selection] of selections.entries()) {
            throwIfAborted();
            const { resultId, category } = parseArchiveSelectionPath(selection.path);
            const entries = await archiveClient.getEntries(resultId, category, { signal: abortSignal });
            const diskEntry = entries.find((entry) => isDiskImagePath(entry.path));
            if (!diskEntry) {
              addLog("warn", "Archive result skipped because it has no disk image", {
                sourceId: source.id,
                sourceName: source.name,
                resultId,
                category,
                selectionName: selection.name,
              });
              updateProgress(1);
              continue;
            }
            const binary = await archiveClient.downloadBinary(resultId, category, diskEntry.id, diskEntry.path, {
              signal: abortSignal,
            });
            throwIfAborted();
            const normalized = normalizeDiskPath(binary.fileName || diskEntry.path);
            const entry = createDiskEntry({
              path: normalized,
              location: "local",
              sourceId: source.id,
              sourceKind: "commoserve",
              // Persist the deterministic archive coordinates so the disk can be
              // re-downloaded on mount after its in-memory runtime bytes are lost
              // (device switch / app restart). See HARD10-002.
              archiveRef: {
                sourceId: source.id,
                resultId,
                category,
                entryId: diskEntry.id,
                entryPath: diskEntry.path,
              },
              name: binary.fileName || selection.name,
              group: source.name,
              sizeBytes: binary.bytes.byteLength,
              modifiedAt: diskEntry.date ? new Date(diskEntry.date).toISOString() : null,
              importOrder: index,
            });
            const fileBytes = new ArrayBuffer(binary.bytes.byteLength);
            new Uint8Array(fileBytes).set(binary.bytes);
            runtimeFiles[entry.id] = new File([fileBytes], entry.name, {
              type: binary.contentType ?? "application/octet-stream",
            });
            disks.push(entry);
            updateProgress(1);
          }

          if (!disks.length) {
            setAddItemsProgress((prev) => ({
              ...prev,
              status: "error",
              message: "No disk images found in selected archive results.",
            }));
            showNoDiskWarning();
            return false;
          }

          diskLibrary.addDisks(disks, runtimeFiles, {
            expectedSelectedDeviceId: selectedDeviceIdAtStart,
          });
          setAddItemsProgress((prev) => ({
            ...prev,
            status: "done",
            message: "Added to library",
          }));
          toast({
            title: "Items added",
            description: `${disks.length} disk(s) added to library.`,
          });
          return true;
        }

        let files: Array<{
          path: string;
          name: string;
          sizeBytes?: number | null;
          modifiedAt?: string | null;
          sourceId?: string | null;
        }> = [];
        const partialScanFailures: SourceRecursiveFailure[] = [];
        const listingCache = new Map<string, SourceEntry[]>();
        const resolveSelectionEntry = async (filePath: string) => {
          const normalizedPath = normalizeSourcePath(filePath);
          const parent = normalizedPath.slice(0, normalizedPath.lastIndexOf("/") + 1) || "/";
          if (!listingCache.has(parent)) {
            try {
              listingCache.set(parent, await source.listEntries(parent));
            } catch (error) {
              addLog("warn", "Failed to list source entries for selection", {
                path: parent,
                sourceId: source.id,
                error: (error as Error).message,
              });
              listingCache.set(parent, []);
            }
          }
          const entries = listingCache.get(parent) ?? [];
          return (
            entries.find((entry) => entry.type === "file" && normalizeSourcePath(entry.path) === normalizedPath) ?? null
          );
        };
        for (const selection of selections) {
          throwIfAborted();
          if (selection.type === "dir") {
            // Report progress incrementally during the recursive walk so a slow
            // broad-folder scan (e.g. a deep C64U FTP tree) shows a climbing
            // count instead of a stuck "Scanning… 0 items"
            // (S2-DISKS-FTP-RECURSIVE-SCAN-STALL). Adapters without incremental
            // reporting backfill the remainder once the walk returns.
            let reportedDuringScan = 0;
            const nested = await source.listFilesRecursive(selection.path, {
              signal: abortSignal,
              onProgress: (delta) => {
                reportedDuringScan += delta;
                updateProgress(delta);
              },
            });
            if (nested.partialFailures?.length) {
              partialScanFailures.push(...nested.partialFailures);
              addLog("warn", "Disk import completed with skipped folders", {
                sourceId: source.id,
                sourceType: source.type,
                selectionPath: selection.path,
                skippedFolders: nested.partialFailures,
              });
            }
            throwIfAborted();
            if (nested.length > reportedDuringScan) {
              updateProgress(nested.length - reportedDuringScan);
            }
            nested.forEach((entry) => {
              if (entry.type !== "file") return;
              files.push({
                path: entry.path,
                name: entry.name,
                sizeBytes: entry.sizeBytes,
                modifiedAt: entry.modifiedAt,
                sourceId: source.id,
              });
            });
          } else {
            const entryPath = normalizeSourcePath(selection.path);
            const meta = await resolveSelectionEntry(entryPath);
            throwIfAborted();
            files.push({
              path: entryPath,
              name: meta?.name ?? selection.name,
              sizeBytes: meta?.sizeBytes ?? null,
              modifiedAt: meta?.modifiedAt ?? null,
              sourceId: source.id,
            });
            updateProgress(1);
          }
        }

        let diskCandidates = files.filter((entry) => isDiskImagePath(entry.path));
        if (
          !diskCandidates.length &&
          source.type === "local" &&
          selections.length === 1 &&
          selections[0]?.type === "dir"
        ) {
          const selectionPath = normalizeSourcePath(selections[0].path);
          const rootPath = normalizeSourcePath(source.rootPath);
          if (selectionPath === rootPath) {
            const localSource = localSourcesById.get(source.id);
            if (localSource && getLocalSourceListingMode(localSource) === "entries") {
              try {
                const entries = requireLocalSourceEntries(localSource, "HomeDiskManager.localFallback");
                files = entries.map((entry) => ({
                  path: normalizeSourcePath(entry.relativePath),
                  name: entry.name,
                  sizeBytes: entry.sizeBytes ?? null,
                  modifiedAt: entry.modifiedAt ?? null,
                  sourceId: source.id,
                }));
                diskCandidates = files.filter((entry) => isDiskImagePath(entry.path));
              } catch (error) {
                addErrorLog("Local source fallback failed", {
                  sourceId: localSource.id,
                  error: {
                    name: (error as Error).name,
                    message: (error as Error).message,
                    stack: (error as Error).stack,
                  },
                });
              }
            }
          }
        }
        if (!diskCandidates.length) {
          addLog("debug", "No disk files after scan", {
            sourceId: source.id,
            sourceType: source.type,
            reason: "no-disk-files",
            totalFiles: files.length,
          });
          setAddItemsProgress((prev) => ({
            ...prev,
            status: "error",
            message: partialScanFailures.length ? "No disk files found in scanned folders." : "No disk files found.",
          }));
          showNoDiskWarning();
          return false;
        }

        const groupMap = assignDiskGroupsByPrefix(
          diskCandidates.map((entry) => ({
            path: normalizeDiskPath(entry.path),
            name: entry.name,
          })),
        );

        const runtimeFiles: Record<string, File> = {};
        const disks = await Promise.all(
          diskCandidates.map(async (entry, index) => {
            const normalized = normalizeDiskPath(entry.path);
            const autoGroup = groupMap.get(normalized);
            const fallbackGroup = getLeafFolderName(normalized);
            const groupName = autoGroup ?? fallbackGroup ?? null;
            const localSource = source.type === "local" ? localSourcesById.get(source.id) : null;
            let localEntry: { uri?: string | null } | null = null;
            if (localSource && getLocalSourceListingMode(localSource) === "entries") {
              try {
                const entries = requireLocalSourceEntries(localSource, "HomeDiskManager.localEntry");
                localEntry = entries.find((item) => normalizeSourcePath(item.relativePath) === normalized) ?? null;
              } catch (error) {
                addErrorLog("Local source entries unavailable", {
                  sourceId: localSource.id,
                  error: {
                    name: (error as Error).name,
                    message: (error as Error).message,
                    stack: (error as Error).stack,
                  },
                });
              }
            }
            throwIfAborted();
            const playbackConfig = await discoverDiskPlaybackConfig(source, {
              path: normalized,
              name: entry.name,
            });
            throwIfAborted();
            const diskEntry = createDiskEntry({
              path: normalized,
              location: source.type === "ultimate" ? "ultimate" : "local",
              group: groupName,
              sourceId: source.type === "local" ? source.id : null,
              localUri: localEntry?.uri ?? null,
              localTreeUri: localSource?.android?.treeUri ?? null,
              sizeBytes: entry.sizeBytes ?? null,
              modifiedAt: entry.modifiedAt ?? null,
              importOrder: index,
              configRef: playbackConfig.configRef,
              configOrigin: playbackConfig.configOrigin,
              configOverrides: playbackConfig.configOverrides,
              configCandidates: playbackConfig.configCandidates,
            });
            if (source.type === "local") {
              const runtime = resolveLocalRuntimeFile(source.id, normalized);
              if (runtime) runtimeFiles[diskEntry.id] = runtime;
            }
            return diskEntry;
          }),
        );

        const minDuration = addItemsSurface === "page" ? 800 : 300;
        await waitAtLeast(startedAt, minDuration);

        throwIfAborted();
        diskLibrary.addDisks(disks, runtimeFiles, {
          expectedSelectedDeviceId: selectedDeviceIdAtStart,
        });
        if (localTreeUri) {
          addLog("debug", "SAF disk scan complete", {
            sourceId: source.id,
            treeUri: redactTreeUri(localTreeUri),
            totalFiles: files.length,
            supportedFiles: diskCandidates.length,
            elapsedMs: Date.now() - startedAt,
          });
        }
        setAddItemsProgress((prev) => ({
          ...prev,
          status: "done",
          message: partialScanFailures.length ? "Added with skipped folders" : "Added to library",
        }));
        toast({
          title: "Items added",
          description: partialScanFailures.length
            ? `${disks.length} disk(s) added. ${partialScanFailures.length} folder(s) could not be scanned.`
            : `${disks.length} disk(s) added to library.`,
        });
        return true;
      } catch (error) {
        const err = error as Error;
        if (err.name === "AbortError") {
          addLog("debug", "Add items scan cancelled", {
            sourceId: source.id,
            sourceType: source.type,
            selectionCount: selections.length,
            target: "disks",
          });
          setAddItemsProgress((prev) => ({
            ...prev,
            status: "idle",
            message: "Add cancelled",
          }));
          return false;
        }
        const listingDetails = err instanceof LocalSourceListingError ? err.details : undefined;
        setAddItemsProgress((prev) => ({
          ...prev,
          status: "error",
          message: "Add items failed",
        }));
        reportUserError({
          operation: "DISK_IMPORT",
          title: "Add items failed",
          description: err.message,
          error: err,
          context: {
            sourceId: source.id,
            sourceType: source.type,
            platform: getPlatform(),
            details: listingDetails,
          },
        });
        return false;
      } finally {
        if (typeof window !== "undefined" && handleConnectionChange) {
          window.removeEventListener("c64u-connection-change", handleConnectionChange);
        }
        setIsAddingItems(false);
        if (abortController && addItemsAbortRef.current === abortController) {
          addItemsAbortRef.current = null;
        }
        if (addItemsStartedAtRef.current) {
          setAddItemsProgress((prev) => ({
            ...prev,
            elapsedMs: Date.now() - addItemsStartedAtRef.current!,
          }));
        }
        if (addItemsOverlayActiveRef.current) {
          const overlayStartedAt = addItemsOverlayStartedAtRef.current ?? addItemsStartedAtRef.current ?? Date.now();
          const minOverlayDuration = 800;
          await waitAtLeast(overlayStartedAt, minOverlayDuration);
          setShowAddItemsOverlay(false);
          addItemsOverlayStartedAtRef.current = null;
          addItemsOverlayActiveRef.current = false;
        }
      }
    }),
    [
      addItemsSurface,
      archiveConfigs,
      browserOpen,
      diskLibrary,
      isAddingItems,
      localSourcesById,
      reportUserError,
      showNoDiskWarning,
      trace,
    ],
  );

  const handleAddLocalSourceFromPicker = useCallback(
    trace(async () => {
      const source = await addSourceFromPicker(localSourceInputRef.current);
      if (!source) return null;
      const location = createLocalSourceLocation(source);
      const success = await handleAddDiskSelections(location, [
        { type: "dir", name: location.name, path: location.rootPath },
      ]);
      if (success && browserOpen) {
        await yieldToRenderer();
        setBrowserOpen(false);
      }
      return source.id;
    }),
    [addSourceFromPicker, browserOpen, handleAddDiskSelections, trace],
  );

  const buildDiskMenuItems = useCallback((disk: DiskEntry, disableActions?: boolean): ActionListMenuItem[] => {
    const detailsDate = disk.modifiedAt || disk.importedAt;
    const configUiState = resolvePlaybackConfigUiState({
      configRef: disk.configRef ?? null,
      configOrigin: disk.configOrigin ?? resolveStoredConfigOrigin(disk.configRef ?? null, null),
      configOverrides: disk.configOverrides ?? null,
      configCandidates: disk.configCandidates ?? null,
    });
    return [
      { type: "label", label: "Details" },
      { type: "info", label: "Size", value: formatBytes(disk.sizeBytes) },
      { type: "info", label: "Date", value: formatDate(detailsDate) },
      { type: "separator" },
      { type: "label", label: "Config" },
      { type: "info", label: "Attached", value: disk.configRef?.fileName ?? "None" },
      { type: "info", label: "Origin", value: describeConfigOrigin(disk.configOrigin ?? "none") },
      {
        type: "info",
        label: "Status",
        value:
          configUiState === "edited"
            ? "Edited"
            : configUiState === "resolved"
              ? "Resolved"
              : configUiState === "candidates"
                ? "Candidates found"
                : configUiState === "declined"
                  ? "Declined"
                  : "No config",
      },
      { type: "separator" },
      {
        type: "action",
        label: "Set group…",
        onSelect: () => {
          setGroupDialogDisk(disk);
          setGroupName(disk.group || "");
        },
        disabled: disableActions,
      },
      {
        type: "action",
        label: "Rename disk…",
        onSelect: () => {
          setRenameDialogDisk(disk);
          setRenameValue(disk.name || "");
        },
        disabled: disableActions,
      },
      {
        type: "action",
        label: "Remove from collection",
        onSelect: () => setDeleteDialogDisk(disk),
        disabled: disableActions,
        destructive: true,
      },
    ];
  }, []);

  const buildDiskListItems = useCallback(
    (
      disks: DiskEntry[],
      options?: {
        showSelection?: boolean;
        showMenu?: boolean;
        disableActions?: boolean;
        onMount?: (disk: DiskEntry) => void;
      },
    ) => {
      let lastFolder: string | null = null;
      return disks.reduce<ActionListItem[]>((acc, disk) => {
        const folderPath = getDiskFolderPath(disk.path);
        if (folderPath !== lastFolder) {
          acc.push({
            id: `folder:${folderPath}`,
            title: folderPath,
            variant: "header",
            icon: <Folder className="h-3.5 w-3.5" aria-hidden="true" />,
            selected: false,
            actionLabel: "",
            showMenu: false,
            showSelection: false,
            disableActions: true,
          });
          lastFolder = folderPath;
        }
        const groupColor = disk.group ? pickDiskGroupColor(disk.group) : null;
        const configUiState = resolvePlaybackConfigUiState({
          configRef: disk.configRef ?? null,
          configOrigin: disk.configOrigin ?? resolveStoredConfigOrigin(disk.configRef ?? null, null),
          configOverrides: disk.configOverrides ?? null,
          configCandidates: disk.configCandidates ?? null,
        });
        const configStatusLabel =
          configUiState === "edited"
            ? "CFG*"
            : configUiState === "resolved"
              ? "CFG"
              : configUiState === "candidates"
                ? "CFG?"
                : configUiState === "declined"
                  ? "No CFG"
                  : null;
        const groupMeta = disk.group ? (
          <span className="flex items-center gap-1 min-w-0">
            <span className={cn("h-2 w-2 rounded-full border", groupColor?.chip)} aria-hidden="true" />
            <span className={cn(groupColor?.text, "break-words min-w-0")}>Group: {disk.group}</span>
          </span>
        ) : null;
        acc.push({
          id: disk.id,
          title: disk.name,
          filterText: `${disk.name} ${disk.path} ${disk.group ?? ""}`,
          meta: (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              {groupMeta}
              {configStatusLabel ? <span>{configStatusLabel}</span> : null}
            </div>
          ),
          icon: <LocationIcon location={disk.location} />,
          selected: selectedDiskIds.has(disk.id),
          onSelectToggle: (selected) => handleDiskSelect(disk, selected),
          menuItems: buildDiskMenuItems(disk, options?.disableActions),
          disableActions: options?.disableActions,
          actionLabel: "Mount",
          actionIcon: <HardDrive className="h-4 w-4" aria-hidden="true" />,
          onAction: () => options?.onMount?.(disk),
          onTitleClick: () => options?.onMount?.(disk),
          actionAriaLabel: `Mount ${disk.name}`,
          showSelection: options?.showSelection !== false,
          showMenu: options?.showMenu !== false,
        } as ActionListItem);
        return acc;
      }, []);
    },
    [buildDiskMenuItems, handleDiskSelect, selectedDiskIds],
  );

  const driveRows = DRIVE_KEYS.map((key) => {
    const info = drivesData?.drives?.find((entry) => entry[key])?.[key];
    const driveConfigPayload = key === "a" ? driveAConfig : driveBConfig;
    const busId = resolveDriveBusId(key, driveConfigPayload, info);
    const driveType = resolveDriveType(key, driveConfigPayload, info);
    const driveCategory = DRIVE_CONFIG_CATEGORY[key];
    const busOptions = buildBusIdOptions(
      busDefaultsFor(driveCategory, DRIVE_BUS_ID_ITEM, DRIVE_BUS_ID_DEFAULTS),
      busId,
    );
    const driveTypeOptions = buildTypeOptions([...typeOptionsFor(driveCategory, DRIVE_TYPE_ITEM)], driveType);
    const powerOverride = drivePowerOverride[key];
    const powerEnabled = powerOverride ?? info?.enabled;
    const hasPowerState = typeof powerEnabled === "boolean";
    const powerLabel = powerEnabled ? "Turn Off" : "Turn On";
    const powerTarget = !powerEnabled;
    const powerPending = Boolean(drivePowerPending[key]);
    const mountedDiskId = resolveMountedDiskId(key);
    const forcedEmpty = mountedByDrive[key] === "";
    const mounted = forcedEmpty ? false : Boolean(info?.image_file || mountedDiskId);
    const mountedDisk = mountedDiskId ? disksById[mountedDiskId] : null;
    const groupSize = mountedDisk?.group
      ? diskLibrary.disks.filter((disk) => disk.group === mountedDisk.group).length
      : 0;
    const canRotate = Boolean(mountedDisk?.group && groupSize > 1);
    const mountedDiskName = forcedEmpty ? null : mountedDisk?.name || info?.image_file || null;
    const mountedLabel = mountedDiskName ?? "No disk mounted";

    const rawStatusLine = resolveDriveStatusRaw(driveErrors[key], info?.last_error);
    const formattedStatus = rawStatusLine ? formatDiskDosStatus(rawStatusLine) : null;

    return {
      key,
      driveLabel: buildDriveLabel(key),
      info,
      mounted,
      mountedDisk,
      canRotate,
      mountedLabel,
      busId,
      busOptions,
      driveType,
      driveTypeOptions,
      powerEnabled,
      hasPowerState,
      powerLabel,
      powerTarget,
      powerPending,
      configPending: Boolean(driveConfigPending[key]),
      resetPending: Boolean(driveResetPending[key]),
      mountPending: Boolean(driveMutationPending[key]),
      formattedStatus,
    };
  });

  const softIecConfigBusId = parseBusId(
    getCategoryConfigValue(softIecConfig, SOFT_IEC_CONTROL.category, SOFT_IEC_CONTROL.busItem),
  );
  const softIecBusId = softIecConfigBusId ?? softIecDevice?.busId ?? 11;
  const softIecBusOptions = buildBusIdOptions(
    busDefaultsFor(SOFT_IEC_CONTROL.category, SOFT_IEC_CONTROL.busItem, SOFT_IEC_BUS_ID_DEFAULTS),
    softIecBusId,
  );
  const softIecDefaultPath = resolveSoftIecDefaultPath(softIecConfig, softIecDevice?.partitions?.[0]?.path ?? null);
  const softIecMounted = Boolean(softIecDevice?.imageFile);
  const softIecMountedLabel = softIecDevice?.imageFile ?? "No disk mounted";
  const softIecPowerEnabled = drivePowerOverride.softiec ?? softIecDevice?.enabled ?? false;
  const softIecHasPowerState = typeof softIecPowerEnabled === "boolean";
  const softIecPowerLabel = softIecPowerEnabled ? "Turn Off" : "Turn On";
  const softIecPowerTarget = !softIecPowerEnabled;
  const softIecResetPending = Boolean(driveResetPending.softiec);
  const softIecPowerPending = Boolean(drivePowerPending.softiec);
  const softIecEndpointKey = softIecDevice?.endpointKey ?? "softiec";
  const softIecRawStatus = resolveDriveStatusRaw(
    driveErrors.softiec,
    resolveSoftIecServiceError(softIecDevice?.lastError),
  );
  const softIecFormattedStatus = softIecRawStatus ? formatDiskDosStatus(softIecRawStatus) : null;

  return (
    <div className="space-y-6">
      <ProfileSplitSection minColumnWidth="22rem" testId="disks-primary-layout">
        <section className="space-y-3">
          <h3 className="category-header">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Drives
          </h3>
          <div className="grid gap-3">
            {driveRows.map(
              ({
                key,
                driveLabel,
                mounted,
                mountedDisk,
                canRotate,
                mountedLabel,
                busId,
                busOptions,
                driveType,
                driveTypeOptions,
                powerEnabled,
                hasPowerState,
                powerLabel,
                powerTarget,
                powerPending,
                configPending,
                resetPending,
                mountPending,
                formattedStatus,
              }) => (
                <div key={key} className="config-card space-y-2" data-testid={`drive-card-${key}`}>
                  <div className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{driveLabel}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <FocusableDiskButton
                        focusId={`disks-drive-${key}-status-toggle`}
                        focusOrder={driveFocusOrder(DRIVE_KEYS.indexOf(key), 0)}
                        variant="outline"
                        size="sm"
                        className={cn(ROW1_CONTROL_CLASS, getOnOffButtonClass(powerEnabled))}
                        onClick={() => void handleToggleDrivePower(key, driveLabel, powerTarget, key)}
                        disabled={!status.isConnected || !hasPowerState || powerPending || configPending}
                        data-testid={`drive-status-toggle-${key}`}
                      >
                        {powerEnabled ? "ON" : "OFF"}
                      </FocusableDiskButton>
                      <FocusableDiskButton
                        focusId={`disks-drive-${key}-mount-toggle`}
                        focusOrder={driveFocusOrder(DRIVE_KEYS.indexOf(key), 10)}
                        variant={mounted ? "secondary" : "outline"}
                        size="sm"
                        className={ROW1_CONTROL_CLASS}
                        onClick={() => {
                          if (mounted) {
                            void handleEject(key);
                          } else {
                            setActiveDrive(key);
                          }
                        }}
                        disabled={!status.isConnected || configPending || mountPending}
                        data-testid={`drive-mount-toggle-${key}`}
                        aria-label={`${driveLabel} ${mounted ? "Eject disk" : "Mount disk"}`}
                      >
                        <Disc className={cn("h-4 w-4", mounted ? "text-success" : "text-muted-foreground")} />
                      </FocusableDiskButton>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "min-w-0 overflow-hidden text-xs text-muted-foreground",
                      profile === "compact"
                        ? "grid gap-2 whitespace-normal"
                        : "flex items-center gap-1 whitespace-nowrap",
                    )}
                  >
                    <span className="shrink-0">Bus ID</span>
                    <Select
                      value={String(busId)}
                      onValueChange={(value) =>
                        void handleDriveConfigUpdate(
                          key,
                          DRIVE_BUS_ID_ITEM,
                          Number(value),
                          "Drive Bus ID updated",
                          `${driveLabel} now uses device #${value}.`,
                        )
                      }
                      disabled={!status.isConnected || configPending}
                    >
                      <SelectTrigger
                        className={cn(INLINE_META_SELECT_CLASS, "w-[76px] min-w-[76px]")}
                        aria-label={`${driveLabel} Bus ID`}
                        data-testid={`drive-bus-select-${key}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {busOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            #{option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {profile === "compact" ? null : (
                      <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
                        •
                      </span>
                    )}
                    <span className="shrink-0">Drive Type</span>
                    <Select
                      value={driveType}
                      onValueChange={(value) =>
                        void handleDriveConfigUpdate(
                          key,
                          DRIVE_TYPE_ITEM,
                          value,
                          "Drive Type updated",
                          `${driveLabel} switched to ${value} mode.`,
                        )
                      }
                      disabled={!status.isConnected || configPending}
                    >
                      <SelectTrigger
                        className={cn(INLINE_META_SELECT_CLASS, "w-[80px] min-w-[80px]")}
                        aria-label={`${driveLabel} Drive Type`}
                        data-testid={`drive-type-select-${key}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {driveTypeOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div
                    className={cn(
                      "min-w-0 justify-between gap-2",
                      profile === "compact" ? "grid" : "flex items-center",
                    )}
                  >
                    <div className={cn("min-w-0 items-center gap-1.5", profile === "compact" ? "grid" : "flex")}>
                      <ResponsivePathText
                        path={mountedLabel}
                        mode="start-and-filename"
                        className="min-w-0 flex-1 text-xs text-muted-foreground"
                        dataTestId={`drive-mounted-label-${key}`}
                      />
                      {mountedDisk?.group ? (
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full border",
                            pickDiskGroupColor(mountedDisk.group).chip,
                          )}
                          aria-hidden="true"
                        />
                      ) : null}
                      {mountedDisk?.group ? (
                        <span className={cn(pickDiskGroupColor(mountedDisk.group).text, "truncate text-[11px]")}>
                          {mountedDisk.group}
                        </span>
                      ) : null}
                      {canRotate ? (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <FocusableDiskButton
                            focusId={`disks-drive-${key}-rotate-previous`}
                            focusOrder={driveFocusOrder(DRIVE_KEYS.indexOf(key), 20)}
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => void handleRotate(key, -1)}
                            disabled={!status.isConnected || configPending || mountPending}
                            aria-label={`${driveLabel} previous disk`}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </FocusableDiskButton>
                          <FocusableDiskButton
                            focusId={`disks-drive-${key}-rotate-next`}
                            focusOrder={driveFocusOrder(DRIVE_KEYS.indexOf(key), 30)}
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => void handleRotate(key, 1)}
                            disabled={!status.isConnected || configPending || mountPending}
                            aria-label={`${driveLabel} next disk`}
                          >
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                          </FocusableDiskButton>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <FocusableDiskButton
                        focusId={`disks-drive-${key}-reset`}
                        focusOrder={driveFocusOrder(DRIVE_KEYS.indexOf(key), 40)}
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => void handleResetDrive(key, driveLabel, key)}
                        disabled={!status.isConnected || resetPending || configPending}
                        aria-label={`Reset ${driveLabel}`}
                        data-testid={`drive-reset-${key}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </FocusableDiskButton>
                      <FocusableDiskButton
                        focusId={`disks-drive-${key}-power-toggle`}
                        focusOrder={driveFocusOrder(DRIVE_KEYS.indexOf(key), 50)}
                        variant="default"
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={() => void handleToggleDrivePower(key, driveLabel, powerTarget, key)}
                        disabled={!status.isConnected || !hasPowerState || powerPending || configPending}
                        data-testid={`drive-power-toggle-${key}`}
                      >
                        {powerLabel}
                      </FocusableDiskButton>
                    </div>
                  </div>

                  {formattedStatus ? (
                    <div className="space-y-0.5" data-testid={`drive-status-${key}`}>
                      {formattedStatus.message ? (
                        <p
                          className={cn("text-xs", getStatusMessageColorClass(formattedStatus))}
                          data-testid={`drive-status-message-${key}`}
                        >
                          {formattedStatus.message}
                        </p>
                      ) : null}
                      {formattedStatus.raw ? (
                        <p
                          className="text-xs text-muted-foreground whitespace-pre-wrap"
                          data-testid={`drive-status-raw-${key}`}
                        >
                          {formattedStatus.raw}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-0.5" data-testid={`drive-status-${key}`}>
                      <p
                        className={cn("text-xs", status.isConnected ? "text-success" : "text-muted-foreground")}
                        data-testid={`drive-status-message-${key}`}
                      >
                        {status.isConnected ? "OK" : "Not available"}
                      </p>
                    </div>
                  )}
                </div>
              ),
            )}

            <div className="config-card space-y-2" data-testid="drive-soft-iec-row">
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold">Soft IEC Drive</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <FocusableDiskButton
                    focusId="disks-soft-iec-status-toggle"
                    focusOrder={300}
                    variant="outline"
                    size="sm"
                    className={cn(ROW1_CONTROL_CLASS, getOnOffButtonClass(softIecPowerEnabled))}
                    onClick={() =>
                      void handleSoftIecConfigUpdate(
                        "IEC Drive",
                        softIecPowerEnabled ? "Disabled" : "Enabled",
                        softIecPowerEnabled ? "Soft IEC disabled" : "Soft IEC enabled",
                        softIecPowerEnabled ? "Soft IEC drive turned off." : "Soft IEC drive turned on.",
                      )
                    }
                    disabled={!status.isConnected || !softIecHasPowerState || softIecConfigPending}
                    data-testid="drive-status-toggle-soft-iec"
                  >
                    {softIecPowerEnabled ? "ON" : "OFF"}
                  </FocusableDiskButton>
                  <FocusableDiskButton
                    focusId="disks-soft-iec-mount-toggle"
                    focusOrder={310}
                    variant={softIecMounted ? "secondary" : "outline"}
                    size="sm"
                    className={ROW1_CONTROL_CLASS}
                    onClick={() => setSoftIecDirectoryBrowserOpen(true)}
                    disabled={!status.isConnected || softIecConfigPending}
                    data-testid="drive-mount-toggle-soft-iec"
                    aria-label="Soft IEC Drive select directory"
                  >
                    <Disc className={cn("h-4 w-4", softIecMounted ? "text-success" : "text-muted-foreground")} />
                  </FocusableDiskButton>
                </div>
              </div>

              <div
                className={cn(
                  "min-w-0 overflow-hidden text-xs text-muted-foreground",
                  profile === "compact" ? "grid gap-2 whitespace-normal" : "flex items-center gap-1 whitespace-nowrap",
                )}
              >
                <span className="shrink-0">Bus ID</span>
                <Select
                  value={String(softIecBusId)}
                  onValueChange={(value) =>
                    void handleSoftIecConfigUpdate(
                      "Soft Drive Bus ID",
                      Number(value),
                      "Soft IEC bus ID updated",
                      `Soft IEC now uses device #${value}.`,
                    )
                  }
                  disabled={!status.isConnected || softIecConfigPending}
                >
                  <SelectTrigger
                    className={cn(INLINE_META_SELECT_CLASS, "w-[76px] min-w-[76px]")}
                    data-testid="drive-bus-select-soft-iec"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {softIecBusOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        #{option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {profile === "compact" ? null : (
                  <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
                    •
                  </span>
                )}
                <span className="shrink-0">Default Path</span>
                <FocusableDiskButton
                  focusId="disks-soft-iec-default-path"
                  focusOrder={320}
                  variant="ghost"
                  size="sm"
                  className="h-7 min-w-0 max-w-full justify-start px-1.5 text-xs font-medium"
                  onClick={() => setSoftIecDirectoryBrowserOpen(true)}
                  disabled={!status.isConnected || softIecConfigPending}
                  data-testid="drive-default-path-select-soft-iec"
                  aria-label="Select directory for Soft IEC Default Path"
                >
                  <span className="truncate">Select directory ({softIecDefaultPath})</span>
                </FocusableDiskButton>
              </div>

              <div
                className={cn("min-w-0 justify-between gap-2", profile === "compact" ? "grid" : "flex items-center")}
              >
                <ResponsivePathText
                  path={softIecMountedLabel}
                  mode="start-and-filename"
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                  dataTestId="drive-mounted-label-soft-iec"
                />
                <div className="flex shrink-0 items-center gap-1.5">
                  <FocusableDiskButton
                    focusId="disks-soft-iec-reset"
                    focusOrder={340}
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => void handleResetDrive(softIecEndpointKey, "Soft IEC Drive", "softiec")}
                    disabled={!status.isConnected || softIecResetPending || softIecConfigPending}
                    aria-label="Reset Soft IEC Drive"
                    data-testid="drive-reset-soft-iec"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </FocusableDiskButton>
                  <FocusableDiskButton
                    focusId="disks-soft-iec-power-toggle"
                    focusOrder={350}
                    variant="default"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() =>
                      void handleToggleDrivePower(softIecEndpointKey, "Soft IEC Drive", softIecPowerTarget, "softiec")
                    }
                    disabled={
                      !status.isConnected || !softIecHasPowerState || softIecPowerPending || softIecConfigPending
                    }
                    data-testid="drive-power-toggle-soft-iec"
                  >
                    {softIecPowerLabel}
                  </FocusableDiskButton>
                </div>
              </div>

              {softIecFormattedStatus ? (
                <div className="space-y-0.5" data-testid="drive-status-soft-iec">
                  {softIecFormattedStatus.message ? (
                    <p
                      className={cn("text-xs", getStatusMessageColorClass(softIecFormattedStatus))}
                      data-testid="drive-status-message-soft-iec"
                    >
                      {softIecFormattedStatus.message}
                    </p>
                  ) : null}
                  {softIecFormattedStatus.raw ? (
                    <p
                      className="text-xs text-muted-foreground whitespace-pre-wrap"
                      data-testid="drive-status-raw-soft-iec"
                    >
                      {softIecFormattedStatus.raw}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-0.5" data-testid="drive-status-soft-iec">
                  <p className="text-xs text-success" data-testid="drive-status-message-soft-iec">
                    OK
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="category-header">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Disks
          </h3>

          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <SelectableActionList
              title="Disk list"
              selectionLabel="items"
              items={buildDiskListItems(sortedDisks, {
                onMount: (entry) => {
                  if (!status.isConnected) {
                    reportUserError({
                      operation: "DISK_MOUNT",
                      title: "Offline",
                      description: "Connect to mount disks.",
                    });
                    return;
                  }
                  setActiveDisk(entry);
                },
              })}
              emptyLabel="No disks in the collection yet."
              selectAllLabel="Select all"
              deselectAllLabel="Deselect all"
              removeSelectedLabel={selectedCount ? "Remove selected items" : undefined}
              selectedCount={selectedCount}
              allSelected={allSelected}
              onToggleSelectAll={toggleSelectAll}
              onRemoveSelected={() => setBulkDeleteOpen(true)}
              maxVisible={listPreviewLimit}
              viewAllTitle="All disks"
              filterPlaceholder="Filter disks..."
              listTestId="disk-list"
              rowTestId="disk-row"
              viewAllMode="non-empty"
              headerActions={
                <FocusableDiskButton
                  focusId="disks-library-add-disks"
                  focusOrder={DISKS_LIBRARY_FOCUS_ORDER.addDisks}
                  focusGroup="disks-library"
                  variant="outline"
                  size="sm"
                  onClick={() => setBrowserOpen(true)}
                >
                  {diskLibrary.disks.length ? "Add more disks" : "Add disks"}
                </FocusableDiskButton>
              }
            />
          </div>
        </section>
      </ProfileSplitSection>

      <input
        ref={localSourceInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={wrapUserEvent(
          (event) => {
            event.currentTarget.value = "";
          },
          "upload",
          "FileInput",
          { type: "file" },
          "FileInput",
        )}
      />

      <AppSheet open={Boolean(activeDrive)} onOpenChange={(open) => !open && setActiveDrive(null)}>
        <AppSheetContent className="overflow-hidden p-0" data-testid="mount-disk-sheet">
          <AppSheetHeader>
            <AppSheetTitle>Mount disk to {activeDrive ? buildDriveLabel(activeDrive) : ""}</AppSheetTitle>
            <AppSheetDescription>Select a disk to mount in this drive.</AppSheetDescription>
          </AppSheetHeader>
          <AppSheetBody className="px-4 py-4 sm:px-6">
            <SelectableActionList
              title="Available disks"
              items={buildDiskListItems(sortedDisks, {
                showSelection: false,
                showMenu: false,
                // A local-disk mount can take tens of seconds (SAF read
                // timeout up to 45s + upload) with the sheet still open and
                // no busy indicator otherwise - a second tap here would race
                // a second mount against the same drive. See HARD9-037.
                disableActions: !status.isConnected || Boolean(activeDrive && driveMutationPending[activeDrive]),
                onMount: (entry) => {
                  if (!activeDrive) return;
                  if (driveMutationPending[activeDrive]) return;
                  void handleMountDisk(activeDrive, entry).finally(() => setActiveDrive(null));
                },
              })}
              emptyLabel="No disks in the collection yet."
              selectedCount={0}
              allSelected={false}
              onToggleSelectAll={() => undefined}
              maxVisible={Math.max(sortedDisks.length, listPreviewLimit)}
              showSelectionControls={false}
              headerActions={
                sortedDisks.length === 0 ? (
                  <FocusableDiskButton
                    focusId="disks-mount-sheet-add-disks"
                    focusOrder={DISKS_LIBRARY_FOCUS_ORDER.mountSheetAddDisks}
                    focusGroup="disks-mount-sheet"
                    variant="outline"
                    size="sm"
                    onClick={() => setBrowserOpen(true)}
                    data-testid="mount-sheet-add-disks"
                  >
                    Add disks
                  </FocusableDiskButton>
                ) : null
              }
            />
          </AppSheetBody>
        </AppSheetContent>
      </AppSheet>

      <Dialog open={Boolean(activeDisk)} onOpenChange={(open) => !open && setActiveDisk(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mount {activeDisk?.name}</DialogTitle>
            <DialogDescription>Select the drive to mount this disk.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {driveRows.map(({ key, busId, driveType, mounted, configPending, mountPending }) => (
              <Button
                key={key}
                variant="outline"
                onClick={() => {
                  if (!activeDisk) return;
                  void handleMountDisk(key, activeDisk).finally(() => setActiveDisk(null));
                }}
                disabled={!status.isConnected || configPending || mountPending}
              >
                <HardDrive className="h-4 w-4 mr-2" />
                {buildDriveLabel(key)} (#{busId}, {driveType}) {mounted ? "• mounted" : ""}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ItemSelectionDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        title="Add items"
        confirmLabel="Add to library"
        sourceGroups={sourceGroups}
        archiveConfigs={archiveConfigs}
        onAddLocalSource={handleAddLocalSourceFromPicker}
        onConfirm={handleAddDiskSelections}
        filterEntry={(entry) => entry.type === "dir" || isDiskImagePath(entry.path)}
        allowFolderSelection
        isConfirming={isAddingItems}
        progress={addItemsProgress}
        showProgressFooter={addItemsSurface === "dialog"}
        autoConfirmCloseBefore={isAndroid}
        onAutoConfirmStart={handleAutoConfirmStart}
        autoConfirmLocalSource={false}
        onCancelScan={cancelAddItemsScan}
      />
      <ItemSelectionDialog
        open={softIecDirectoryBrowserOpen}
        onOpenChange={setSoftIecDirectoryBrowserOpen}
        title="Soft IEC Default Path"
        confirmLabel="Select directory"
        sourceGroups={softIecDirectorySourceGroups}
        onAddLocalSource={async () => null}
        onConfirm={handleSoftIecDirectorySelect}
        filterEntry={() => false}
        allowFolderSelection
        isConfirming={softIecConfigPending}
        autoConfirmLocalSource={false}
      />

      {!browserOpen ? (
        <AddItemsProgressOverlay
          progress={addItemsProgress}
          title="Adding disks"
          testId="add-disks-overlay"
          visible={showAddItemsOverlay || addItemsProgress.status === "scanning"}
          onCancel={cancelAddItemsScan}
        />
      ) : null}

      <Dialog open={Boolean(groupDialogDisk)} onOpenChange={(open) => !open && setGroupDialogDisk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set group</DialogTitle>
            <DialogDescription>Assign a group label for disk rotation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {groupOptions.length ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Existing groups</p>
                <div className="flex flex-wrap gap-2">
                  {groupOptions.map((option) => (
                    <Button
                      key={option.name}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!groupDialogDisk) return;
                        diskLibrary.updateDiskGroup(groupDialogDisk.id, option.name);
                        setGroupDialogDisk(null);
                      }}
                      className="flex items-center gap-2"
                    >
                      <span className={cn("h-2 w-2 rounded-full border", option.color.chip)} aria-hidden="true" />
                      <span className={cn(option.color.text, "max-w-[180px] break-words whitespace-normal")}>
                        {option.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">({option.count})</span>
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">New group</p>
              <Input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Enter a group name"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && groupDialogDisk) {
                    const nextName = groupName.trim();
                    if (!nextName) return;
                    diskLibrary.updateDiskGroup(groupDialogDisk.id, nextName);
                    setGroupDialogDisk(null);
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="default"
              onClick={() => {
                if (!groupDialogDisk) return;
                const nextName = groupName.trim();
                diskLibrary.updateDiskGroup(groupDialogDisk.id, nextName || null);
                setGroupDialogDisk(null);
              }}
            >
              {groupName.trim() ? "Create & assign" : "Clear group"}
            </Button>
            <Button variant="ghost" onClick={() => setGroupDialogDisk(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameDialogDisk)} onOpenChange={(open) => !open && setRenameDialogDisk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename disk</DialogTitle>
            <DialogDescription>Update the display name for this disk.</DialogDescription>
          </DialogHeader>
          <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
          <DialogFooter>
            <Button
              variant="default"
              onClick={() => {
                if (!renameDialogDisk) return;
                diskLibrary.updateDiskName(renameDialogDisk.id, renameValue || renameDialogDisk.name);
                setRenameDialogDisk(null);
              }}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setRenameDialogDisk(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteDialogDisk)} onOpenChange={(open) => !open && setDeleteDialogDisk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove disk?</DialogTitle>
            <DialogDescription>
              This removes the disk from your collection. The original file is not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!deleteDialogDisk) return;
                void handleDeleteDisk(deleteDialogDisk);
                setDeleteDialogDisk(null);
              }}
            >
              Remove
            </Button>
            <Button variant="ghost" onClick={() => setDeleteDialogDisk(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove selected disks?</DialogTitle>
            <DialogDescription>
              {selectedCount
                ? `This removes ${selectedCount} disk(s) from your collection. Files are not deleted.`
                : "No disks selected."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => void handleBulkDelete()} disabled={!selectedCount}>
              Remove
            </Button>
            <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
