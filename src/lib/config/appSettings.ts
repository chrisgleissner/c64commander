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
const STREAM_AUDIO_ROUTE_KEY = "c64u_stream_audio_route";
const VIC_PALETTE_KEY = "c64u_vic_palette";

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

export const loadDebugLoggingEnabled = () => readBoolean(DEBUG_LOGGING_KEY, false);

export const saveDebugLoggingEnabled = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DEBUG_LOGGING_KEY, enabled ? "1" : "0");
  broadcast(DEBUG_LOGGING_KEY, enabled);
};

/**
 * Full-screen (immersive) defaults come from the active build variant
 * (`variant.runtime.defaultHide*`), so a keypad-first appliance variant can ship
 * full-screen by default while the standard app does not. A user toggle in
 * Settings persists and overrides the variant default.
 */
export const DEFAULT_HIDE_STATUS_BAR = Boolean(variant.runtime.defaultHideStatusBar);
export const DEFAULT_HIDE_NAVIGATION_BAR = Boolean(variant.runtime.defaultHideNavigationBar);

export const loadHideStatusBar = () => readBoolean(HIDE_STATUS_BAR_KEY, DEFAULT_HIDE_STATUS_BAR);

export const saveHideStatusBar = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(HIDE_STATUS_BAR_KEY, enabled ? "1" : "0");
  broadcast(HIDE_STATUS_BAR_KEY, enabled);
};

export const loadHideNavigationBar = () => readBoolean(HIDE_NAVIGATION_BAR_KEY, DEFAULT_HIDE_NAVIGATION_BAR);

export const saveHideNavigationBar = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(HIDE_NAVIGATION_BAR_KEY, enabled ? "1" : "0");
  broadcast(HIDE_NAVIGATION_BAR_KEY, enabled);
};

export const loadConfigWriteIntervalMs = () =>
  clampInterval(readNumber(CONFIG_WRITE_INTERVAL_KEY, DEFAULT_CONFIG_WRITE_INTERVAL_MS));

export const saveConfigWriteIntervalMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampInterval(value);
  localStorage.setItem(CONFIG_WRITE_INTERVAL_KEY, String(clamped));
  broadcast(CONFIG_WRITE_INTERVAL_KEY, clamped);
};

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

export const saveStartupDiscoveryWindowMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampDiscoveryWindowMs(value);
  localStorage.setItem(STARTUP_DISCOVERY_WINDOW_MS_KEY, String(clamped));
  broadcast(STARTUP_DISCOVERY_WINDOW_MS_KEY, clamped);
};

export const clampStartupDiscoveryWindowMs = (value: number) => clampDiscoveryWindowMs(value);

export const loadBackgroundRediscoveryIntervalMs = () =>
  clampBackgroundRediscoveryIntervalMsInternal(
    readNumber(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS),
  );

export const saveBackgroundRediscoveryIntervalMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampBackgroundRediscoveryIntervalMsInternal(value);
  localStorage.setItem(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, String(clamped));
  broadcast(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, clamped);
};

export const clampBackgroundRediscoveryIntervalMs = (value: number) =>
  clampBackgroundRediscoveryIntervalMsInternal(value);

export const loadDiscoveryProbeTimeoutMs = () =>
  clampDiscoveryProbeTimeoutMsInternal(readNumber(DISCOVERY_PROBE_TIMEOUT_MS_KEY, DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS));

export const saveDiscoveryProbeTimeoutMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampDiscoveryProbeTimeoutMsInternal(value);
  localStorage.setItem(DISCOVERY_PROBE_TIMEOUT_MS_KEY, String(clamped));
  broadcast(DISCOVERY_PROBE_TIMEOUT_MS_KEY, clamped);
};

export const clampDiscoveryProbeTimeoutMs = (value: number) => clampDiscoveryProbeTimeoutMsInternal(value);

export const loadDiskAutostartMode = () => {
  if (typeof localStorage === "undefined") return DEFAULT_DISK_AUTOSTART_MODE;
  const raw = localStorage.getItem(DISK_AUTOSTART_MODE_KEY);
  return normalizeDiskAutostartMode(raw ?? DEFAULT_DISK_AUTOSTART_MODE);
};

export const saveDiskAutostartMode = (mode: DiskAutostartMode) => {
  if (typeof localStorage === "undefined") return;
  const normalized = normalizeDiskAutostartMode(mode);
  localStorage.setItem(DISK_AUTOSTART_MODE_KEY, normalized);
  broadcast(DISK_AUTOSTART_MODE_KEY, normalized);
};

export const loadVolumeSliderPreviewIntervalMs = () =>
  clampVolumeSliderPreviewIntervalMsInternal(
    readNumber(VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY, DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS),
  );

export const saveVolumeSliderPreviewIntervalMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampVolumeSliderPreviewIntervalMsInternal(value);
  localStorage.setItem(VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY, String(clamped));
  broadcast(VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY, clamped);
};

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

export const saveBootMenuAnswerEnabled = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(BOOT_MENU_ANSWER_ENABLED_KEY, enabled ? "1" : "0");
  broadcast(BOOT_MENU_ANSWER_ENABLED_KEY, enabled);
};

export const loadBootMenuKey = (): BootMenuKey => {
  if (typeof localStorage === "undefined") return DEFAULT_BOOT_MENU_KEY;
  return normalizeBootMenuKey(localStorage.getItem(BOOT_MENU_KEY_KEY));
};

export const saveBootMenuKey = (value: BootMenuKey) => {
  if (typeof localStorage === "undefined") return;
  const normalized = normalizeBootMenuKey(value);
  localStorage.setItem(BOOT_MENU_KEY_KEY, normalized);
  broadcast(BOOT_MENU_KEY_KEY, normalized);
};

export const loadBootSettleMs = () => clampBootSettleMsInternal(readNumber(BOOT_SETTLE_MS_KEY, DEFAULT_BOOT_SETTLE_MS));

export const saveBootSettleMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampBootSettleMsInternal(value);
  localStorage.setItem(BOOT_SETTLE_MS_KEY, String(clamped));
  broadcast(BOOT_SETTLE_MS_KEY, clamped);
};

export const clampBootSettleMs = (value: number) => clampBootSettleMsInternal(value);

// In-image search (Content Explorer capability C): whether media search descends
// into disk images. Off by default (today's top-level-only behaviour).
export const DEFAULT_SEARCH_INSIDE_DISKS = false;

export const loadSearchInsideDisks = () => readBoolean(SEARCH_INSIDE_DISKS_KEY, DEFAULT_SEARCH_INSIDE_DISKS);

export const saveSearchInsideDisks = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SEARCH_INSIDE_DISKS_KEY, enabled ? "1" : "0");
  broadcast(SEARCH_INSIDE_DISKS_KEY, enabled);
};

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

export const saveStreamVideoPort = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampPort(value, DEFAULT_STREAM_VIDEO_PORT);
  localStorage.setItem(STREAM_VIDEO_PORT_KEY, String(clamped));
  broadcast(STREAM_VIDEO_PORT_KEY, clamped);
};

export const loadStreamAudioPort = () =>
  clampPort(readNumber(STREAM_AUDIO_PORT_KEY, DEFAULT_STREAM_AUDIO_PORT), DEFAULT_STREAM_AUDIO_PORT);

export const saveStreamAudioPort = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampPort(value, DEFAULT_STREAM_AUDIO_PORT);
  localStorage.setItem(STREAM_AUDIO_PORT_KEY, String(clamped));
  broadcast(STREAM_AUDIO_PORT_KEY, clamped);
};

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

export const saveStreamNetworkBufferMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampNetworkBufferMs(value);
  localStorage.setItem(STREAM_NETWORK_BUFFER_MS_KEY, String(clamped));
  broadcast(STREAM_NETWORK_BUFFER_MS_KEY, clamped);
};

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

export const saveStreamNativeVideoAssembly = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STREAM_NATIVE_VIDEO_ASSEMBLY_KEY, enabled ? "1" : "0");
  broadcast(STREAM_NATIVE_VIDEO_ASSEMBLY_KEY, enabled);
};

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
export const DEFAULT_STREAM_NATIVE_AUDIO = true;

export const loadStreamNativeAudio = () => readBoolean(STREAM_NATIVE_AUDIO_KEY, DEFAULT_STREAM_NATIVE_AUDIO);

export const saveStreamNativeAudio = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STREAM_NATIVE_AUDIO_KEY, enabled ? "1" : "0");
  broadcast(STREAM_NATIVE_AUDIO_KEY, enabled);
};

/**
 * Live View video frame-rate mode (spec §11.1). A user *maximum*: `auto` tries full source cadence
 * and lets the governor back it off under pressure; `100`/`50`/`25` cap the presented rate to
 * every / every-2nd / every-4th source frame. The governor may still demote below a manual cap to
 * protect audio (§11.2). Default `auto`.
 */
export type StreamVideoFrameRateMode = "auto" | "100" | "50" | "25";
export const DEFAULT_STREAM_VIDEO_FRAME_RATE_MODE: StreamVideoFrameRateMode = "auto";
const FRAME_RATE_MODES: readonly StreamVideoFrameRateMode[] = ["auto", "100", "50", "25"] as const;

export const loadStreamVideoFrameRateMode = (): StreamVideoFrameRateMode => {
  if (typeof localStorage === "undefined") return DEFAULT_STREAM_VIDEO_FRAME_RATE_MODE;
  const raw = localStorage.getItem(STREAM_VIDEO_FRAME_RATE_MODE_KEY);
  return FRAME_RATE_MODES.includes(raw as StreamVideoFrameRateMode)
    ? (raw as StreamVideoFrameRateMode)
    : DEFAULT_STREAM_VIDEO_FRAME_RATE_MODE;
};

export const saveStreamVideoFrameRateMode = (mode: StreamVideoFrameRateMode) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STREAM_VIDEO_FRAME_RATE_MODE_KEY, mode);
  broadcast(STREAM_VIDEO_FRAME_RATE_MODE_KEY, mode);
};

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

export const saveStreamInputPriority = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STREAM_INPUT_PRIORITY_KEY, enabled ? "1" : "0");
  broadcast(STREAM_INPUT_PRIORITY_KEY, enabled);
};

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

export const loadStreamAudioRoute = (): StreamAudioRoute => {
  if (typeof localStorage === "undefined") return DEFAULT_STREAM_AUDIO_ROUTE;
  const raw = localStorage.getItem(STREAM_AUDIO_ROUTE_KEY);
  return STREAM_AUDIO_ROUTES.includes(raw as StreamAudioRoute) ? (raw as StreamAudioRoute) : DEFAULT_STREAM_AUDIO_ROUTE;
};

export const saveStreamAudioRoute = (route: StreamAudioRoute) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STREAM_AUDIO_ROUTE_KEY, route);
  broadcast(STREAM_AUDIO_ROUTE_KEY, route);
};

export const loadNotificationVisibility = (): NotificationVisibility => {
  if (typeof localStorage === "undefined") return DEFAULT_NOTIFICATION_VISIBILITY;
  const raw = localStorage.getItem(NOTIFICATION_VISIBILITY_KEY);
  return raw === "all" ? "all" : DEFAULT_NOTIFICATION_VISIBILITY;
};

export const saveNotificationVisibility = (value: NotificationVisibility) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(NOTIFICATION_VISIBILITY_KEY, value);
  broadcast(NOTIFICATION_VISIBILITY_KEY, value);
};

export const loadNotificationDurationMs = () =>
  clampNotificationDurationMsInternal(readNumber(NOTIFICATION_DURATION_MS_KEY, DEFAULT_NOTIFICATION_DURATION_MS));

export const saveNotificationDurationMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampNotificationDurationMsInternal(value);
  localStorage.setItem(NOTIFICATION_DURATION_MS_KEY, String(clamped));
  broadcast(NOTIFICATION_DURATION_MS_KEY, clamped);
};

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

export const saveEnableSwipeNavigation = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ENABLE_SWIPE_NAVIGATION_KEY, enabled ? "1" : "0");
  broadcast(ENABLE_SWIPE_NAVIGATION_KEY, enabled);
};

/**
 * SID Radio master flag (spec §0.4, `sidRadioEnabled`). **GA: on by default.**
 * (During rollout this was off so the app was byte-for-byte unchanged; it is now
 * a shipped feature — the similarity bundle loads and the `md5PathIndex` builds
 * on the songlengths finalize hook.)
 */
export const DEFAULT_SID_RADIO_ENABLED = true;

export const loadSidRadioEnabled = () => readBoolean(SID_RADIO_ENABLED_KEY, DEFAULT_SID_RADIO_ENABLED);

export const saveSidRadioEnabled = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SID_RADIO_ENABLED_KEY, enabled ? "1" : "0");
  broadcast(SID_RADIO_ENABLED_KEY, enabled);
};

/**
 * The ambient ♥/✕ ranking affordance (spec §0.4, `sidRankingEnabled`). **GA: on
 * by default**, and per §0.4 it follows the master `sidRadioEnabled` — the
 * affordance shows only when both are on.
 */
export const DEFAULT_SID_RANKING_ENABLED = true;

export const loadSidRankingEnabled = () => readBoolean(SID_RANKING_ENABLED_KEY, DEFAULT_SID_RANKING_ENABLED);

export const saveSidRankingEnabled = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SID_RANKING_ENABLED_KEY, enabled ? "1" : "0");
  broadcast(SID_RANKING_ENABLED_KEY, enabled);
};

/**
 * Playback engine (spec §12.5, Track B). `"c64"` plays on the Ultimate and
 * mirrors the audio back over Live View (the app's identity — always works);
 * `"local"` renders the SID on-device with the libsidplayfp WASM engine, no C64
 * required. Defaults **`c64`**; the Local engine is opt-in during rollout, so
 * with the default the playback path is byte-for-byte unchanged.
 */
export type PlaybackEngine = "c64" | "local";

export const DEFAULT_PLAYBACK_ENGINE: PlaybackEngine = "c64";

export const loadPlaybackEngine = (): PlaybackEngine => {
  if (typeof localStorage === "undefined") return DEFAULT_PLAYBACK_ENGINE;
  return localStorage.getItem(PLAYBACK_ENGINE_KEY) === "local" ? "local" : DEFAULT_PLAYBACK_ENGINE;
};

export const savePlaybackEngine = (engine: PlaybackEngine) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PLAYBACK_ENGINE_KEY, engine);
  broadcast(PLAYBACK_ENGINE_KEY, engine);
};

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
 * cheap engine is tempting for the keypad variant, which targets the Commodore
 * Callback 8020 — but that device is unreleased and cannot be measured.
 * Defaulting it to SIDLite on a spec-sheet projection would ship an audible
 * quality regression on the hardware that exists to protect hardware that does
 * not. Sounding like a C64 is the point of playing a SID.
 *
 * When the 8020 ships, measure it (gate L1) and flip
 * `default_sid_emulation_engine` in variants.yaml if it cannot hold realtime.
 */
export const DEFAULT_SID_EMULATION_ENGINE: SidEmulationEngine =
  // Compared as a plain string: the generated variant narrows this to whichever
  // literal the ACTIVE variant declares, so a direct comparison against the other
  // value is a type error whenever every variant happens to agree.
  (variant.runtime.defaultSidEmulationEngine as string) === "sidlite" ? "sidlite" : "residfp";

export const loadSidEmulationEngine = (): SidEmulationEngine => {
  if (typeof localStorage === "undefined") return DEFAULT_SID_EMULATION_ENGINE;
  return localStorage.getItem(SID_EMULATION_ENGINE_KEY) === "sidlite" ? "sidlite" : DEFAULT_SID_EMULATION_ENGINE;
};

export const saveSidEmulationEngine = (engine: SidEmulationEngine) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SID_EMULATION_ENGINE_KEY, engine);
  broadcast(SID_EMULATION_ENGINE_KEY, engine);
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
export const CROSSFADE_MS_MAX = 5000;
export const DEFAULT_PLAYBACK_CROSSFADE_MS = 0;

export const loadPlaybackCrossfadeMs = (): number => {
  if (typeof localStorage === "undefined") return DEFAULT_PLAYBACK_CROSSFADE_MS;
  const raw = localStorage.getItem(PLAYBACK_CROSSFADE_MS_KEY);
  if (raw === null) return DEFAULT_PLAYBACK_CROSSFADE_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PLAYBACK_CROSSFADE_MS;
  return Math.min(CROSSFADE_MS_MAX, Math.max(CROSSFADE_MS_MIN, parsed));
};

export const savePlaybackCrossfadeMs = (ms: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = Math.min(CROSSFADE_MS_MAX, Math.max(CROSSFADE_MS_MIN, Math.round(ms)));
  localStorage.setItem(PLAYBACK_CROSSFADE_MS_KEY, String(clamped));
  broadcast(PLAYBACK_CROSSFADE_MS_KEY, clamped);
};

/**
 * Local-engine gate (Track B). **GA: on by default** — the Play-page "Play on:
 * C64 / This device" choice is offered for SID items. The default *engine* is
 * still `c64` ([[DEFAULT_PLAYBACK_ENGINE]]), so playback stays on the Ultimate
 * until the user explicitly picks "This device"; this flag only surfaces the
 * choice. Independent of `sidRadioEnabled`.
 */
export const DEFAULT_LOCAL_ENGINE_ENABLED = true;

export const loadLocalEngineEnabled = () => readBoolean(LOCAL_ENGINE_ENABLED_KEY, DEFAULT_LOCAL_ENGINE_ENABLED);

export const saveLocalEngineEnabled = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LOCAL_ENGINE_ENABLED_KEY, enabled ? "1" : "0");
  broadcast(LOCAL_ENGINE_ENABLED_KEY, enabled);
};

const loadString = (key: string) => {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(key) ?? "";
};

const saveString = (key: string, value: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, value);
  broadcast(key, value);
};

export const loadArchiveHostOverride = () => loadString(ARCHIVE_HOST_OVERRIDE_KEY);

export const saveArchiveHostOverride = (value: string) => saveString(ARCHIVE_HOST_OVERRIDE_KEY, value);

export const loadArchiveClientIdOverride = () => loadString(ARCHIVE_CLIENT_ID_OVERRIDE_KEY);

export const saveArchiveClientIdOverride = (value: string) => saveString(ARCHIVE_CLIENT_ID_OVERRIDE_KEY, value);

export const loadArchiveUserAgentOverride = () => loadString(ARCHIVE_USER_AGENT_OVERRIDE_KEY);

export const saveArchiveUserAgentOverride = (value: string) => saveString(ARCHIVE_USER_AGENT_OVERRIDE_KEY, value);

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
};

/**
 * Which VIC palette the app paints Live View frames with.
 *
 * Stored as a `.vpl` id from `src/assets/palettes`. Validation lives with the palette table rather
 * than here, so an id from an older build (or a palette that has since been removed) falls back to
 * the default instead of painting from an empty table.
 */
export const loadVicPaletteId = (): string => {
  if (typeof localStorage === "undefined") return "default";
  return localStorage.getItem(VIC_PALETTE_KEY) ?? "default";
};

export const saveVicPaletteId = (id: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(VIC_PALETTE_KEY, id);
  broadcast(VIC_PALETTE_KEY, id);
};
