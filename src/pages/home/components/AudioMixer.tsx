/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { getC64API } from "@/lib/c64api";
import { useActionTrace } from "@/hooks/useActionTrace";
import { SectionHeader } from "@/components/SectionHeader";
import { Slider } from "@/components/ui/slider";
import { createNumericSliderDomain, useDeviceBoundSlider } from "@/hooks/useDeviceBoundSlider";
import { useSharedConfigActions } from "../hooks/ConfigActionsContext";
import { useSidData } from "../hooks/useSidData";
import { SidCard } from "../SidCard";
import { silenceSidTargets } from "@/lib/sid/sidSilence";
import { buildSidEnablement } from "@/lib/config/sidVolumeControl";
import { AUDIO_MIXER_MASTER_VOLUME_ITEM } from "@/lib/config/configItems";
import { useInteractiveConfigWrite } from "@/hooks/useInteractiveConfigWrite";
import { addLog, buildErrorLogDetails } from "@/lib/logging";
import {
  resolveOptionIndex,
  resolveVolumeCenterIndex,
  resolvePanCenterIndex,
  clampSliderValue,
  resolveSliderIndex,
  applySoftDetent,
  formatSidBaseAddress,
  resolveSelectValue,
  resolveSidSocketToggleValue,
  resolveSidAddressDisableValue,
  resolveSidAddressEnableValue,
} from "../utils/uiLogic";
import { buildConfigKey, readItemOptions } from "../utils/HomeConfigUtils";
import { formatDbValue, formatPanValue } from "@/lib/ui/sliderValueFormat";
import { SID_SLIDER_STEP } from "../constants";

interface AudioMixerProps {
  isConnected: boolean;
  machineTaskBusy: boolean;
  runMachineTask: (taskId: string, action: () => Promise<void>, title: string, desc?: string) => Promise<void>;
}

type MasterVolumeControlProps = {
  isConnected: boolean;
  value: number;
  max: number;
  centerIndex: number | null;
  options: string[];
  onCommit: (value: number) => Promise<void> | void;
  resolveOptionIndex: (value: number) => number;
  formatValue: (value: number) => string;
};

function MasterVolumeControl({
  isConnected,
  value,
  max,
  centerIndex,
  options,
  onCommit,
  resolveOptionIndex,
  formatValue,
}: MasterVolumeControlProps) {
  const domain = useMemo(
    () => createNumericSliderDomain({ min: 0, max, round: (nextValue) => resolveOptionIndex(nextValue) }),
    [max, resolveOptionIndex],
  );
  const slider = useDeviceBoundSlider({
    deviceValue: value,
    domain,
    previewMode: "commitOnly",
    commit: onCommit,
  });

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2" data-testid="home-sid-master-volume">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide">Master Vol</p>
        <span className="text-xs text-muted-foreground" data-testid="home-sid-master-volume-value">
          {formatValue(slider.sliderValue)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 whitespace-nowrap text-xs font-medium text-muted-foreground">Vol</span>
        <Slider
          value={[slider.sliderValue]}
          min={0}
          max={max}
          step={SID_SLIDER_STEP}
          onValueChange={slider.onValueChange}
          onValueCommit={slider.onValueCommit}
          valueFormatter={formatValue}
          midpoint={
            centerIndex !== null && centerIndex >= 0 ? { value: centerIndex, haptics: true, notch: true } : undefined
          }
          disabled={!isConnected || options.length === 0}
          className="flex-1"
          data-testid="home-sid-volume-master"
        />
      </div>
    </div>
  );
}

export function AudioMixer({ isConnected, machineTaskBusy, runMachineTask }: AudioMixerProps) {
  const api = getC64API();
  const trace = useActionTrace("AudioMixer");
  const { configOverrides, configWritePending, updateConfigValue, resolveConfigValue } = useSharedConfigActions();
  const { write: interactiveWrite } = useInteractiveConfigWrite({ category: "Audio Mixer" });

  const {
    sidControlEntries,
    sidSilenceTargets,
    sidAddressingCategory,
    ultiSidCategory,
    sidSocketsCategory,
    audioMixerCategory,
  } = useSidData(isConnected, configOverrides);

  const ultiSidConfig = ultiSidCategory as Record<string, unknown> | undefined;
  const ultiSid1ProfileValue = String(
    resolveConfigValue(ultiSidConfig, "UltiSID Configuration", "UltiSID 1 Filter Curve", "—"),
  );
  const ultiSid2ProfileValue = String(
    resolveConfigValue(ultiSidConfig, "UltiSID Configuration", "UltiSID 2 Filter Curve", "—"),
  );
  const ultiSid1ProfileSelectOptions = readItemOptions(
    ultiSidConfig,
    "UltiSID Configuration",
    "UltiSID 1 Filter Curve",
  ).map((value) => String(value));
  const ultiSid2ProfileSelectOptions = readItemOptions(
    ultiSidConfig,
    "UltiSID Configuration",
    "UltiSID 2 Filter Curve",
  ).map((value) => String(value));

  const ultiSid1ProfileSelectValue = ultiSid1ProfileValue;
  const ultiSid2ProfileSelectValue = ultiSid2ProfileValue;

  const sidDetectedSocket1 = String(
    resolveConfigValue(
      sidSocketsCategory as Record<string, unknown> | undefined,
      "SID Sockets Configuration",
      "SID Detected Socket 1",
      "None",
    ),
  );
  const sidDetectedSocket2 = String(
    resolveConfigValue(
      sidSocketsCategory as Record<string, unknown> | undefined,
      "SID Sockets Configuration",
      "SID Detected Socket 2",
      "None",
    ),
  );

  const sidEnablement = useMemo(
    () =>
      buildSidEnablement(
        sidSocketsCategory as Record<string, unknown> | undefined,
        sidAddressingCategory as Record<string, unknown> | undefined,
      ),
    [sidAddressingCategory, sidSocketsCategory],
  );

  const sidStatusMap = useMemo(
    () =>
      new Map([
        ["socket1", sidEnablement.socket1],
        ["socket2", sidEnablement.socket2],
        ["ultiSid1", sidEnablement.ultiSid1],
        ["ultiSid2", sidEnablement.ultiSid2],
      ]),
    [sidEnablement],
  );

  const masterVolumeKey = buildConfigKey("Audio Mixer", AUDIO_MIXER_MASTER_VOLUME_ITEM);
  const masterVolumeOverride = configOverrides[masterVolumeKey];
  const masterVolumeValue = String(
    masterVolumeOverride !== undefined
      ? masterVolumeOverride
      : resolveConfigValue(
          audioMixerCategory as Record<string, unknown> | undefined,
          "Audio Mixer",
          AUDIO_MIXER_MASTER_VOLUME_ITEM,
          "",
        ),
  );
  const masterVolumeOptions = readItemOptions(
    audioMixerCategory as Record<string, unknown> | undefined,
    "Audio Mixer",
    AUDIO_MIXER_MASTER_VOLUME_ITEM,
  ).map(String);
  const hasMasterVolume = masterVolumeOptions.length > 0;
  const resolvedMasterVolumeOptions = masterVolumeOptions.length ? masterVolumeOptions : [masterVolumeValue];
  const masterVolumeIndex = resolveOptionIndex(resolvedMasterVolumeOptions, masterVolumeValue);
  const masterVolumeCenterIndex = resolveVolumeCenterIndex(resolvedMasterVolumeOptions);
  const masterVolumeMax = Math.max(resolvedMasterVolumeOptions.length - 1, 0);
  const masterVolumeSliderValue = clampSliderValue(masterVolumeIndex, masterVolumeMax);
  const resolveMasterVolumeIndexValue = (value: number) =>
    resolveSliderIndex(applySoftDetent(value, masterVolumeCenterIndex), masterVolumeMax);
  const resolveMasterVolumeOption = (value: number) =>
    resolvedMasterVolumeOptions[resolveMasterVolumeIndexValue(value)] ??
    resolvedMasterVolumeOptions[0] ??
    masterVolumeValue;
  const masterVolumeValueFormatter = (value: number) =>
    formatDbValue(String(resolvedMasterVolumeOptions[Math.round(value)] ?? resolvedMasterVolumeOptions[0] ?? ""));
  const handleMasterVolumeCommit = (val: number) => {
    const nextValue = resolveMasterVolumeOption(val);
    return Promise.resolve(interactiveWrite({ [AUDIO_MIXER_MASTER_VOLUME_ITEM]: nextValue })).catch((error) => {
      addLog(
        "warn",
        "Audio Mixer master volume commit failed",
        buildErrorLogDetails(error as Error, {
          itemName: AUDIO_MIXER_MASTER_VOLUME_ITEM,
          value: nextValue,
        }),
      );
      throw error;
    });
  };

  const handleSidEnableToggle = trace(async function handleSidEnableToggle(
    entry: (typeof sidControlEntries)[number],
    enabled: boolean,
  ) {
    if (entry.key === "socket1" || entry.key === "socket2") {
      const socketIndex = entry.key === "socket1" ? 1 : 2;
      const socketItem = `SID Socket ${socketIndex}`;
      const socketOptions = readItemOptions(
        sidSocketsCategory as Record<string, unknown> | undefined,
        "SID Sockets Configuration",
        socketItem,
      ).map((value) => String(value));
      const nextValue = resolveSidSocketToggleValue(socketOptions, !enabled);
      await updateConfigValue(
        "SID Sockets Configuration",
        socketItem,
        nextValue,
        "HOME_SID_ENABLED",
        `${entry.label} ${enabled ? "disabled" : "enabled"}`,
        { clearPendingOnSuccess: true },
      );
      return;
    }

    const addressOptions = entry.addressOptions.length ? entry.addressOptions : [entry.address];
    const nextValue = enabled
      ? resolveSidAddressDisableValue(addressOptions)
      : resolveSidAddressEnableValue(addressOptions);
    await updateConfigValue(
      "SID Addressing",
      entry.addressItem,
      nextValue,
      "HOME_SID_ADDRESS",
      `${entry.label} ${enabled ? "disabled" : "enabled"}`,
    );
  });

  const handleSidReset = trace(async function handleSidReset() {
    await runMachineTask(
      "reset-sid",
      async () => {
        await silenceSidTargets(api, sidSilenceTargets);
      },
      "SID silence command sent",
      "Volume set to zero, then restored settings.",
    );
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.36 }}
      className="space-y-2"
      data-testid="home-sid-status"
      data-section-label="SID"
    >
      <SectionHeader
        title="SID"
        resetAction={() => void handleSidReset()}
        resetDisabled={!isConnected || machineTaskBusy}
        resetTestId="home-sid-reset"
      />
      <div className="space-y-3">
        {hasMasterVolume ? (
          <MasterVolumeControl
            isConnected={isConnected}
            value={masterVolumeSliderValue}
            max={masterVolumeMax}
            centerIndex={masterVolumeCenterIndex}
            options={resolvedMasterVolumeOptions}
            onCommit={handleMasterVolumeCommit}
            resolveOptionIndex={resolveMasterVolumeIndexValue}
            formatValue={masterVolumeValueFormatter}
          />
        ) : null}
        {sidControlEntries.map((entry) => {
          const addressKey = buildConfigKey("SID Addressing", entry.addressItem);

          const statusValue = sidStatusMap.get(entry.key);
          const isSidEnabled = statusValue !== false;

          const volumeOptions = entry.volumeOptions.length ? entry.volumeOptions : [entry.volume];
          const panOptions = entry.panOptions.length ? entry.panOptions : [entry.pan];
          const volumeIndex = resolveOptionIndex(volumeOptions, entry.volume);
          const panIndex = resolveOptionIndex(panOptions, entry.pan);
          const volumeCenterIndex = resolveVolumeCenterIndex(volumeOptions);
          const panCenterIndex = resolvePanCenterIndex(panOptions);
          const volumeMax = Math.max(volumeOptions.length - 1, 0);
          const panMax = Math.max(panOptions.length - 1, 0);
          const baseAddressLabel = formatSidBaseAddress(entry.addressRaw ?? entry.address);
          const volumeSliderValue = clampSliderValue(volumeIndex, volumeMax);
          const panSliderValue = clampSliderValue(panIndex, panMax);

          const isUltiSid = entry.key === "ultiSid1" || entry.key === "ultiSid2";
          const resolveVolumeIndexValue = (value: number) =>
            resolveSliderIndex(applySoftDetent(value, volumeCenterIndex), volumeMax);
          const resolvePanIndexValue = (value: number) =>
            resolveSliderIndex(applySoftDetent(value, panCenterIndex), panMax);
          const resolveVolumeOption = (value: number) =>
            volumeOptions[resolveVolumeIndexValue(value)] ?? volumeOptions[0] ?? entry.volume;
          const resolvePanOption = (value: number) =>
            panOptions[resolvePanIndexValue(value)] ?? panOptions[0] ?? entry.pan;
          const volumeValueFormatter = (value: number) =>
            formatDbValue(String(volumeOptions[Math.round(value)] ?? volumeOptions[0] ?? ""));
          const panValueFormatter = (value: number) =>
            formatPanValue(String(panOptions[Math.round(value)] ?? panOptions[0] ?? ""));

          const handleVolumePreview = (val: number) => {
            return Promise.resolve(interactiveWrite({ [entry.volumeItem]: resolveVolumeOption(val) })).catch(
              (error) => {
                addLog(
                  "warn",
                  "Audio Mixer volume preview failed",
                  buildErrorLogDetails(error as Error, {
                    itemName: entry.volumeItem,
                    sidKey: entry.key,
                    value: resolveVolumeOption(val),
                  }),
                );
                throw error;
              },
            );
          };
          const handleVolumeCommit = (val: number) => {
            const nextValue = resolveVolumeOption(val);
            return Promise.resolve(interactiveWrite({ [entry.volumeItem]: nextValue })).catch((error) => {
              addLog(
                "warn",
                "Audio Mixer volume preview commit failed",
                buildErrorLogDetails(error as Error, {
                  itemName: entry.volumeItem,
                  sidKey: entry.key,
                  value: nextValue,
                }),
              );
              throw error;
            });
          };
          const handlePanPreview = (val: number) => {
            return Promise.resolve(interactiveWrite({ [entry.panItem]: resolvePanOption(val) })).catch((error) => {
              addLog(
                "warn",
                "Audio Mixer pan preview failed",
                buildErrorLogDetails(error as Error, {
                  itemName: entry.panItem,
                  sidKey: entry.key,
                  value: resolvePanOption(val),
                }),
              );
              throw error;
            });
          };
          const handlePanCommit = (val: number) => {
            const nextValue = resolvePanOption(val);
            return Promise.resolve(interactiveWrite({ [entry.panItem]: nextValue })).catch((error) => {
              addLog(
                "warn",
                "Audio Mixer pan preview commit failed",
                buildErrorLogDetails(error as Error, {
                  itemName: entry.panItem,
                  sidKey: entry.key,
                  value: nextValue,
                }),
              );
              throw error;
            });
          };

          // Identity / Filter
          const identityLabel = isUltiSid ? "Filter" : "SID";
          const identityValue =
            entry.key === "socket1"
              ? sidDetectedSocket1
              : entry.key === "socket2"
                ? sidDetectedSocket2
                : entry.key === "ultiSid1"
                  ? ultiSid1ProfileValue
                  : ultiSid2ProfileValue;
          const identityOptions = isUltiSid
            ? entry.key === "ultiSid1"
              ? ultiSid1ProfileSelectOptions
              : ultiSid2ProfileSelectOptions
            : undefined;
          const identitySelectValue = isUltiSid
            ? entry.key === "ultiSid1"
              ? ultiSid1ProfileSelectValue
              : ultiSid2ProfileSelectValue
            : undefined;
          const identityPending = isUltiSid
            ? Boolean(
                configWritePending[
                  buildConfigKey(
                    "UltiSID Configuration",
                    entry.key === "ultiSid1" ? "UltiSID 1 Filter Curve" : "UltiSID 2 Filter Curve",
                  )
                ],
              )
            : false;

          // Address
          const addressOptions = readItemOptions(
            sidAddressingCategory as Record<string, unknown> | undefined,
            "SID Addressing",
            entry.addressItem,
          ).map(String);
          const addressSelectValue = resolveSelectValue(String(entry.addressRaw ?? entry.address));
          const addressPending = Boolean(configWritePending[addressKey]);

          // Shaping Controls
          const shapingControls = [];
          if (isUltiSid) {
            const ultiIndex = entry.key === "ultiSid1" ? 1 : 2;
            const resonanceItem = `UltiSID ${ultiIndex} Filter Resonance`;
            const waveformItem = `UltiSID ${ultiIndex} Combined Waveforms`;
            const digisItem = `UltiSID ${ultiIndex} Digis Level`;

            shapingControls.push({
              label: "Reson",
              value: String(
                resolveConfigValue(
                  ultiSidCategory as Record<string, unknown> | undefined,
                  "UltiSID Configuration",
                  resonanceItem,
                  "—",
                ),
              ),
              options: readItemOptions(
                ultiSidCategory as Record<string, unknown> | undefined,
                "UltiSID Configuration",
                resonanceItem,
              ).map(String),
              onChange: (val: string) =>
                void updateConfigValue(
                  "UltiSID Configuration",
                  resonanceItem,
                  resolveSelectValue(val),
                  `HOME_ULTISID_RES_${ultiIndex}`,
                  `UltiSID ${ultiIndex} resonance updated`,
                ),
              pending: Boolean(configWritePending[buildConfigKey("UltiSID Configuration", resonanceItem)]),
            });
            shapingControls.push({
              label: "Wave",
              value: String(
                resolveConfigValue(
                  ultiSidCategory as Record<string, unknown> | undefined,
                  "UltiSID Configuration",
                  waveformItem,
                  "—",
                ),
              ),
              options: readItemOptions(
                ultiSidCategory as Record<string, unknown> | undefined,
                "UltiSID Configuration",
                waveformItem,
              ).map(String),
              onChange: (val: string) =>
                void updateConfigValue(
                  "UltiSID Configuration",
                  waveformItem,
                  resolveSelectValue(val),
                  `HOME_ULTISID_WAVE_${ultiIndex}`,
                  `UltiSID ${ultiIndex} waveform updated`,
                ),
              pending: Boolean(configWritePending[buildConfigKey("UltiSID Configuration", waveformItem)]),
            });
            shapingControls.push({
              label: "Digis",
              value: String(
                resolveConfigValue(
                  ultiSidCategory as Record<string, unknown> | undefined,
                  "UltiSID Configuration",
                  digisItem,
                  "—",
                ),
              ),
              options: readItemOptions(
                ultiSidCategory as Record<string, unknown> | undefined,
                "UltiSID Configuration",
                digisItem,
              ).map(String),
              onChange: (val: string) =>
                void updateConfigValue(
                  "UltiSID Configuration",
                  digisItem,
                  resolveSelectValue(val),
                  `HOME_ULTISID_DIGIS_${ultiIndex}`,
                  `UltiSID ${ultiIndex} digis updated`,
                ),
              pending: Boolean(configWritePending[buildConfigKey("UltiSID Configuration", digisItem)]),
            });
          } else {
            const socketIndex = entry.key === "socket1" ? 1 : 2;
            const resistorItem = `SID Socket ${socketIndex} 1K Ohm Resistor`;
            const capacitorItem = `SID Socket ${socketIndex} Capacitors`;

            shapingControls.push({
              label: "Resistor",
              value: String(
                resolveConfigValue(
                  sidSocketsCategory as Record<string, unknown> | undefined,
                  "SID Sockets Configuration",
                  resistorItem,
                  "—",
                ),
              ),
              options: readItemOptions(
                sidSocketsCategory as Record<string, unknown> | undefined,
                "SID Sockets Configuration",
                resistorItem,
              ).map(String),
              onChange: (val: string) =>
                void updateConfigValue(
                  "SID Sockets Configuration",
                  resistorItem,
                  resolveSelectValue(val),
                  `HOME_SID_RES_${socketIndex}`,
                  `SID Socket ${socketIndex} resistor updated`,
                ),
              pending: Boolean(configWritePending[buildConfigKey("SID Sockets Configuration", resistorItem)]),
            });
            shapingControls.push({
              label: "Cap",
              value: String(
                resolveConfigValue(
                  sidSocketsCategory as Record<string, unknown> | undefined,
                  "SID Sockets Configuration",
                  capacitorItem,
                  "—",
                ),
              ),
              options: readItemOptions(
                sidSocketsCategory as Record<string, unknown> | undefined,
                "SID Sockets Configuration",
                capacitorItem,
              ).map(String),
              onChange: (val: string) =>
                void updateConfigValue(
                  "SID Sockets Configuration",
                  capacitorItem,
                  resolveSelectValue(val),
                  `HOME_SID_CAP_${socketIndex}`,
                  `SID Socket ${socketIndex} capacitor updated`,
                ),
              pending: Boolean(configWritePending[buildConfigKey("SID Sockets Configuration", capacitorItem)]),
            });
          }

          const socketItemName =
            entry.key === "socket1" ? "SID Socket 1" : entry.key === "socket2" ? "SID Socket 2" : null;
          const toggleKey = socketItemName ? buildConfigKey("SID Sockets Configuration", socketItemName) : addressKey;
          const togglePending = Boolean(configWritePending[toggleKey]);

          return (
            <SidCard
              key={entry.key}
              name={entry.label}
              power={isSidEnabled}
              onPowerToggle={() => void handleSidEnableToggle(entry, isSidEnabled)}
              powerPending={togglePending}
              identityLabel={identityLabel}
              identityValue={identitySelectValue || identityValue} // Prefer SelectValue (resolved)
              identityOptions={identityOptions}
              onIdentityChange={(val) => {
                if (isUltiSid) {
                  void updateConfigValue(
                    "UltiSID Configuration",
                    entry.key === "ultiSid1" ? "UltiSID 1 Filter Curve" : "UltiSID 2 Filter Curve",
                    resolveSelectValue(val),
                    "HOME_ULTISID_PROFILE",
                    "UltiSID filter curve updated",
                  );
                }
              }}
              identityPending={identityPending}
              isIdentityReadOnly={!isUltiSid}
              addressValue={addressSelectValue || baseAddressLabel}
              addressOptions={addressOptions}
              onAddressChange={(val) =>
                void updateConfigValue(
                  "SID Addressing",
                  entry.addressItem,
                  resolveSelectValue(val),
                  "HOME_SID_ADDRESS",
                  `${entry.label} address updated`,
                )
              }
              addressPending={addressPending}
              shapingControls={shapingControls}
              volume={volumeSliderValue}
              volumeMax={volumeMax}
              volumeStep={SID_SLIDER_STEP}
              onVolumeCommit={handleVolumeCommit}
              onVolumePreview={handleVolumePreview}
              // commitOnly (unlike pan below, which defaults to "throttled"): avoids
              // sending a live audio-level write on every drag tick, which would
              // otherwise cause audible level jumps/clicks while dragging. Both
              // share the same interactiveWrite lane, which now merges pending
              // per-item writes instead of dropping one when both fire close
              // together - see HARD9-016.
              volumePreviewMode="commitOnly"
              volumeRound={resolveVolumeIndexValue}
              volumeValueFormatter={volumeValueFormatter}
              volumeMidpoint={volumeCenterIndex}
              pan={panSliderValue}
              panMax={panMax}
              panStep={SID_SLIDER_STEP}
              onPanCommit={handlePanCommit}
              onPanPreview={handlePanPreview}
              panRound={resolvePanIndexValue}
              panValueFormatter={panValueFormatter}
              panMidpoint={panCenterIndex}
              isConnected={isConnected}
              testIdSuffix={entry.key}
            />
          );
        })}
      </div>
    </motion.div>
  );
}
