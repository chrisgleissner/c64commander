/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  RotateCcw,
  Power,
  PowerOff,
  Pause,
  Menu,
  Save,
  RefreshCw,
  Trash2,
  Upload,
  Play,
  Download,
  FolderOpen,
} from 'lucide-react';
import { getC64API } from '@/lib/c64api';
import { useC64ConfigItems, useC64Connection, useC64MachineControl, useC64Drives } from '@/hooks/useC64Connection';
import { useActionTrace } from '@/hooks/useActionTrace';
import { AppBar } from '@/components/AppBar';
import { QuickActionCard } from '@/components/QuickActionCard';
import { ConfigItemRow } from '@/components/ConfigItemRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';

import { SystemInfo } from './home/components/SystemInfo';
import { MachineControls } from './home/components/MachineControls';
import { AudioMixer } from './home/components/AudioMixer';
import { StreamStatus } from './home/components/StreamStatus';
import { DriveManager } from './home/components/DriveManager';
import { PrinterManager } from './home/components/PrinterManager';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { createUltimateSourceLocation } from '@/lib/sourceNavigation/ftpSourceAdapter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PowerOffDialog } from './home/dialogs/PowerOffDialog';
import { SaveConfigDialog } from './home/dialogs/SaveConfigDialog';
import { LoadConfigDialog } from './home/dialogs/LoadConfigDialog';
import { ManageConfigDialog } from './home/dialogs/ManageConfigDialog';
import { toast } from '@/hooks/use-toast';
import { reportUserError } from '@/lib/uiErrors';
import { addErrorLog } from '@/lib/logging';
import { useAppConfigState } from '@/hooks/useAppConfigState';
import { buildSidEnablement } from '@/lib/config/sidVolumeControl';
import { resolveAudioMixerMuteValue } from '@/lib/config/audioMixerSolo';
import { SID_ADDRESSING_ITEMS, SID_SOCKETS_ITEMS } from '@/lib/config/configItems';
import { useHomeActions } from './home/hooks/useHomeActions';
import { useDriveData } from './home/hooks/useDriveData';
import { useSharedConfigActions } from './home/hooks/ConfigActionsContext';
import { ConfigActionsProvider } from './home/hooks/ConfigActionsContext';
import { getBuildInfo } from '@/lib/buildInfo';
import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';
import { getLedColorRgb, rgbToCss } from '@/lib/config/ledColors';
import { buildSidControlEntries, parseSidBaseAddress } from '@/lib/config/sidDetails';
import { getOnOffButtonClass } from '@/lib/ui/buttonStyles';
import { formatDbValue, formatPanValue } from '@/lib/ui/sliderValueFormat';
import { resetDiskDevices, resetPrinterDevice } from '@/lib/disks/resetDrives';
import { buildSidSilenceTargets, silenceSidTargets } from '@/lib/sid/sidSilence';
import {
  FULL_RAM_SIZE_BYTES,
  clearRamAndReboot,
  dumpFullRamImage,
  loadFullRamImage,
} from '@/lib/machine/ramOperations';
import {
  buildRamDumpFileName,
  pickRamDumpFile,
  selectRamDumpFolder,
  writeRamDumpToFolder,
} from '@/lib/machine/ramDumpStorage';
import {
  loadRamDumpFolderConfig,
  saveRamDumpFolderConfig,
  deriveRamDumpFolderDisplayPath,
  type RamDumpFolderConfig,
} from '@/lib/config/ramDumpFolderStore';
import {
  type DriveDeviceClass,
} from '@/lib/drives/driveDevices';


import {
  HOME_SID_ADDRESSING_ITEMS,
  HOME_SID_SOCKET_ITEMS,
  HOME_ULTISID_ITEMS,
  LED_STRIP_HOME_ITEMS,
  SID_AUDIO_ITEMS,
  SID_DETECTED_ITEMS,
  SID_SLIDER_DETENT_RANGE,
  SID_SLIDER_STEP,
  SID_SOCKET_SHAPING_ITEMS,
  U64_HOME_ITEMS,
  ULTISID_PROFILE_ITEMS,
  ULTISID_SHAPING_ITEMS,
} from './home/constants';


import {
  applySoftDetent,
  clampSliderValue,
  clampToRange,
  formatSelectOptionLabel,
  formatSidBaseAddress,
  isSilentSidValue,
  normalizeOptionToken,
  normalizeSelectOptions,
  normalizeSelectValue,
  parseNumericOption,
  resolveOptionIndex,
  resolvePanCenterIndex,
  resolveSelectValue,
  resolveSidAddressDisableValue,
  resolveSidAddressEnableValue,
  resolveSidSocketToggleValue,
  resolveSliderIndex,
  resolveVolumeCenterIndex,
} from './home/utils/uiLogic';
import {
  buildConfigKey,
  readItemValue,
  readItemOptions,
  readItemDetails,
  parseNumericValue,
  resolveTurboControlValue,
} from './home/utils/HomeConfigUtils';



import { SectionHeader } from '@/components/SectionHeader';
import { cn } from '@/lib/utils';

export default function HomePage() {
  return (
    <ConfigActionsProvider>
      <HomePageContent />
    </ConfigActionsProvider>
  );
}

function HomePageContent() {
  const api = getC64API();
  const queryClient = useQueryClient();
  const { status } = useC64Connection();
  const { driveSummaryItems } = useDriveData(status.isConnected || status.isConnecting);

  const { data: u64SettingsCategory } = useC64ConfigItems(
    'U64 Specific Settings',
    [...U64_HOME_ITEMS],
    status.isConnected || status.isConnecting,
  );
  const { data: ledStripCategory } = useC64ConfigItems(
    'LED Strip Settings',
    [...LED_STRIP_HOME_ITEMS],
    status.isConnected || status.isConnecting,
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
    handleLoadRam,
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
  const trace = useActionTrace('HomePage');

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  const [applyingConfigId, setApplyingConfigId] = useState<string | null>(null);

  const {
    configOverrides,
    configWritePending,
    updateConfigValue,
    resolveConfigValue,
  } = useSharedConfigActions();
  const [activeSliders, setActiveSliders] = useState<Record<string, number>>({});
  const [ledIntensityDraft, setLedIntensityDraft] = useState<number | null>(null);








  const machineTaskBusy = machineTaskId !== null || pauseResumePending;
  const ramDumpFolderDisplayPath = ramDumpFolder
    ? (ramDumpFolder.displayPath ?? deriveRamDumpFolderDisplayPath(ramDumpFolder.treeUri, ramDumpFolder.rootName))
    : null;
  const ramDumpFolderLabel = ramDumpFolder?.rootName
    ?? ramDumpFolderDisplayPath
    ?? (ramDumpFolder ? 'Folder access granted' : 'Not configured');
  const ramDumpFolderDetail = ramDumpFolder
    ? (ramDumpFolderDisplayPath ?? ramDumpFolder.rootName ?? 'Folder access granted')
    : 'Select a folder before first Save RAM action.';

  const inlineSelectTriggerClass =
    'h-auto w-auto border-0 bg-transparent px-0 py-0 text-xs font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:hidden';

  const u64Category = u64SettingsCategory as Record<string, unknown> | undefined;
  const ledStripConfig = ledStripCategory as Record<string, unknown> | undefined;
  const videoModeOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'System Mode').map((value) => String(value));
  const videoModeValue = String(resolveConfigValue(u64Category, 'U64 Specific Settings', 'System Mode', '—'));
  const analogVideoOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'Analog Video Mode').map((value) => String(value));
  const analogVideoValue = String(resolveConfigValue(u64Category, 'U64 Specific Settings', 'Analog Video Mode', '—'));
  const digitalVideoOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'Digital Video Mode').map((value) => String(value));
  const digitalVideoValue = String(resolveConfigValue(u64Category, 'U64 Specific Settings', 'Digital Video Mode', '—'));
  const hdmiScanOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'HDMI Scan lines').map((value) => String(value));
  const hdmiScanValue = String(resolveConfigValue(u64Category, 'U64 Specific Settings', 'HDMI Scan lines', 'Disabled'));
  const turboControlOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'Turbo Control').map((value) => String(value));
  const turboControlValue = String(resolveConfigValue(
    u64Category,
    'U64 Specific Settings',
    'Turbo Control',
    turboControlOptions[0] ?? 'Manual',
  ));
  const cpuSpeedOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'CPU Speed').map((value) => String(value));
  const cpuSpeedValue = String(resolveConfigValue(u64Category, 'U64 Specific Settings', 'CPU Speed', '1'));

  const ledModeOptions = readItemOptions(ledStripConfig, 'LED Strip Settings', 'LedStrip Mode').map((value) => String(value));
  const ledModeValue = String(resolveConfigValue(ledStripConfig, 'LED Strip Settings', 'LedStrip Mode', 'Off'));
  const ledFixedColorOptions = readItemOptions(ledStripConfig, 'LED Strip Settings', 'Fixed Color').map((value) => String(value));
  const ledFixedColorValue = String(resolveConfigValue(ledStripConfig, 'LED Strip Settings', 'Fixed Color', '—'));
  const ledSidSelectOptions = readItemOptions(ledStripConfig, 'LED Strip Settings', 'LedStrip SID Select').map((value) => String(value));
  const ledTintOptions = readItemOptions(ledStripConfig, 'LED Strip Settings', 'Color tint').map((value) => String(value));
  const ledTintValue = String(resolveConfigValue(ledStripConfig, 'LED Strip Settings', 'Color tint', 'Pure'));
  const ledSidSelectValue = String(resolveConfigValue(ledStripConfig, 'LED Strip Settings', 'LedStrip SID Select', '—'));
  const ledIntensityValue = String(resolveConfigValue(ledStripConfig, 'LED Strip Settings', 'Strip Intensity', '0'));
  const ledIntensityDetails = readItemDetails(ledStripConfig, 'LED Strip Settings', 'Strip Intensity');
  const ledIntensityMin = ledIntensityDetails?.min ?? 0;
  const ledIntensityMax = ledIntensityDetails?.max ?? 31;
  const ledIntensityNumber = parseNumericValue(ledIntensityValue, ledIntensityMin);
  const ledIntensityDisplayValue = ledIntensityDraft ?? ledIntensityNumber;









  useEffect(() => {
    setLedIntensityDraft(null);
  }, [ledIntensityValue]);







  const handleCpuSpeedChange = trace(async function handleCpuSpeedChange(nextValue: string) {
    await updateConfigValue(
      'U64 Specific Settings',
      'CPU Speed',
      nextValue,
      'HOME_CPU_SPEED',
      'CPU speed updated',
    );

    if (turboControlOptions.length === 0) return;
    const desiredTurbo = resolveTurboControlValue(nextValue, turboControlOptions);
    if (normalizeOptionToken(desiredTurbo) === normalizeOptionToken(turboControlValue)) return;
    await updateConfigValue(
      'U64 Specific Settings',
      'Turbo Control',
      desiredTurbo,
      'HOME_TURBO_CONTROL',
      'Turbo control updated',
      { suppressToast: true },
    );
  });








  const handleSaveToApp = trace(async function handleSaveToApp(name: string) {
    try {
      await saveCurrentConfig(name);
      toast({ title: 'Saved to app', description: name });
      setSaveDialogOpen(false);
    } catch (error) {
      reportUserError({
        operation: 'APP_CONFIG_SAVE',
        title: 'Error',
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
      toast({ title: 'Config loaded', description: entry.name });
      setLoadDialogOpen(false);
    } catch (error) {
      reportUserError({
        operation: 'APP_CONFIG_LOAD',
        title: 'Error',
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
  const effectiveDigitalVideoOptions = digitalVideoOptions.length ? digitalVideoOptions : [digitalVideoValue];
  const effectiveHdmiScanOptions = hdmiScanOptions.length ? hdmiScanOptions : [hdmiScanValue];
  const effectiveCpuSpeedOptions = cpuSpeedOptions.length ? cpuSpeedOptions : [cpuSpeedValue];
  const effectiveLedModeOptions = ledModeOptions.length ? ledModeOptions : [ledModeValue];
  const effectiveLedFixedColorOptions = ledFixedColorOptions.length ? ledFixedColorOptions : [ledFixedColorValue];
  const effectiveLedSidSelectOptions = ledSidSelectOptions.length ? ledSidSelectOptions : [ledSidSelectValue];
  const effectiveLedTintOptions = ledTintOptions.length ? ledTintOptions : [ledTintValue];


  const videoModeSelectOptions = normalizeSelectOptions(effectiveVideoModeOptions, videoModeValue);
  const analogVideoSelectOptions = normalizeSelectOptions(effectiveAnalogVideoOptions, analogVideoValue);
  const digitalVideoSelectOptions = normalizeSelectOptions(effectiveDigitalVideoOptions, digitalVideoValue);
  const hdmiScanSelectOptions = normalizeSelectOptions(effectiveHdmiScanOptions, hdmiScanValue);
  const ledModeSelectOptions = normalizeSelectOptions(effectiveLedModeOptions, ledModeValue);
  const ledFixedColorSelectOptions = normalizeSelectOptions(effectiveLedFixedColorOptions, ledFixedColorValue);
  const ledSidSelectSelectOptions = normalizeSelectOptions(effectiveLedSidSelectOptions, ledSidSelectValue);
  const ledTintSelectOptions = normalizeSelectOptions(effectiveLedTintOptions, ledTintValue);


  const videoModeSelectValue = normalizeSelectValue(videoModeValue);
  const analogVideoSelectValue = normalizeSelectValue(analogVideoValue);
  const digitalVideoSelectValue = normalizeSelectValue(digitalVideoValue);
  const hdmiScanSelectValue = normalizeSelectValue(hdmiScanValue);
  const ledModeSelectValue = normalizeSelectValue(ledModeValue);
  const ledFixedColorSelectValue = normalizeSelectValue(ledFixedColorValue);
  const ledSidSelectSelectValue = normalizeSelectValue(ledSidSelectValue);
  const ledTintSelectValue = normalizeSelectValue(ledTintValue);


  const cpuSpeedPending = Boolean(configWritePending[buildConfigKey('U64 Specific Settings', 'CPU Speed')]);
  const videoModePending = Boolean(configWritePending[buildConfigKey('U64 Specific Settings', 'System Mode')]);
  const analogVideoPending = Boolean(configWritePending[buildConfigKey('U64 Specific Settings', 'Analog Video Mode')]);
  const digitalVideoPending = Boolean(configWritePending[buildConfigKey('U64 Specific Settings', 'Digital Video Mode')]);
  const hdmiScanPending = Boolean(configWritePending[buildConfigKey('U64 Specific Settings', 'HDMI Scan lines')]);
  const ledModePending = Boolean(configWritePending[buildConfigKey('LED Strip Settings', 'LedStrip Mode')]);
  const ledFixedColorPending = Boolean(configWritePending[buildConfigKey('LED Strip Settings', 'Fixed Color')]);
  const ledIntensityPending = Boolean(configWritePending[buildConfigKey('LED Strip Settings', 'Strip Intensity')]);
  const ledSidSelectPending = Boolean(configWritePending[buildConfigKey('LED Strip Settings', 'LedStrip SID Select')]);
  const ledTintPending = Boolean(configWritePending[buildConfigKey('LED Strip Settings', 'Color tint')]);







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
              <h1 className="c64-header text-xl truncate" data-testid="home-header-title">Home</h1>
              <p className="text-xs text-muted-foreground mt-1 truncate" data-testid="home-header-subtitle">C64 Commander</p>
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
          onSaveRam={handleSaveRam}
          onLoadRam={handleLoadRam}
          onRebootClearMemory={handleRebootClearMemory}
          onPowerOff={handlePowerOff}
          onAction={handleAction}
          driveSummaryItems={driveSummaryItems}
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
            <div className="bg-card border border-border rounded-xl p-3 space-y-3" data-testid="home-quick-config">
              <ConfigItemRow
                name="CPU Speed"
                category="U64 Specific Settings"
                value={cpuSpeedValue}
                options={effectiveCpuSpeedOptions}
                onValueChange={(value) => void handleCpuSpeedChange(String(value))}
                isLoading={cpuSpeedPending}
                valueTestId="home-cpu-speed-value"
                sliderTestId="home-cpu-speed-slider"
                className="border-0 py-2"
              />
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Video Mode</span>
                  <Select
                    value={videoModeSelectValue}
                    onValueChange={(value) =>
                      void updateConfigValue(
                        'U64 Specific Settings',
                        'System Mode',
                        resolveSelectValue(value),
                        'HOME_VIDEO_MODE',
                        'Video mode updated',
                      )}
                    disabled={!status.isConnected || videoModePending}
                  >
                    <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-video-mode">
                      <SelectValue placeholder={videoModeValue} />
                    </SelectTrigger>
                    <SelectContent>
                      {videoModeSelectOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatSelectOptionLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Analog</span>
                  <Select
                    value={analogVideoSelectValue}
                    onValueChange={(value) =>
                      void updateConfigValue(
                        'U64 Specific Settings',
                        'Analog Video Mode',
                        resolveSelectValue(value),
                        'HOME_ANALOG_VIDEO_MODE',
                        'Analog video mode updated',
                      )}
                    disabled={!status.isConnected || analogVideoPending}
                  >
                    <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-video-analog">
                      <SelectValue placeholder={analogVideoValue} />
                    </SelectTrigger>
                    <SelectContent>
                      {analogVideoSelectOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatSelectOptionLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Digital</span>
                  <Select
                    value={digitalVideoSelectValue}
                    onValueChange={(value) =>
                      void updateConfigValue(
                        'U64 Specific Settings',
                        'Digital Video Mode',
                        resolveSelectValue(value),
                        'HOME_DIGITAL_VIDEO_MODE',
                        'Digital video mode updated',
                      )}
                    disabled={!status.isConnected || digitalVideoPending}
                  >
                    <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-video-digital">
                      <SelectValue placeholder={digitalVideoValue} />
                    </SelectTrigger>
                    <SelectContent>
                      {digitalVideoSelectOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatSelectOptionLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">HDMI Scan Lines</span>
                  <Select
                    value={hdmiScanSelectValue}
                    onValueChange={(value) =>
                      void updateConfigValue(
                        'U64 Specific Settings',
                        'HDMI Scan lines',
                        resolveSelectValue(value),
                        'HOME_HDMI_SCAN',
                        'HDMI scan lines updated',
                      )}
                    disabled={!status.isConnected || hdmiScanPending}
                  >
                    <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-video-scanlines">
                      <SelectValue placeholder={hdmiScanValue} />
                    </SelectTrigger>
                    <SelectContent>
                      {hdmiScanSelectOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatSelectOptionLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-card border border-border rounded-xl p-3 space-y-2" data-testid="home-led-summary">
                <p className="text-xs font-semibold text-primary uppercase tracking-wider">LED</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Mode</span>
                    <Select
                      value={ledModeSelectValue}
                      onValueChange={(value) =>
                        void updateConfigValue(
                          'LED Strip Settings',
                          'LedStrip Mode',
                          resolveSelectValue(value),
                          'HOME_LED_MODE',
                          'LED mode updated',
                        )}
                      disabled={!status.isConnected || ledModePending}
                    >
                      <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-led-mode">
                        <SelectValue placeholder={ledModeValue} />
                      </SelectTrigger>
                      <SelectContent>
                        {ledModeSelectOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {formatSelectOptionLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Fixed Color</span>
                    <Select
                      value={ledFixedColorSelectValue}
                      onValueChange={(value) =>
                        void updateConfigValue(
                          'LED Strip Settings',
                          'Fixed Color',
                          resolveSelectValue(value),
                          'HOME_LED_COLOR',
                          'LED color updated',
                        )}
                      disabled={!status.isConnected || ledFixedColorPending}
                    >
                      <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-led-color">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const rgb = getLedColorRgb(ledFixedColorSelectValue ?? ledFixedColorValue);
                            return rgb ? (
                              <div
                                className="w-4 h-4 rounded-sm border border-border/50 shrink-0"
                                style={{ backgroundColor: rgbToCss(rgb) }}
                                aria-hidden="true"
                              />
                            ) : null;
                          })()}
                          <span>{formatSelectOptionLabel(ledFixedColorSelectValue ?? ledFixedColorValue)}</span>
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {ledFixedColorSelectOptions.map((option) => {
                          const optionRgb = getLedColorRgb(option);
                          return (
                            <SelectItem key={option} value={option}>
                              <div className="flex items-center gap-2">
                                {optionRgb ? (
                                  <div
                                    className="w-4 h-4 rounded-sm border border-border/50 shrink-0"
                                    style={{ backgroundColor: rgbToCss(optionRgb) }}
                                    aria-hidden="true"
                                  />
                                ) : null}
                                <span>{formatSelectOptionLabel(option)}</span>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Intensity</span>
                    <span className="text-xs font-semibold text-foreground" data-testid="home-led-intensity-value">
                      {Math.round(ledIntensityDisplayValue)}
                    </span>
                  </div>
                  <Slider
                    value={[clampToRange(ledIntensityDisplayValue, ledIntensityMin, ledIntensityMax)]}
                    min={ledIntensityMin}
                    max={ledIntensityMax}
                    step={1}
                    onValueChange={(values) => {
                      const nextValue = clampToRange(values[0] ?? ledIntensityMin, ledIntensityMin, ledIntensityMax);
                      setLedIntensityDraft(nextValue);
                    }}
                    onValueCommit={(values) => {
                      const nextValue = clampToRange(values[0] ?? ledIntensityMin, ledIntensityMin, ledIntensityMax);
                      setLedIntensityDraft(null);
                    }}
                    onValueChangeAsync={(nextValue) => {
                      const clamped = clampToRange(nextValue, ledIntensityMin, ledIntensityMax);
                      void updateConfigValue(
                        'LED Strip Settings',
                        'Strip Intensity',
                        Math.round(clamped),
                        'HOME_LED_INTENSITY',
                        'LED intensity updated',
                        { suppressToast: true },
                      );
                    }}
                    onValueCommitAsync={(nextValue) => {
                      const clamped = clampToRange(nextValue, ledIntensityMin, ledIntensityMax);
                      void updateConfigValue(
                        'LED Strip Settings',
                        'Strip Intensity',
                        Math.round(clamped),
                        'HOME_LED_INTENSITY',
                        'LED intensity updated',
                      );
                    }}
                    disabled={!status.isConnected || ledIntensityPending}
                    data-testid="home-led-intensity-slider"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">SID Select</span>
                    <Select
                      value={ledSidSelectSelectValue}
                      onValueChange={(value) =>
                        void updateConfigValue(
                          'LED Strip Settings',
                          'LedStrip SID Select',
                          resolveSelectValue(value),
                          'HOME_LED_SID_SELECT',
                          'LED SID select updated',
                        )}
                      disabled={!status.isConnected || ledSidSelectPending}
                    >
                      <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-led-sid-select">
                        <SelectValue placeholder={ledSidSelectValue} />
                      </SelectTrigger>
                      <SelectContent>
                        {ledSidSelectSelectOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {formatSelectOptionLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Tint</span>
                    <Select
                      value={ledTintSelectValue}
                      onValueChange={(value) =>
                        void updateConfigValue(
                          'LED Strip Settings',
                          'Color tint',
                          resolveSelectValue(value),
                          'HOME_LED_TINT',
                          'LED tint updated',
                        )}
                      disabled={!status.isConnected || ledTintPending}
                    >
                      <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-led-tint">
                        <SelectValue placeholder={ledTintValue} />
                      </SelectTrigger>
                      <SelectContent>
                        {ledTintSelectOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {formatSelectOptionLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-3 space-y-2">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wider">RAM Dump Folder</p>
                  <p className="text-sm font-medium break-words" data-testid="ram-dump-folder-value">
                    {ramDumpFolderLabel}
                  </p>
                  <p className="text-[11px] text-muted-foreground break-words" data-testid="ram-dump-folder-detail">
                    {ramDumpFolderDetail}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSelectRamDumpFolder()}
                  disabled={folderTaskPending || machineTaskBusy}
                >
                  {folderTaskPending ? 'Changing…' : 'Change Folder'}
                </Button>
              </div>
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
            isConnected={status.isConnected}
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
            isConnected={status.isConnected}
            machineTaskBusy={machineTaskBusy}
            machineTaskId={machineTaskId}
            onResetPrinter={handleResetPrinter}
          />
        </motion.div>


        <AudioMixer
          isConnected={status.isConnected}
          machineTaskBusy={machineTaskBusy}
          runMachineTask={runMachineTask}
        />

        <StreamStatus isConnected={status.isConnected} />

        {/* Config Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-3"
          data-section-label="Config"
        >
          <SectionHeader title="Config">
            {isApplying && (
              <span className="ml-2 text-xs text-muted-foreground">Applying…</span>
            )}
          </SectionHeader>
          <div className="grid grid-cols-4 gap-2">
            <QuickActionCard
              icon={Save}
              label="Save"
              description="To flash"
              variant="success"
              compact
              onClick={() => handleAction(() => controls.saveConfig.mutateAsync(), 'Config saved to flash')}
              disabled={!status.isConnected || machineTaskBusy}
              loading={controls.saveConfig.isPending}
            />
            <QuickActionCard
              icon={RefreshCw}
              label="Load"
              description="From flash"
              compact
              onClick={() => handleAction(() => controls.loadConfig.mutateAsync(), 'Config loaded from flash')}
              disabled={!status.isConnected || machineTaskBusy}
              loading={controls.loadConfig.isPending}
            />
            <QuickActionCard
              icon={Trash2}
              label="Reset"
              description="To default"
              variant="danger"
              compact
              onClick={() => handleAction(() => controls.resetConfig.mutateAsync(), 'Config reset to defaults')}
              disabled={!status.isConnected || machineTaskBusy}
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
              disabled={!status.isConnected || isSaving || machineTaskBusy}
              loading={isSaving}
            />
            <QuickActionCard
              icon={Download}
              label="Load"
              description="From App"
              compact
              dataTestId="home-config-load-app"
              onClick={() => setLoadDialogOpen(true)}
              disabled={!status.isConnected || appConfigs.length === 0 || machineTaskBusy}
            />
            <QuickActionCard
              icon={RotateCcw}
              label="Revert"
              description="Changes"
              compact
              onClick={() => handleAction(() => revertToInitial(), 'Config reverted')}
              disabled={!status.isConnected || isApplying || !hasChanges || machineTaskBusy}
              loading={isApplying}
            />
            <QuickActionCard
              icon={FolderOpen}
              label="Manage"
              description="App Configs"
              compact
              dataTestId="home-config-manage-app"
              onClick={() => setManageDialogOpen(true)}
              disabled={!status.isConnected || appConfigs.length === 0 || machineTaskBusy}
            />
          </div>
        </motion.div>

        {/* Offline Message */}
        {!status.isConnected && !status.isConnecting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center"
          >
            <p className="text-sm text-destructive font-medium">Unable to connect to C64 Ultimate</p>
            <p className="text-xs text-muted-foreground mt-1">
              Check your connection settings
            </p>
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
    </div >
  );
}
