/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { variant } from "@/generated/variant";

const DEBUG_LOGGING_KEY = "c64u_debug_logging_enabled";
const CONFIG_WRITE_INTERVAL_KEY = "c64u_config_write_min_interval_ms";
const DEMO_MODE_ENABLED_KEY = "c64u_demo_mode_enabled";
const LEGACY_AUTO_DEMO_MODE_KEY = "c64u_automatic_demo_mode_enabled";
const STARTUP_DISCOVERY_WINDOW_MS_KEY = "c64u_startup_discovery_window_ms";
const BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY = "c64u_background_rediscovery_interval_ms";
const DISCOVERY_PROBE_TIMEOUT_MS_KEY = "c64u_discovery_probe_timeout_ms";
const DISK_AUTOSTART_MODE_KEY = "c64u_disk_autostart_mode";
const MIRROR_C64_AUDIO_KEY = "c64u_mirror_c64_audio";
const MIRROR_C64_VIDEO_KEY = "c64u_mirror_c64_video";
const LOCAL_ENGINE_AUTO_ROMS_KEY = "c64u_local_engine_auto_roms";
const SID_RADIO_MIN_SECONDS_KEY = "c64u_sid_radio_min_seconds";
const FRIENDLY_SID_NAMES_KEY = "c64u_friendly_sid_names";
const VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY = "c64u_volume_slider_preview_interval_ms";
const NOTIFICATION_VISIBILITY_KEY = "c64u_notification_visibility";
const NOTIFICATION_DURATION_MS_KEY = "c64u_notification_duration_ms";
const AUTO_ROTATION_ENABLED_KEY = "c64u_auto_rotation_enabled";
const SCREEN_ORIENTATION_MODE_KEY = "c64u_screen_orientation_mode";
const ENABLE_SWIPE_NAVIGATION_KEY = "c64u_enable_swipe_navigation";
const ARCHIVE_HOST_OVERRIDE_KEY = "c64u_archive_host_override";
const ARCHIVE_CLIENT_ID_OVERRIDE_KEY = "c64u_archive_client_id_override";
const ARCHIVE_USER_AGENT_OVERRIDE_KEY = "c64u_archive_user_agent_override";
const HIDE_STATUS_BAR_KEY = "c64u_full_screen_hide_status_bar";
const HIDE_NAVIGATION_BAR_KEY = "c64u_full_screen_hide_navigation_bar";
const SID_RADIO_ENABLED_KEY = "c64u_sid_radio_enabled";
const SID_RANKING_ENABLED_KEY = "c64u_sid_ranking_enabled";
const PLAYBACK_ENGINE_KEY = "c64u_playback_engine";
const SID_EMULATION_ENGINE_KEY = "c64u_sid_emulation_engine";
const LOCAL_SID_MODEL_KEY = "c64u_local_sid_model";
const LOCAL_SID_MODEL_FROM_DEVICE_KEY = "c64u_local_sid_model_from_device";
const LEARNED_DEVICE_SID_MODEL_KEY = "c64u_learned_device_sid_model";
const PLAYBACK_CROSSFADE_MS_KEY = "c64u_playback_crossfade_ms";
const LOCAL_ENGINE_ENABLED_KEY = "c64u_local_engine_enabled";
const BOOT_MENU_ANSWER_ENABLED_KEY = "c64u_boot_menu_answer_enabled";
const BOOT_MENU_KEY_KEY = "c64u_boot_menu_key";
const BOOT_SETTLE_MS_KEY = "c64u_boot_settle_ms";
const SEARCH_INSIDE_DISKS_KEY = "c64u_search_inside_disks";
const STREAM_VIDEO_PORT_KEY = "c64u_stream_video_port";
const STREAM_AUDIO_PORT_KEY = "c64u_stream_audio_port";
const STREAM_NETWORK_BUFFER_MS_KEY = "c64u_stream_network_buffer_ms";
const STREAM_NATIVE_VIDEO_ASSEMBLY_KEY = "c64u_stream_native_video_assembly";
const STREAM_NATIVE_AUDIO_KEY = "c64u_stream_native_audio";
const STREAM_VIDEO_FRAME_RATE_MODE_KEY = "c64u_stream_video_frame_rate_mode";
const STREAM_INPUT_PRIORITY_KEY = "c64u_stream_input_priority";
const STREAM_VIDEO_BADGES_KEY = "c64u_stream_video_badges";
const STREAM_AUDIO_ROUTE_KEY = "c64u_stream_audio_route";
const VIC_PALETTE_KEY = "c64u_vic_palette";
const PALETTE_TARGET_KEY = "c64u_palette_target";
const PERSIST_CONFIG_TO_FLASH_KEY = "c64u_persist_config_to_flash";

export const DEFAULT_CONFIG_WRITE_INTERVAL_MS = 200;
export type NotificationVisibility = "errors-only" | "all";
export const DEFAULT_NOTIFICATION_VISIBILITY: NotificationVisibility = "errors-only";
export const DEFAULT_NOTIFICATION_DURATION_MS = 4000;
export const NOTIFICATION_DURATION_MIN_MS = 2000;
export const NOTIFICATION_DURATION_MAX_MS = 8000;
export const DEFAULT_DEMO_MODE_ENABLED = false;
export const DEFAULT_AUTO_DEMO_MODE_ENABLED = DEFAULT_DEMO_MODE_ENABLED;
export const DEFAULT_STARTUP_DISCOVERY_WINDOW_MS = 3000;
export const DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS = 5000;
export const DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS = 2500;
export type DiskAutostartMode = "kernal" | "dma";
export const DEFAULT_DISK_AUTOSTART_MODE: DiskAutostartMode = "kernal";
export const DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS = 200;

const clampInterval = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_CONFIG_WRITE_INTERVAL_MS;
  return Math.min(2000, Math.max(0, Math.round(value / 100) * 100));
};

const clampDiscoveryWindowMs = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_STARTUP_DISCOVERY_WINDOW_MS;
  const rounded = Math.round(value / 100) * 100;
  return Math.min(15000, Math.max(500, rounded));
};

const clampBackgroundRediscoveryIntervalMsInternal = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS;
  const rounded = Math.round(value / 100) * 100;
  return Math.min(60000, Math.max(1000, rounded));
};

const clampDiscoveryProbeTimeoutMsInternal = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS;
  const rounded = Math.round(value / 100) * 100;
  return Math.min(10000, Math.max(500, rounded));
};

const clampVolumeSliderPreviewIntervalMsInternal = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS;
  return Math.min(500, Math.max(100, Math.round(value)));
};

const clampNotificationDurationMsInternal = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_NOTIFICATION_DURATION_MS;
  return Math.min(NOTIFICATION_DURATION_MAX_MS, Math.max(NOTIFICATION_DURATION_MIN_MS, Math.round(value / 500) * 500));
};

const readBoolean = (key: string, fallback: boolean) => {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
};

const readBooleanWithLegacy = (key: string, legacyKey: string, fallback: boolean) => {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw !== null) return raw === "1";
  const legacyRaw = localStorage.getItem(legacyKey);
  if (legacyRaw !== null) return legacyRaw === "1";
  return fallback;
};

const readRawString = (key: string) => (typeof localStorage === "undefined" ? null : localStorage.getItem(key));

// Nothing stored, no localStorage at all, or a value this build no longer
// recognises all mean the same thing to a caller: use the default.
const readEnum = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  const raw = readRawString(key);
  return allowed.includes(raw as T) ? (raw as T) : fallback;
};

const readNumber = (key: string, fallback: number) => {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizeDiskAutostartMode = (value: unknown): DiskAutostartMode => (value === "dma" ? "dma" : "kernal");

const broadcast = (key: string, value: unknown) => {
  window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: { key, value } }));
};

// Every setting is stored the same way: skip entirely when there is no
// localStorage (SSR, and the Node-side Playwright collection pass), write, then
// announce the new value on the shared "c64u-app-settings-updated" event so
// live hooks re-read it. These three primitives are that sequence; the exported
// save* functions add only their own clamp or normalisation on top.
const writeBoolean = (key: string, enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, enabled ? "1" : "0");
  broadcast(key, enabled);
};

const writeNumber = (key: string, value: number) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, String(value));
  broadcast(key, value);
};

const writeString = (key: string, value: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, value);
  broadcast(key, value);
};

export const loadDebugLoggingEnabled = () => readBoolean(DEBUG_LOGGING_KEY, false);

export const saveDebugLoggingEnabled = (enabled: boolean) => writeBoolean(DEBUG_LOGGING_KEY, enabled);

/**
 * Full-screen (immersive) defaults come from the active build variant
 * (`variant.runtime.defaultHide*`), so a keypad-first appliance variant can ship
 * full-screen by default while the standard app does not. A user toggle in
 * Settings persists and overrides the variant default.
 */
export const DEFAULT_HIDE_STATUS_BAR = Boolean(variant.runtime.defaultHideStatusBar);
export const DEFAULT_HIDE_NAVIGATION_BAR = Boolean(variant.runtime.defaultHideNavigationBar);

export const loadHideStatusBar = () => readBoolean(HIDE_STATUS_BAR_KEY, DEFAULT_HIDE_STATUS_BAR);

export const saveHideStatusBar = (enabled: boolean) => writeBoolean(HIDE_STATUS_BAR_KEY, enabled);

export const loadHideNavigationBar = () => readBoolean(HIDE_NAVIGATION_BAR_KEY, DEFAULT_HIDE_NAVIGATION_BAR);

export const saveHideNavigationBar = (enabled: boolean) => writeBoolean(HIDE_NAVIGATION_BAR_KEY, enabled);

export const loadConfigWriteIntervalMs = () =>
  clampInterval(readNumber(CONFIG_WRITE_INTERVAL_KEY, DEFAULT_CONFIG_WRITE_INTERVAL_MS));

export const saveConfigWriteIntervalMs = (value: number) =>
  writeNumber(CONFIG_WRITE_INTERVAL_KEY, clampInterval(value));

export const clampConfigWriteIntervalMs = (value: number) => clampInterval(value);

export const loadDemoModeEnabled = () =>
  readBooleanWithLegacy(DEMO_MODE_ENABLED_KEY, LEGACY_AUTO_DEMO_MODE_KEY, DEFAULT_DEMO_MODE_ENABLED);

export const saveDemoModeEnabled = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DEMO_MODE_ENABLED_KEY, enabled ? "1" : "0");
  localStorage.removeItem(LEGACY_AUTO_DEMO_MODE_KEY);
  broadcast(DEMO_MODE_ENABLED_KEY, enabled);
};

export const loadAutomaticDemoModeEnabled = loadDemoModeEnabled;

export const saveAutomaticDemoModeEnabled = saveDemoModeEnabled;

export const loadStartupDiscoveryWindowMs = () =>
  clampDiscoveryWindowMs(readNumber(STARTUP_DISCOVERY_WINDOW_MS_KEY, DEFAULT_STARTUP_DISCOVERY_WINDOW_MS));

export const saveStartupDiscoveryWindowMs = (value: number) =>
  writeNumber(STARTUP_DISCOVERY_WINDOW_MS_KEY, clampDiscoveryWindowMs(value));

export const clampStartupDiscoveryWindowMs = (value: number) => clampDiscoveryWindowMs(value);

export const loadBackgroundRediscoveryIntervalMs = () =>
  clampBackgroundRediscoveryIntervalMsInternal(
    readNumber(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS),
  );

export const saveBackgroundRediscoveryIntervalMs = (value: number) =>
  writeNumber(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, clampBackgroundRediscoveryIntervalMsInternal(value));

export const clampBackgroundRediscoveryIntervalMs = (value: number) =>
  clampBackgroundRediscoveryIntervalMsInternal(value);

export const loadDiscoveryProbeTimeoutMs = () =>
  clampDiscoveryProbeTimeoutMsInternal(readNumber(DISCOVERY_PROBE_TIMEOUT_MS_KEY, DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS));

export const saveDiscoveryProbeTimeoutMs = (value: number) =>
  writeNumber(DISCOVERY_PROBE_TIMEOUT_MS_KEY, clampDiscoveryProbeTimeoutMsInternal(value));

export const clampDiscoveryProbeTimeoutMs = (value: number) => clampDiscoveryProbeTimeoutMsInternal(value);

export const loadDiskAutostartMode = () =>
  normalizeDiskAutostartMode(readRawString(DISK_AUTOSTART_MODE_KEY) ?? DEFAULT_DISK_AUTOSTART_MODE);

export const saveDiskAutostartMode = (mode: DiskAutostartMode) =>
  writeString(DISK_AUTOSTART_MODE_KEY, normalizeDiskAutostartMode(mode));

export const loadVolumeSliderPreviewIntervalMs = () =>
  clampVolumeSliderPreviewIntervalMsInternal(
    readNumber(VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY, DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS),
  );

export const saveVolumeSliderPreviewIntervalMs = (value: number) =>
  writeNumber(VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY, clampVolumeSliderPreviewIntervalMsInternal(value));

export const clampVolumeSliderPreviewIntervalMs = (value: number) => clampVolumeSliderPreviewIntervalMsInternal(value);

// Launch Safety — optional boot-menu answer (Content Explorer capability B).
// Off by default; only helps machines running a cartridge that shows a boot menu
// on reset, where a Mount & Load's typed LOAD would otherwise be swallowed.
export type BootMenuKey = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "RETURN" | "SPACE";
export const BOOT_MENU_KEYS: readonly BootMenuKey[] = [
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "RETURN",
  "SPACE",
];
export const DEFAULT_BOOT_MENU_ANSWER_ENABLED = false;
export const DEFAULT_BOOT_MENU_KEY: BootMenuKey = "F7";
export const DEFAULT_BOOT_SETTLE_MS = 2800;
export const BOOT_SETTLE_MIN_MS = 1000;
export const BOOT_SETTLE_MAX_MS = 8000;

const normalizeBootMenuKey = (value: unknown): BootMenuKey =>
  BOOT_MENU_KEYS.includes(value as BootMenuKey) ? (value as BootMenuKey) : DEFAULT_BOOT_MENU_KEY;

const clampBootSettleMsInternal = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_BOOT_SETTLE_MS;
  return Math.min(BOOT_SETTLE_MAX_MS, Math.max(BOOT_SETTLE_MIN_MS, Math.round(value / 100) * 100));
};

export const loadBootMenuAnswerEnabled = () =>
  readBoolean(BOOT_MENU_ANSWER_ENABLED_KEY, DEFAULT_BOOT_MENU_ANSWER_ENABLED);

export const saveBootMenuAnswerEnabled = (enabled: boolean) => writeBoolean(BOOT_MENU_ANSWER_ENABLED_KEY, enabled);

export const loadBootMenuKey = (): BootMenuKey => normalizeBootMenuKey(readRawString(BOOT_MENU_KEY_KEY));

export const saveBootMenuKey = (value: BootMenuKey) => writeString(BOOT_MENU_KEY_KEY, normalizeBootMenuKey(value));

export const loadBootSettleMs = () => clampBootSettleMsInternal(readNumber(BOOT_SETTLE_MS_KEY, DEFAULT_BOOT_SETTLE_MS));

export const saveBootSettleMs = (value: number) => writeNumber(BOOT_SETTLE_MS_KEY, clampBootSettleMsInternal(value));

export const clampBootSettleMs = (value: number) => clampBootSettleMsInternal(value);

// In-image search (Content Explorer capability C): whether media search descends
// into disk images. Off by default (today's top-level-only behaviour).
export const DEFAULT_SEARCH_INSIDE_DISKS = false;

export const loadSearchInsideDisks = () => readBoolean(SEARCH_INSIDE_DISKS_KEY, DEFAULT_SEARCH_INSIDE_DISKS);

export const saveSearchInsideDisks = (enabled: boolean) => writeBoolean(SEARCH_INSIDE_DISKS_KEY, enabled);

// Live Mirror (Content Explorer D/E): UDP ports the device streams to and the
// receiver/bridge binds. Defaults 11000 (video) / 11001 (audio); configurable
// because deployments (or a c64stream instance on 21000/21001) may need others.
export const DEFAULT_STREAM_VIDEO_PORT = 11000;
export const DEFAULT_STREAM_AUDIO_PORT = 11001;

const clampPort = (value: number, fallback: number) => {
  if (Number.isNaN(value)) return fallback;
  return Math.min(65535, Math.max(1, Math.round(value)));
};

export const loadStreamVideoPort = () =>
  clampPort(readNumber(STREAM_VIDEO_PORT_KEY, DEFAULT_STREAM_VIDEO_PORT), DEFAULT_STREAM_VIDEO_PORT);

export const saveStreamVideoPort = (value: number) =>
  writeNumber(STREAM_VIDEO_PORT_KEY, clampPort(value, DEFAULT_STREAM_VIDEO_PORT));

export const loadStreamAudioPort = () =>
  clampPort(readNumber(STREAM_AUDIO_PORT_KEY, DEFAULT_STREAM_AUDIO_PORT), DEFAULT_STREAM_AUDIO_PORT);

export const saveStreamAudioPort = (value: number) =>
  writeNumber(STREAM_AUDIO_PORT_KEY, clampPort(value, DEFAULT_STREAM_AUDIO_PORT));

/**
 * Audio jitter buffer depth (ms) for Live View — how much audio is held back so a late, reordered
 * or bursty delivery still plays in order instead of clicking.
 *
 * ONE setting for one idea, whichever path is playing. There used to be two: this one, which had the
 * Settings control and a 5 ms default, and an invisible second key for the native path. On Android
 * the native path always wins, so the control the user could see governed nothing they could hear,
 * and the number that actually mattered could not be reached at all.
 *
 * The two paths spend it differently, and that is fine:
 *  - the **native pipeline** treats it as a floor and deepens it when the link turns out to be
 *    bursty (see `AudioPipeline`), so it provisions itself rather than depending on this being
 *    guessed correctly in advance;
 *  - the **WebAudio fallback** holds each packet exactly this long before playback.
 *
 * The default is 60 ms rather than the old 5 ms because 5 ms was chosen for "a healthy LAN" and a
 * phone on Wi-Fi is not one: the same stream a wired host received every 4.00 ms reached the Pixel 4
 * in clumps of up to 29 packets after gaps of 119 ms. 0 disables buffering.
 */
export const DEFAULT_STREAM_NETWORK_BUFFER_MS = 60;
export const MAX_STREAM_NETWORK_BUFFER_MS = 400; // matches c64stream C64_MAX_JITTER_MS

const clampNetworkBufferMs = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_STREAM_NETWORK_BUFFER_MS;
  return Math.min(MAX_STREAM_NETWORK_BUFFER_MS, Math.max(0, Math.round(value)));
};

export const loadStreamNetworkBufferMs = () =>
  clampNetworkBufferMs(readNumber(STREAM_NETWORK_BUFFER_MS_KEY, DEFAULT_STREAM_NETWORK_BUFFER_MS));

export const saveStreamNetworkBufferMs = (value: number) =>
  writeNumber(STREAM_NETWORK_BUFFER_MS_KEY, clampNetworkBufferMs(value));

/**
 * Native video assembly (Live View fast path). When on (default), the Android StreamUdp plugin
 * assembles VIC datagrams into whole frames natively and crosses the Capacitor bridge once per
 * FRAME (~50/s PAL) instead of once per PACKET (~3400/s) — the per-event bridge overhead was the
 * hard cap that held the mirror to ~20–30 fps. Off falls back to the per-packet path (JS assembles
 * frames), for A/B measurement or as an escape hatch. Native-only; the web/Docker WebSocket bridge
 * is unaffected.
 */
export const DEFAULT_STREAM_NATIVE_VIDEO_ASSEMBLY = true;

export const loadStreamNativeVideoAssembly = () =>
  readBoolean(STREAM_NATIVE_VIDEO_ASSEMBLY_KEY, DEFAULT_STREAM_NATIVE_VIDEO_ASSEMBLY);

export const saveStreamNativeVideoAssembly = (enabled: boolean) =>
  writeBoolean(STREAM_NATIVE_VIDEO_ASSEMBLY_KEY, enabled);

/**
 * Native low-latency audio (Live View). When on (default), decoded PCM is played through a native
 * Android `AudioTrack` in low-latency mode instead of the WebAudio player. WebAudio needs an ~80 ms
 * scheduling lead-in for gapless output; the native track's fast-mixer buffer is far smaller
 * (~20–40 ms on the Pixel 4), which is the single largest app-reducible slice of the press→hear
 * latency. All the audio SMARTS stay in TypeScript — the jitter/reorder buffer, loss concealment,
 * batching, health stats and A/V-sync analyzer are unchanged; only the final "push these samples to
 * the speaker" step is native. Off falls back to the WebAudio player (also the web/Docker path,
 * which has no plugin). Native-only.
 */
/**
 * Whether a tune playing on the C64 should also be heard on this device.
 *
 * This is the "Listen on" control's middle question, and it has to be REMEMBERED rather than read
 * back off the live stream. "Listen on: <device>" means the C64's speakers only, and playback used
 * to start the mirror on every launch regardless — so choosing it lasted exactly until the next
 * track, or until one tap took you there from Local, and the phone began streaming audio the
 * listener had just turned off.
 *
 * Default on: a tune started from the phone should be audible from the phone unless asked otherwise.
 */
export const DEFAULT_MIRROR_C64_AUDIO = true;

export const loadMirrorC64Audio = () => readBoolean(MIRROR_C64_AUDIO_KEY, DEFAULT_MIRROR_C64_AUDIO);

export const saveMirrorC64Audio = (enabled: boolean) => writeBoolean(MIRROR_C64_AUDIO_KEY, enabled);

/**
 * Whether the C64's picture should also be shown on this device.
 *
 * The counterpart to {@link loadMirrorC64Audio}, and the same kind of record: what the user last
 * pressed on the Watch button, not a setting to be found and configured. A C64 wired to a
 * television already shows its picture there, so Game Mode must be able to open without one —
 * turning Watch off once is what makes every later launch skip the video stream.
 *
 * Default on: a Game Mode launch on a phone should show the picture unless asked otherwise.
 */
export const DEFAULT_MIRROR_C64_VIDEO = true;

export const loadMirrorC64Video = () => readBoolean(MIRROR_C64_VIDEO_KEY, DEFAULT_MIRROR_C64_VIDEO);

export const saveMirrorC64Video = (enabled: boolean) => writeBoolean(MIRROR_C64_VIDEO_KEY, enabled);

export const DEFAULT_STREAM_NATIVE_AUDIO = true;

export const loadStreamNativeAudio = () => readBoolean(STREAM_NATIVE_AUDIO_KEY, DEFAULT_STREAM_NATIVE_AUDIO);

export const saveStreamNativeAudio = (enabled: boolean) => writeBoolean(STREAM_NATIVE_AUDIO_KEY, enabled);

/**
 * Live View video frame-rate mode (spec §11.1). A user *maximum*: `auto` tries full source cadence
 * and lets the governor back it off under pressure; `100`/`50`/`25` cap the presented rate to
 * every / every-2nd / every-4th source frame. The governor may still demote below a manual cap to
 * protect audio (§11.2). Default `auto`.
 */
export type StreamVideoFrameRateMode = "auto" | "100" | "50" | "25";
export const DEFAULT_STREAM_VIDEO_FRAME_RATE_MODE: StreamVideoFrameRateMode = "auto";
const FRAME_RATE_MODES: readonly StreamVideoFrameRateMode[] = ["auto", "100", "50", "25"] as const;

export const loadStreamVideoFrameRateMode = (): StreamVideoFrameRateMode =>
  readEnum(STREAM_VIDEO_FRAME_RATE_MODE_KEY, FRAME_RATE_MODES, DEFAULT_STREAM_VIDEO_FRAME_RATE_MODE);

export const saveStreamVideoFrameRateMode = (mode: StreamVideoFrameRateMode) =>
  writeString(STREAM_VIDEO_FRAME_RATE_MODE_KEY, mode);

/**
 * Input priority (Live View). When on (default), active C64 input (joystick/keyboard/mouse) briefly
 * sheds the video mirror to a low cadence so the JS thread and the native encoder are free for the
 * input path — guaranteeing an instant C64 response to a sudden joystick movement even while a
 * high-fps stream is running (spec priority: joystick > keyboard > audio > video). Video ramps back
 * up the moment input goes idle. Off = video keeps full cadence regardless of input (useful only for
 * A/B measurement of the effect). See {@link AvMirrorSession.notifyInputActivity}.
 */
export const DEFAULT_STREAM_INPUT_PRIORITY = true;

export const loadStreamInputPriority = () => readBoolean(STREAM_INPUT_PRIORITY_KEY, DEFAULT_STREAM_INPUT_PRIORITY);

export const saveStreamInputPriority = (enabled: boolean) => writeBoolean(STREAM_INPUT_PRIORITY_KEY, enabled);

/**
 * Live View **video badges** — the "PAL 50 fps" readout drawn over the C64 picture, and the
 * matching one in the immersive Remote Input view. On by default, because knowing the video
 * standard and the frame rate the app is actually presenting is the fastest way to see that
 * the stream is healthy. Off leaves the picture unobstructed for watching or for a screenshot.
 */
export const DEFAULT_STREAM_VIDEO_BADGES = true;

export const loadStreamVideoBadges = () => readBoolean(STREAM_VIDEO_BADGES_KEY, DEFAULT_STREAM_VIDEO_BADGES);

export const saveStreamVideoBadges = (enabled: boolean) => writeBoolean(STREAM_VIDEO_BADGES_KEY, enabled);

/**
 * Live View **audio route** — how Listen-only audio reaches the app (firmware
 * PR #732 `wifi=true`). The firmware can send **audio-only** over Wi‑Fi, which
 * never coexists with video, so this only governs audio-without-video:
 *
 * - `dynamic` (default) — Wi‑Fi while audio is the only stream; automatically
 *   moves to Ethernet when you add video so both share one route (and back to
 *   Wi‑Fi when video stops). "Just works."
 * - `wifi` — always prefer Wi‑Fi for audio. Because Wi‑Fi audio can't run with
 *   video, starting video is blocked while Wi‑Fi audio is live.
 * - `ethernet` — always use Ethernet for audio (the classic behaviour).
 *
 * Wi‑Fi is attempted, not pre-detected: if the device has no Wi‑Fi the start
 * fails and the app retries over Ethernet.
 */
export type StreamAudioRoute = "dynamic" | "wifi" | "ethernet";
export const DEFAULT_STREAM_AUDIO_ROUTE: StreamAudioRoute = "dynamic";
const STREAM_AUDIO_ROUTES: readonly StreamAudioRoute[] = ["dynamic", "wifi", "ethernet"] as const;

export const loadStreamAudioRoute = (): StreamAudioRoute =>
  readEnum(STREAM_AUDIO_ROUTE_KEY, STREAM_AUDIO_ROUTES, DEFAULT_STREAM_AUDIO_ROUTE);

export const saveStreamAudioRoute = (route: StreamAudioRoute) => writeString(STREAM_AUDIO_ROUTE_KEY, route);

export const loadNotificationVisibility = (): NotificationVisibility =>
  readRawString(NOTIFICATION_VISIBILITY_KEY) === "all" ? "all" : DEFAULT_NOTIFICATION_VISIBILITY;

export const saveNotificationVisibility = (value: NotificationVisibility) =>
  writeString(NOTIFICATION_VISIBILITY_KEY, value);

export const loadNotificationDurationMs = () =>
  clampNotificationDurationMsInternal(readNumber(NOTIFICATION_DURATION_MS_KEY, DEFAULT_NOTIFICATION_DURATION_MS));

export const saveNotificationDurationMs = (value: number) =>
  writeNumber(NOTIFICATION_DURATION_MS_KEY, clampNotificationDurationMsInternal(value));

export const clampNotificationDurationMs = (value: number) => clampNotificationDurationMsInternal(value);

export const DEFAULT_AUTO_ROTATION_ENABLED = false;
export type ScreenOrientationMode = "portrait" | "landscape" | "auto";
export const DEFAULT_SCREEN_ORIENTATION_MODE: ScreenOrientationMode = "portrait";
export const DEFAULT_ENABLE_SWIPE_NAVIGATION = false;
const normalizeScreenOrientationMode = (value: unknown): ScreenOrientationMode =>
  value === "landscape" || value === "auto" ? value : DEFAULT_SCREEN_ORIENTATION_MODE;

export const loadScreenOrientationMode = (): ScreenOrientationMode => {
  if (typeof localStorage === "undefined") return DEFAULT_SCREEN_ORIENTATION_MODE;
  const raw = localStorage.getItem(SCREEN_ORIENTATION_MODE_KEY);
  if (raw !== null) return normalizeScreenOrientationMode(raw);
  return readBoolean(AUTO_ROTATION_ENABLED_KEY, DEFAULT_AUTO_ROTATION_ENABLED)
    ? "auto"
    : DEFAULT_SCREEN_ORIENTATION_MODE;
};

export const saveScreenOrientationMode = (mode: ScreenOrientationMode) => {
  if (typeof localStorage === "undefined") return;
  const normalized = normalizeScreenOrientationMode(mode);
  localStorage.setItem(SCREEN_ORIENTATION_MODE_KEY, normalized);
  localStorage.setItem(AUTO_ROTATION_ENABLED_KEY, normalized === "auto" ? "1" : "0");
  broadcast(SCREEN_ORIENTATION_MODE_KEY, normalized);
  broadcast(AUTO_ROTATION_ENABLED_KEY, normalized === "auto");
};

export const loadAutoRotationEnabled = () => loadScreenOrientationMode() === "auto";

export const saveAutoRotationEnabled = (enabled: boolean) => {
  saveScreenOrientationMode(enabled ? "auto" : DEFAULT_SCREEN_ORIENTATION_MODE);
};

export const loadEnableSwipeNavigation = () =>
  readBoolean(ENABLE_SWIPE_NAVIGATION_KEY, DEFAULT_ENABLE_SWIPE_NAVIGATION);

export const saveEnableSwipeNavigation = (enabled: boolean) => writeBoolean(ENABLE_SWIPE_NAVIGATION_KEY, enabled);

/**
 * SID Radio master flag (spec §0.4, `sidRadioEnabled`). **GA: on by default.**
 * (During rollout this was off so the app was byte-for-byte unchanged; it is now
 * a shipped feature — the similarity bundle loads and the `md5PathIndex` builds
 * on the songlengths finalize hook.)
 */
export const DEFAULT_SID_RADIO_ENABLED = true;

export const loadSidRadioEnabled = () => readBoolean(SID_RADIO_ENABLED_KEY, DEFAULT_SID_RADIO_ENABLED);

export const saveSidRadioEnabled = (enabled: boolean) => writeBoolean(SID_RADIO_ENABLED_KEY, enabled);

/**
 * The ambient ♥/✕ ranking affordance (spec §0.4, `sidRankingEnabled`). **GA: on
 * by default**, and per §0.4 it follows the master `sidRadioEnabled` — the
 * affordance shows only when both are on.
 */
export const DEFAULT_SID_RANKING_ENABLED = true;

export const loadSidRankingEnabled = () => readBoolean(SID_RANKING_ENABLED_KEY, DEFAULT_SID_RANKING_ENABLED);

export const saveSidRankingEnabled = (enabled: boolean) => writeBoolean(SID_RANKING_ENABLED_KEY, enabled);

/**
 * Playback engine (spec §12.5, Track B). `"c64"` plays on the Ultimate and
 * mirrors the audio back over Live View (the app's identity — always works);
 * `"local"` renders the SID on-device with the libsidplayfp WASM engine, no C64
 * required. Defaults **`c64`**; the Local engine is opt-in during rollout, so
 * with the default the playback path is byte-for-byte unchanged.
 */
export type PlaybackEngine = "c64" | "local";

export const DEFAULT_PLAYBACK_ENGINE: PlaybackEngine = "c64";

export const loadPlaybackEngine = (): PlaybackEngine =>
  readRawString(PLAYBACK_ENGINE_KEY) === "local" ? "local" : DEFAULT_PLAYBACK_ENGINE;

export const savePlaybackEngine = (engine: PlaybackEngine) => writeString(PLAYBACK_ENGINE_KEY, engine);

/**
 * Which SID emulation the on-device engine uses (Track B).
 *
 * The vendored WASM ships both, side by side: `reSIDfp` is libsidplayfp's
 * cycle-accurate analogue model, `SIDLite` a lightweight approximation derived
 * from cRSID. They are not close substitutes — measured on a Pixel 4 against a
 * real C64 Ultimate (docs/plans/sid-station/AUDIO-FIDELITY-TEST.md):
 *
 *   reSIDfp   envelope correlation 0.55 vs hardware, ~715 ms/sec p99 to render
 *   SIDLite   audibly not a C64 (DC offset, wrong timbre), ~69 ms/sec
 *
 * So this is a fidelity-for-CPU dial worth ~5.5x. The default is per-variant —
 * see DEFAULT_SID_EMULATION_ENGINE.
 */
export type SidEmulationEngine = "residfp" | "sidlite";

/**
 * Variant-driven, so a device that genuinely cannot afford the accurate engine
 * can default to the cheap one — but **every** variant currently defaults to
 * reSIDfp, on purpose.
 *
 * Measured like-for-like on identical tunes: reSIDfp runs at 4.3x realtime
 * (~39% of one core on a Pixel 4, zero underruns) and SIDLite at 23.8x. The
 * cheap engine is tempting for the keypad variant, which targets a low-power
 * keypad handset — but that device is unreleased and cannot be measured.
 * Defaulting it to SIDLite on a spec-sheet projection would ship an audible
 * quality regression on the hardware that exists to protect hardware that does
 * not. Sounding like a C64 is the point of playing a SID.
 *
 * When such a handset ships, measure it (gate L1) and flip
 * `default_sid_emulation_engine` in variants.yaml if it cannot hold realtime.
 */
export const DEFAULT_SID_EMULATION_ENGINE: SidEmulationEngine =
  // Compared as a plain string: the generated variant narrows this to whichever
  // literal the ACTIVE variant declares, so a direct comparison against the other
  // value is a type error whenever every variant happens to agree.
  (variant.runtime.defaultSidEmulationEngine as string) === "sidlite" ? "sidlite" : "residfp";

/**
 * Read the C64's KERNAL and BASIC from the machine you are connected to, without being asked.
 *
 * On by default, because the alternative is worse than the permission question it avoids: the images
 * cannot be shipped, the accurate engine cannot render a single tune without them, and nothing else
 * fetches them — so a fresh install that chose "listen on this device" simply produced silence.
 *
 * The obligation this carries has not gone away: only connect to machines you own or are permitted
 * to use. It is stated at the control in Settings, where it can also be turned off.
 */
/**
 * Shortest tune SID Radio will play, in seconds.
 *
 * HVSC is not only music. It carries jingles, one-shot sound effects and test tones, and a station
 * that serves them between tunes reads as broken rather than eclectic. Fifteen seconds is comfortably
 * longer than an effect and comfortably shorter than anything anyone would call a piece.
 *
 * The filter has a cost worth naming: it removes candidates the similarity walk had already found,
 * and if enough of a neighbourhood goes, the station can look exhausted while the graph around it is
 * untouched. That is why the engine takes this as an admission predicate and keeps widening its walk
 * until enough of the RIGHT tracks are in reach, rather than filtering after the fact.
 *
 * 0 disables it.
 */
export const DEFAULT_SID_RADIO_MIN_SECONDS = 15;
export const MAX_SID_RADIO_MIN_SECONDS = 600;

export const loadSidRadioMinSeconds = () => {
  const raw = readNumber(SID_RADIO_MIN_SECONDS_KEY, DEFAULT_SID_RADIO_MIN_SECONDS);
  if (Number.isNaN(raw)) return DEFAULT_SID_RADIO_MIN_SECONDS;
  return Math.min(MAX_SID_RADIO_MIN_SECONDS, Math.max(0, Math.round(raw)));
};

export const saveSidRadioMinSeconds = (seconds: number) =>
  writeNumber(SID_RADIO_MIN_SECONDS_KEY, Math.min(MAX_SID_RADIO_MIN_SECONDS, Math.max(0, Math.round(seconds))));

/**
 * Show SID tunes under a readable name rather than their file name.
 *
 * On by default. A SID's file name is a sanitised form of the tune's real title — separators stand
 * in for spaces, and the chip count is appended as a marker — so rendering it verbatim shows the
 * user an encoding rather than a name. Only SIDs are affected: a PRG, a CRT or a disk image is a
 * file the user put somewhere and named, and the app has no convention to read into it.
 *
 * Turning this off restores the file name exactly as earlier releases drew it, badge included, for
 * anyone who matches what is on screen against what is on disk.
 */
export const DEFAULT_FRIENDLY_SID_NAMES = true;

export const loadFriendlySidNames = () => readBoolean(FRIENDLY_SID_NAMES_KEY, DEFAULT_FRIENDLY_SID_NAMES);

export const saveFriendlySidNames = (enabled: boolean) => writeBoolean(FRIENDLY_SID_NAMES_KEY, enabled);

export const DEFAULT_LOCAL_ENGINE_AUTO_ROMS = true;

export const loadLocalEngineAutoRoms = () => readBoolean(LOCAL_ENGINE_AUTO_ROMS_KEY, DEFAULT_LOCAL_ENGINE_AUTO_ROMS);

export const saveLocalEngineAutoRoms = (enabled: boolean) => writeBoolean(LOCAL_ENGINE_AUTO_ROMS_KEY, enabled);

/**
 * The emulation to actually instantiate, given whether the ROMs are in hand.
 *
 * The substitution below is kept, but the reason once given for it was wrong and is corrected here
 * so nobody builds on it again. SIDLite does **not** carry its own kernal-free playback. It is a SID
 * *chip* model — four files, ADSR/Filter/SID/WavGen — plugged into libsidplayfp's own C64, with no
 * CPU, no memory map and no ROM substitute of any kind. Standalone cRSID does have one
 * (`cRSID_setROMcontent` fills $A000-$FFFF with RTS), but that code was never taken into
 * libsidplayfp; the two WASM builds differ by a single compiler flag.
 *
 * Measured over 450 tunes on libsidplayfp-wasm 1.0.1, in every combination of engine and ROM state:
 * the tunes that need ROMs are the *same tunes* on both engines (SIDLite 97, reSIDfp 98, intersection
 * 97). Needing ROMs is a property of the tune, not of the engine.
 *
 * It used to return SIDLite whenever the images were missing — cheaper, but a different SID model,
 * so a listener whose ROM capture had not succeeded got a different timbre and was never told why.
 * Since needing the images is a property of the tune rather than of the engine, the ROM state says
 * nothing about which chip model to use, and the preference is now honoured either way.
 *
 * `romsAvailable` is kept in the signature: callers pass what they know, and it documents at every
 * call site that the question was considered. It no longer changes the answer.
 */
export const effectiveSidEmulationEngine = (_romsAvailable: boolean): SidEmulationEngine => loadSidEmulationEngine();

export const loadSidEmulationEngine = (): SidEmulationEngine =>
  readRawString(SID_EMULATION_ENGINE_KEY) === "sidlite" ? "sidlite" : DEFAULT_SID_EMULATION_ENGINE;

export const saveSidEmulationEngine = (engine: SidEmulationEngine) => writeString(SID_EMULATION_ENGINE_KEY, engine);

/**
 * A SID revision, as the two chips are universally named. The engine models exactly these two.
 */
export type LocalSidModel = "6581" | "8580";

export const LOCAL_SID_MODELS: readonly LocalSidModel[] = ["6581", "8580"];

const normalizeLocalSidModel = (value: unknown): LocalSidModel | null =>
  value === "6581" || value === "8580" ? value : null;

/**
 * Which chip the on-device engine assumes for a tune that does not name one.
 *
 * This is *only* a fallback. A SID file may declare in its header which revision it was written
 * for, and libsidplayfp plays it on that chip whichever way this is set — per chip, so a 2SID or
 * 3SID file gets each of its chips right. The setting is consulted where the header says
 * `UNKNOWN` or `ANY`, which is a large part of HVSC.
 *
 * 8580 by default, which is what libsidplayfp itself assumes, so an installation that has never
 * reached a C64 and has never touched this sounds exactly as earlier releases did.
 */
export const DEFAULT_LOCAL_SID_MODEL: LocalSidModel = "8580";

export const loadLocalSidModel = (): LocalSidModel =>
  normalizeLocalSidModel(readRawString(LOCAL_SID_MODEL_KEY)) ?? DEFAULT_LOCAL_SID_MODEL;

export const saveLocalSidModel = (model: LocalSidModel) => writeString(LOCAL_SID_MODEL_KEY, model);

/**
 * Take the fallback chip from the Ultimate the app is connected to, when it has one.
 *
 * On by default: the listener's own machine is the best available answer to "which SID should a
 * tune that does not say be played on", and it costs the user nothing to arrive at.
 */
export const DEFAULT_LOCAL_SID_MODEL_FROM_DEVICE = true;

export const loadLocalSidModelFromDevice = () =>
  readBoolean(LOCAL_SID_MODEL_FROM_DEVICE_KEY, DEFAULT_LOCAL_SID_MODEL_FROM_DEVICE);

export const saveLocalSidModelFromDevice = (enabled: boolean) => writeBoolean(LOCAL_SID_MODEL_FROM_DEVICE_KEY, enabled);

/**
 * The last chip actually read from a connected Ultimate.
 *
 * Persisted rather than held in memory because the point of learning it is that it keeps applying
 * when the machine is off, on the train, or on a different network. Nothing re-probes to render a
 * tune, so a device that cannot be reached costs playback no time at all.
 */
export const loadLearnedDeviceSidModel = (): LocalSidModel | null =>
  normalizeLocalSidModel(readRawString(LEARNED_DEVICE_SID_MODEL_KEY));

export const saveLearnedDeviceSidModel = (model: LocalSidModel | null) => {
  if (typeof localStorage === "undefined") return;
  if (model === null) localStorage.removeItem(LEARNED_DEVICE_SID_MODEL_KEY);
  else localStorage.setItem(LEARNED_DEVICE_SID_MODEL_KEY, model);
  broadcast(LEARNED_DEVICE_SID_MODEL_KEY, model);
};

/**
 * The chip the on-device engine should fall back to right now.
 *
 * A pure read of what is already stored — it never talks to the device, so a machine that is off
 * or unreachable neither blocks nor delays a tune. The learned value only participates while the
 * "take it from my C64" setting is on and something has actually been learned; otherwise the
 * user's explicit choice stands.
 */
export const resolveLocalSidModel = (): LocalSidModel => {
  if (!loadLocalSidModelFromDevice()) return loadLocalSidModel();
  return loadLearnedDeviceSidModel() ?? loadLocalSidModel();
};

/**
 * Crossfade length for on-device playback, in milliseconds. `0` (the default)
 * means a hard cut: the outgoing tune is silenced before the next one starts.
 *
 * The default is deliberately off. A switchover must *always* begin from
 * silence unless the listener has explicitly asked for a crossfade,
 * because anything else is indistinguishable from the bug where two tunes play
 * at once. Turning this on is that explicit request, and it is bounded so the
 * overlap stays a deliberate musical effect rather than an ambiguous smear.
 */
export const CROSSFADE_MS_MIN = 0;
/**
 * The longest crossfade offered, in milliseconds.
 *
 * Music players commonly allow much more than this — Spotify and Apple Music both go to twelve
 * seconds — but a longer blend is not better here. Two tunes audible together for several seconds
 * stop sounding like a transition and start sounding like two tunes playing at once, and SID tunes
 * are often short loops where four seconds is already a noticeable fraction of the piece. It also
 * bounds the work: the outgoing tune's last seconds are held in memory for the whole blend, and the
 * incoming tune's opening has to be rendered ahead of it.
 */
export const CROSSFADE_MS_MAX = 4000;
export const DEFAULT_PLAYBACK_CROSSFADE_MS = 0;

export const loadPlaybackCrossfadeMs = (): number => {
  const raw = readRawString(PLAYBACK_CROSSFADE_MS_KEY);
  if (raw === null) return DEFAULT_PLAYBACK_CROSSFADE_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PLAYBACK_CROSSFADE_MS;
  return Math.min(CROSSFADE_MS_MAX, Math.max(CROSSFADE_MS_MIN, parsed));
};

export const savePlaybackCrossfadeMs = (ms: number) =>
  writeNumber(PLAYBACK_CROSSFADE_MS_KEY, Math.min(CROSSFADE_MS_MAX, Math.max(CROSSFADE_MS_MIN, Math.round(ms))));

/**
 * Local-engine gate (Track B). **GA: on by default** — the Play-page "Play on:
 * C64 / This device" choice is offered for SID items. The default *engine* is
 * still `c64` ([[DEFAULT_PLAYBACK_ENGINE]]), so playback stays on the Ultimate
 * until the user explicitly picks "This device"; this flag only surfaces the
 * choice. Independent of `sidRadioEnabled`.
 */
export const DEFAULT_LOCAL_ENGINE_ENABLED = true;

export const loadLocalEngineEnabled = () => readBoolean(LOCAL_ENGINE_ENABLED_KEY, DEFAULT_LOCAL_ENGINE_ENABLED);

export const saveLocalEngineEnabled = (enabled: boolean) => writeBoolean(LOCAL_ENGINE_ENABLED_KEY, enabled);

const loadString = (key: string) => readRawString(key) ?? "";

export const loadArchiveHostOverride = () => loadString(ARCHIVE_HOST_OVERRIDE_KEY);

export const saveArchiveHostOverride = (value: string) => writeString(ARCHIVE_HOST_OVERRIDE_KEY, value);

export const loadArchiveClientIdOverride = () => loadString(ARCHIVE_CLIENT_ID_OVERRIDE_KEY);

export const saveArchiveClientIdOverride = (value: string) => writeString(ARCHIVE_CLIENT_ID_OVERRIDE_KEY, value);

export const loadArchiveUserAgentOverride = () => loadString(ARCHIVE_USER_AGENT_OVERRIDE_KEY);

export const saveArchiveUserAgentOverride = (value: string) => writeString(ARCHIVE_USER_AGENT_OVERRIDE_KEY, value);

export const APP_SETTINGS_KEYS = {
  DEBUG_LOGGING_KEY,
  CONFIG_WRITE_INTERVAL_KEY,
  DEMO_MODE_ENABLED_KEY,
  AUTO_DEMO_MODE_KEY: DEMO_MODE_ENABLED_KEY,
  STARTUP_DISCOVERY_WINDOW_MS_KEY,
  BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY,
  DISCOVERY_PROBE_TIMEOUT_MS_KEY,
  DISK_AUTOSTART_MODE_KEY,
  VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY,
  NOTIFICATION_VISIBILITY_KEY,
  NOTIFICATION_DURATION_MS_KEY,
  AUTO_ROTATION_ENABLED_KEY,
  SCREEN_ORIENTATION_MODE_KEY,
  ENABLE_SWIPE_NAVIGATION_KEY,
  ARCHIVE_HOST_OVERRIDE_KEY,
  ARCHIVE_CLIENT_ID_OVERRIDE_KEY,
  ARCHIVE_USER_AGENT_OVERRIDE_KEY,
  HIDE_STATUS_BAR_KEY,
  HIDE_NAVIGATION_BAR_KEY,
  SID_RADIO_ENABLED_KEY,
  SID_RANKING_ENABLED_KEY,
  PLAYBACK_ENGINE_KEY,
  LOCAL_ENGINE_ENABLED_KEY,
  FRIENDLY_SID_NAMES_KEY,
  LOCAL_SID_MODEL_KEY,
  LOCAL_SID_MODEL_FROM_DEVICE_KEY,
  LEARNED_DEVICE_SID_MODEL_KEY,
  STREAM_VIDEO_BADGES_KEY,
  VIC_PALETTE_KEY,
  PALETTE_TARGET_KEY,
  PERSIST_CONFIG_TO_FLASH_KEY,
};

/**
 * Which VIC palette the app paints Live View frames with.
 *
 * Stored as a `.vpl` id from `src/assets/palettes`. Validation lives with the palette table rather
 * than here, so an id from an older build (or a palette that has since been removed) falls back to
 * the default instead of painting from an empty table.
 */
export const loadVicPaletteId = (): string => readRawString(VIC_PALETTE_KEY) ?? "device";

export const saveVicPaletteId = (id: string) => writeString(VIC_PALETTE_KEY, id);

/**
 * Which screens a palette choice lands on: this app, the C64, or both.
 *
 * Remembered rather than re-asked, the same way the "Listen on" choice is remembered for playback.
 * Someone who has decided they want colour changes to reach the television has decided it for every
 * palette they try, not just the first one.
 *
 * The default is `local` because it is the only option that cannot touch the machine: a first tap
 * changes the phone's picture and nothing else, and reaching the C64 stays a deliberate act.
 */
export type PaletteTarget = "local" | "remote" | "both";
export const DEFAULT_PALETTE_TARGET: PaletteTarget = "local";
const PALETTE_TARGETS: PaletteTarget[] = ["local", "remote", "both"];

export const loadPaletteTarget = (): PaletteTarget =>
  readEnum(PALETTE_TARGET_KEY, PALETTE_TARGETS, DEFAULT_PALETTE_TARGET);

export const savePaletteTarget = (target: PaletteTarget) => writeString(PALETTE_TARGET_KEY, target);

/**
 * Whether device settings changed from the app are written to the machine's flash.
 *
 * OFF by default, which means a change applies immediately but the machine's next power-up brings
 * back what was there before. A phone invites experimenting with settings, and an experiment that
 * a power cycle undoes is one nobody has to undo by hand.
 *
 * Turning it on is a real commitment — it is easy to persist something that leaves the machine
 * hard to use — so the Settings copy has to say so, and has to say how to get back: hold RESTORE
 * while powering the machine on. The firmware reads `U64_RESTORE_REG` at boot and starts in safe
 * mode, loading defaults instead of the stored config (`components/config.cc:47-62`, and the store
 * read at `:182`). That is a recovery boot rather than an erase — flash still holds the old values
 * until they are saved over.
 */
export const loadPersistConfigToFlash = () => readBoolean(PERSIST_CONFIG_TO_FLASH_KEY, false);

export const savePersistConfigToFlash = (enabled: boolean) => writeBoolean(PERSIST_CONFIG_TO_FLASH_KEY, enabled);
