/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { useAppMode } from "@/lib/appMode/appModeStore";
import { isSurfaceVisible } from "@/lib/appMode/surfaces";
import { isKeypadEdition } from "@/lib/docs/deviceNames";
import { Play } from "lucide-react";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  loadAutofireRateHz,
  saveAutofireRateHz,
  loadShowAutofireButton,
  saveShowAutofireButton,
  MIN_AUTOFIRE_RATE_HZ,
  MAX_AUTOFIRE_RATE_HZ,
} from "@/lib/remoteInput/autofire";
import { GameModeSettingsSection } from "@/pages/settings/GameModeSettingsSection";
import { RemoteFunctionSettingsSection } from "@/pages/settings/RemoteFunctionSettingsSection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListPreviewLimit } from "@/hooks/useListPreviewLimit";
import { clampListPreviewLimit } from "@/lib/uiPreferences";
import {
  APP_SETTINGS_KEYS,
  loadDiskAutostartMode,
  saveDiskAutostartMode,
  loadSearchInsideDisks,
  saveSearchInsideDisks,
  loadFriendlySidNames,
  saveFriendlySidNames,
  loadBootMenuAnswerEnabled,
  saveBootMenuAnswerEnabled,
  loadBootMenuKey,
  saveBootMenuKey,
  loadBootSettleMs,
  saveBootSettleMs,
  BOOT_MENU_KEYS,
  BOOT_SETTLE_MIN_MS,
  BOOT_SETTLE_MAX_MS,
  type BootMenuKey,
  loadStreamVideoPort,
  saveStreamVideoPort,
  loadStreamAudioPort,
  saveStreamAudioPort,
  loadStreamNetworkBufferMs,
  saveStreamNetworkBufferMs,
  loadStreamInputPriority,
  saveStreamInputPriority,
  loadStreamVideoBadges,
  saveStreamVideoBadges,
  loadStreamNativeVideoAssembly,
  saveStreamNativeVideoAssembly,
  loadStreamNativeAudio,
  saveStreamNativeAudio,
  type DiskAutostartMode,
} from "@/lib/config/appSettings";
import { HelperText } from "@/components/ui/HelperText";
import { SkipRomDependentSongsRow } from "@/pages/settings/SkipRomDependentSongsRow";
import { C64SeekMuteRow } from "@/pages/settings/C64SeekMuteRow";
import { variant } from "@/generated/variant";
import { SettingsSection } from "@/pages/settings/SettingsSection";

export function PlayAndDiskSettingsSection() {
  const { flags } = useFeatureFlags();
  const machineRows = isSurfaceVisible("settings:play-and-disk-machine-rows", useAppMode());
  const { limit: listPreviewLimit, setLimit: setListPreviewLimit } = useListPreviewLimit();
  const [listPreviewInput, setListPreviewInput] = useState(String(listPreviewLimit));
  const [diskAutostartMode, setDiskAutostartMode] = useState<DiskAutostartMode>(loadDiskAutostartMode());
  const [friendlySidNames, setFriendlySidNames] = useState(loadFriendlySidNames);
  const [searchInsideDisks, setSearchInsideDisks] = useState(loadSearchInsideDisks);
  const [bootMenuAnswerEnabled, setBootMenuAnswerEnabled] = useState(loadBootMenuAnswerEnabled);
  const [bootMenuKey, setBootMenuKey] = useState<BootMenuKey>(loadBootMenuKey);
  const [bootSettleMs, setBootSettleMs] = useState<number>(loadBootSettleMs);
  const [streamVideoPort, setStreamVideoPort] = useState<number>(loadStreamVideoPort);
  const [streamAudioPort, setStreamAudioPort] = useState<number>(loadStreamAudioPort);
  const [streamNetworkBufferMs, setStreamNetworkBufferMs] = useState<number>(loadStreamNetworkBufferMs);
  const [streamNativeVideoAssembly, setStreamNativeVideoAssembly] = useState<boolean>(loadStreamNativeVideoAssembly);
  const [streamInputPriority, setStreamInputPriority] = useState<boolean>(loadStreamInputPriority);
  const [streamVideoBadges, setStreamVideoBadges] = useState<boolean>(loadStreamVideoBadges);
  const [streamNativeAudio, setStreamNativeAudio] = useState<boolean>(loadStreamNativeAudio);
  const [autofireRateHz, setAutofireRateHz] = useState(loadAutofireRateHz());
  const [showAutofireButton, setShowAutofireButton] = useState(loadShowAutofireButton());

  useEffect(() => {
    setListPreviewInput(String(listPreviewLimit));
  }, [listPreviewLimit]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key === APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY) {
        setDiskAutostartMode(loadDiskAutostartMode());
      }
    };
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);

  const commitListPreviewLimit = () => {
    const parsed = Number(listPreviewInput);
    const clamped = clampListPreviewLimit(parsed);
    setListPreviewLimit(clamped);
    setListPreviewInput(String(clamped));
  };

  return (
    <SettingsSection
      id="play-and-disk"
      title={machineRows ? "Play and disk" : "Play"}
      summary={machineRows ? "Launching, Live View streaming, Remote Input" : "List length and tune names"}
      icon={Play}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="listPreviewLimit" className="text-sm">
            List preview limit
          </Label>
          <Input
            id="listPreviewLimit"
            type="number"
            min={1}
            max={200}
            value={listPreviewInput}
            onChange={(event) => setListPreviewInput(event.target.value)}
            onBlur={commitListPreviewLimit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitListPreviewLimit();
              }
            }}
          />
          <HelperText>Items shown before View all. Default 50.</HelperText>
        </div>

        <div className="flex items-start justify-between gap-3 flex-wrap min-w-0">
          <div className="min-w-[9rem] flex-1">
            <Label htmlFor="settings-friendly-sid-names" className="flex min-h-11 items-center font-medium">
              Friendly SID names
            </Label>
            <HelperText>
              Shows SID tunes as “Bossa in Do” instead of the raw filename, badged with chip count.
            </HelperText>
          </div>
          <Switch
            id="settings-friendly-sid-names"
            data-testid="settings-friendly-sid-names"
            checked={friendlySidNames}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setFriendlySidNames(next);
              saveFriendlySidNames(next);
            }}
          />
        </div>

        <SkipRomDependentSongsRow />

        {machineRows ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="disk-autostart-mode" className="text-sm">
                Disk first-PRG load
              </Label>
              <Select
                value={diskAutostartMode}
                onValueChange={(value) => {
                  const mode = value as DiskAutostartMode;
                  setDiskAutostartMode(mode);
                  saveDiskAutostartMode(mode);
                }}
              >
                <SelectTrigger id="disk-autostart-mode">
                  <SelectValue placeholder="Select load mode" />
                </SelectTrigger>
                <SelectContent>
                  {/* The option names the mode; the paragraph below gives the command it
                          issues and what DMA does. Spelling `LOAD"*",8,1` out here made the
                          option 363px wide, which runs past a 320px screen in the list and
                          in the trigger once it is chosen. */}
                  <SelectItem value="kernal">Classic KERNAL load</SelectItem>
                  <SelectItem value="dma">DMA</SelectItem>
                </SelectContent>
              </Select>
              <HelperText>
                KERNAL load mounts the disk and types LOAD&quot;*&quot;,8,1. DMA loads the first PRG directly, faster,
                but some loaders reject it.
              </HelperText>
            </div>

            <C64SeekMuteRow />

            {flags.in_image_search_enabled && (
              <div className="flex items-start justify-between gap-3 flex-wrap min-w-0">
                <div className="min-w-[9rem] flex-1">
                  <Label htmlFor="settings-search-inside-disks" className="flex min-h-11 items-center font-medium">
                    Search inside disk images
                  </Label>
                  <HelperText>Also matches programs inside .d64/.d71/.d81 images, not just filenames.</HelperText>
                </div>
                <Switch
                  id="settings-search-inside-disks"
                  data-testid="settings-search-inside-disks"
                  checked={searchInsideDisks}
                  onCheckedChange={(checked) => {
                    const next = checked === true;
                    setSearchInsideDisks(next);
                    saveSearchInsideDisks(next);
                  }}
                />
              </div>
            )}

            {flags.launch_safety_enabled && (
              <div className="space-y-3 rounded-md border border-border p-3" data-testid="settings-launch-safety">
                <div className="flex items-start justify-between gap-3 flex-wrap min-w-0">
                  <div className="min-w-[9rem] flex-1">
                    <Label htmlFor="settings-boot-menu-answer" className="flex min-h-11 items-center font-medium">
                      Answer cartridge boot menu after reset
                    </Label>
                    <HelperText>
                      Advanced. Presses a key after a Mount &amp; Load reset so a cartridge&apos;s boot menu
                      doesn&apos;t swallow the typed LOAD. Leave off unless you run such a cartridge.
                    </HelperText>
                  </div>
                  <Switch
                    id="settings-boot-menu-answer"
                    data-testid="settings-boot-menu-answer"
                    checked={bootMenuAnswerEnabled}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      setBootMenuAnswerEnabled(next);
                      saveBootMenuAnswerEnabled(next);
                    }}
                  />
                </div>
                {bootMenuAnswerEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="settings-boot-menu-key" className="text-sm">
                        Menu key
                      </Label>
                      <Select
                        value={bootMenuKey}
                        onValueChange={(value) => {
                          const key = value as BootMenuKey;
                          setBootMenuKey(key);
                          saveBootMenuKey(key);
                        }}
                      >
                        <SelectTrigger id="settings-boot-menu-key" data-testid="settings-boot-menu-key">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BOOT_MENU_KEYS.map((key) => (
                            <SelectItem key={key} value={key}>
                              {key}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="settings-boot-settle" className="text-sm">
                        Boot settle (ms)
                      </Label>
                      <Input
                        id="settings-boot-settle"
                        data-testid="settings-boot-settle"
                        inputMode="numeric"
                        value={String(bootSettleMs)}
                        min={BOOT_SETTLE_MIN_MS}
                        max={BOOT_SETTLE_MAX_MS}
                        onChange={(event) => setBootSettleMs(Number(event.target.value) || 0)}
                        onBlur={() => {
                          const clamped = Math.min(BOOT_SETTLE_MAX_MS, Math.max(BOOT_SETTLE_MIN_MS, bootSettleMs));
                          setBootSettleMs(clamped);
                          saveBootSettleMs(clamped);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {flags.live_view_enabled && (flags.audio_mirror_enabled || flags.video_mirror_enabled) && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="settings-stream-video-port" className="text-sm">
                    Video stream port
                  </Label>
                  <Input
                    id="settings-stream-video-port"
                    data-testid="settings-stream-video-port"
                    inputMode="numeric"
                    value={String(streamVideoPort)}
                    onChange={(event) => setStreamVideoPort(Number(event.target.value) || 0)}
                    onBlur={() => {
                      saveStreamVideoPort(streamVideoPort);
                      setStreamVideoPort(loadStreamVideoPort());
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="settings-stream-audio-port" className="text-sm">
                    Audio stream port
                  </Label>
                  <Input
                    id="settings-stream-audio-port"
                    data-testid="settings-stream-audio-port"
                    inputMode="numeric"
                    value={String(streamAudioPort)}
                    onChange={(event) => setStreamAudioPort(Number(event.target.value) || 0)}
                    onBlur={() => {
                      saveStreamAudioPort(streamAudioPort);
                      setStreamAudioPort(loadStreamAudioPort());
                    }}
                  />
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">
                  UDP ports the device streams Audio/Video Mirror to. Defaults 11000 / 11001; change only if a port is
                  already in use.
                </p>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="settings-stream-network-buffer" className="text-sm">
                    Audio network buffer (ms)
                  </Label>
                  <Input
                    id="settings-stream-network-buffer"
                    data-testid="settings-stream-network-buffer"
                    inputMode="numeric"
                    value={String(streamNetworkBufferMs)}
                    onChange={(event) => setStreamNetworkBufferMs(Number(event.target.value) || 0)}
                    onBlur={() => {
                      saveStreamNetworkBufferMs(streamNetworkBufferMs);
                      setStreamNetworkBufferMs(loadStreamNetworkBufferMs());
                    }}
                  />
                  <HelperText>
                    Smooths late or dropped audio packets. Android may deepen this further. Default 60 ms; 0 = lowest
                    latency, least resilient.
                  </HelperText>
                </div>
                <div className="col-span-2 flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <Label htmlFor="settings-stream-native-assembly" className="flex min-h-11 items-center font-medium">
                      Fast video (native assembly)
                    </Label>
                    <HelperText>Full frame rate (50 fps PAL / 60 fps NTSC). Leave on; Android only.</HelperText>
                  </div>
                  <Switch
                    id="settings-stream-native-assembly"
                    data-testid="settings-stream-native-assembly"
                    checked={streamNativeVideoAssembly}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      setStreamNativeVideoAssembly(next);
                      saveStreamNativeVideoAssembly(next);
                    }}
                  />
                </div>
                <div className="col-span-2 flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <Label htmlFor="settings-stream-video-badges" className="flex min-h-11 items-center font-medium">
                      Show video standard and frame rate
                    </Label>
                    <HelperText>
                      Draws &ldquo;PAL 50 fps&rdquo; over the picture in Live View and Remote Input. Turn off for an
                      unobstructed screen.
                    </HelperText>
                  </div>
                  <Switch
                    id="settings-stream-video-badges"
                    data-testid="settings-stream-video-badges"
                    checked={streamVideoBadges}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      setStreamVideoBadges(next);
                      saveStreamVideoBadges(next);
                    }}
                  />
                </div>
                <div className="col-span-2 flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <Label htmlFor="settings-stream-input-priority" className="flex min-h-11 items-center font-medium">
                      Input priority (instant joystick)
                    </Label>
                    <HelperText>
                      While you&apos;re driving the C64, video briefly drops frame rate so input lands instantly. Leave
                      on.
                    </HelperText>
                  </div>
                  <Switch
                    id="settings-stream-input-priority"
                    data-testid="settings-stream-input-priority"
                    checked={streamInputPriority}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      setStreamInputPriority(next);
                      saveStreamInputPriority(next);
                    }}
                  />
                </div>
                <div className="col-span-2 flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <Label htmlFor="settings-stream-native-audio" className="flex min-h-11 items-center font-medium">
                      Low-latency audio (native)
                    </Label>
                    <HelperText>
                      Cuts keypress-to-sound delay vs. the browser engine. Leave on; Android only.
                    </HelperText>
                  </div>
                  <Switch
                    id="settings-stream-native-audio"
                    data-testid="settings-stream-native-audio"
                    checked={streamNativeAudio}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      setStreamNativeAudio(next);
                      saveStreamNativeAudio(next);
                    }}
                  />
                </div>
              </div>
            )}

            <GameModeSettingsSection />

            {isKeypadEdition(variant.id) ? <RemoteFunctionSettingsSection /> : null}

            <div className="flex items-start justify-between gap-3 flex-wrap min-w-0">
              <div className="min-w-[9rem] flex-1">
                <Label htmlFor="settings-show-autofire" className="flex min-h-11 items-center font-medium">
                  Show Autofire button
                </Label>
                <HelperText>Rarely needed, so it&apos;s hidden by default in Remote Input and Game Mode.</HelperText>
              </div>
              <Switch
                id="settings-show-autofire"
                data-testid="settings-show-autofire"
                checked={showAutofireButton}
                onCheckedChange={(checked) => {
                  const next = checked === true;
                  setShowAutofireButton(next);
                  saveShowAutofireButton(next);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Autofire rate: {autofireRateHz}/s</Label>
              <Slider
                min={MIN_AUTOFIRE_RATE_HZ}
                max={MAX_AUTOFIRE_RATE_HZ}
                step={1}
                value={[autofireRateHz]}
                disabled={!showAutofireButton}
                onValueChange={([value]) => setAutofireRateHz(value)}
                onValueCommit={([value]) => saveAutofireRateHz(value)}
                aria-label="Autofire rate"
                data-testid="settings-autofire-rate-slider"
              />
              <HelperText>
                How many times per second FIRE fires while held. Default 5/s, range {MIN_AUTOFIRE_RATE_HZ}–
                {MAX_AUTOFIRE_RATE_HZ}/s.
              </HelperText>
            </div>
          </>
        ) : null}
      </div>
    </SettingsSection>
  );
}
