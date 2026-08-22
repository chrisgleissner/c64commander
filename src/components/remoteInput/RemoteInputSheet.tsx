/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Settings2,
  Joystick,
  Keyboard as KeyboardIcon,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppSheet, AppSheetBody, AppSheetContent, AppSheetHeader, AppSheetTitle } from "@/components/ui/app-surface";
import { cn } from "@/lib/utils";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useRemoteInputCapabilityTier } from "@/hooks/useRemoteInputCapabilityTier";
import { useRemoteInputSession, type RemoteInputOutputMode } from "@/hooks/useRemoteInputSession";
import { useRemoteInputPhysicalKeys } from "@/hooks/useRemoteInputPhysicalKeys";
import { useRemoteInputGameMode } from "@/hooks/useRemoteInputGameMode";
import { useDeviceRotation } from "@/hooks/useDeviceRotation";
import { useAutoHide } from "@/hooks/useAutoHide";
import {
  remoteInputSupportsJoystick,
  REMOTE_INPUT_AUTH_REQUIRED_HINT,
  REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT,
} from "@/lib/remoteInput/capabilityTier";
import {
  DEFAULT_REMOTE_INPUT_CONTROL_SIZE,
  loadRemoteInputControlSize,
  remoteInputControlScale,
  REMOTE_INPUT_CONTROL_SIZE_LABEL,
  saveRemoteInputControlSize,
  stepRemoteInputControlSize,
  type RemoteInputControlSize,
} from "@/lib/remoteInput/remoteInputControlSettings";
import {
  bindingForLayout,
  loadCustomBinding,
  loadJoystickLayout,
  type DeviceRotation,
} from "@/lib/remoteInput/joystickKeyBindings";
import {
  GAME_MODE_JOYSTICK_CHANGE_EVENT,
  loadGameModeJoystick,
  resolveJoystickVisibility,
  type JoystickVisibility,
} from "@/lib/remoteInput/gameModeJoystick";
import { startGameMode } from "@/lib/remoteInput/gameModeLaunch";
import { AUTOFIRE_VISIBILITY_CHANGE_EVENT, loadShowAutofireButton } from "@/lib/remoteInput/autofire";
import { VirtualJoystick } from "@/components/remoteInput/VirtualJoystick";
import { TypeKeyboard } from "@/components/remoteInput/TypeKeyboard";
import { QuickKeysBar } from "@/components/remoteInput/QuickKeysBar";
import { useFeatureFlagValue } from "@/hooks/useFeatureFlags";
import { useAvMirror } from "@/hooks/useAvMirror";
import { AvMirrorControls } from "@/components/streams/AvMirrorControls";
import {
  AvMirrorImmersive,
  CONTROLS_HIDE_MS,
  type AvMirrorImmersiveHandle,
} from "@/components/streams/AvMirrorImmersive";

export type RemoteInputSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** How long a summoned Game Mode overlay waits, with no interaction at all, before it goes. */
const GAME_MODE_CHROME_HIDE_MS = 6000;

const ROTATION_CHOICES: ReadonlyArray<{ label: string; value: DeviceRotation | "auto" }> = [
  { label: "Auto", value: "auto" },
  { label: "0°", value: 0 },
  { label: "90°", value: 90 },
  { label: "270°", value: 270 },
];

/**
 * The "Remote Input" sheet — a second-screen joystick and keyboard for the C64.
 * Thin shell over the tested pure mappings (`@/lib/remoteInput/*`) and the
 * coalesced transport (`useRemoteInputSession`). Controls scale with a persisted
 * size preference; Game Mode strips the sheet to the picture, and keeps or drops the
 * on-screen joystick according to how the game is being played (spec §5.1).
 */
export const RemoteInputSheet = ({ open, onOpenChange }: RemoteInputSheetProps) => {
  const { tier, loading: tierLoading, resolved } = useRemoteInputCapabilityTier(open);
  const session = useRemoteInputSession({ tier });
  const joystickAvailable = remoteInputSupportsJoystick(tier);
  // Lead F3: auth-required needs the same password Type mode's fallback
  // injection would also need, so the generic "Type mode still works" hint
  // is wrong on this tier specifically.
  const joystickUnavailableHint =
    tier === "auth-required" ? REMOTE_INPUT_AUTH_REQUIRED_HINT : REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT;
  // On a compact (small) display the Joystick / Keys / Release All buttons are
  // too wide to share one non-scrolling row, so drop the leading icons on the
  // toggle buttons there (text-only) to reclaim the width.
  const { profile } = useDisplayProfile();
  const isCompactDisplay = profile === "compact";
  const [controlSize, setControlSize] = useState<RemoteInputControlSize>(DEFAULT_REMOTE_INPUT_CONTROL_SIZE);
  const [showAutofire, setShowAutofire] = useState(loadShowAutofireButton);
  const [joystickBinding, setJoystickBinding] = useState(() =>
    bindingForLayout(loadJoystickLayout(), loadCustomBinding()),
  );
  const [joystickSetting, setJoystickSetting] = useState(loadGameModeJoystick);
  const scale = remoteInputControlScale(controlSize);

  // Content Explorer A/V mirror: pair the live screen with driving the machine. The Live View
  // master flag hides the mirror everywhere when off; audio/video pick which feeds are offered.
  const liveViewEnabled = useFeatureFlagValue("live_view_enabled");
  const audioMirrorFlag = useFeatureFlagValue("audio_mirror_enabled");
  const videoMirrorFlag = useFeatureFlagValue("video_mirror_enabled");
  const audioMirrorEnabled = liveViewEnabled && audioMirrorFlag;
  const videoMirrorEnabled = liveViewEnabled && videoMirrorFlag;
  const mirrorEnabled = audioMirrorEnabled || videoMirrorEnabled;
  const mirror = useAvMirror();
  const mirrorRef = useRef<AvMirrorImmersiveHandle>(null);
  const [mirrorAdjust, setMirrorAdjust] = useState(false);
  const showMirrorScreen = videoMirrorEnabled && mirror.video.state !== "off";

  const { deviceRotation, frameRotation, source: rotationSource, pin, clearPin } = useDeviceRotation(open);

  const requestSheetOpen = useCallback(() => onOpenChange(true), [onOpenChange]);
  const { immersive, exitGameMode, releaseLaunchedStreams } = useRemoteInputGameMode({
    open,
    joystickAvailable,
    tierResolved: resolved && !tierLoading,
    outputMode: session.outputMode,
    setOutputMode: session.setOutputMode,
    requestSheetOpen,
    session: mirror.session,
  });

  // `immersive` is what was ASKED for; `gameMode` is what is actually in effect. Every
  // place that strips the sheet keys off the latter, so a request that cannot be honoured
  // — no joystick relay, or Keys mode — leaves the ordinary sheet with its way out intact
  // rather than a stripped header with no control on it.
  const gameMode = joystickAvailable && session.outputMode === "joystick" && immersive;
  // Longer than the mirror's own floating cluster: this is a whole toolbar the user asked
  // for, with Watch, Listen, the orientation control and the way out on it, and it is
  // re-armed by every interaction — so it stays while it is being used.
  const chrome = useAutoHide(GAME_MODE_CHROME_HIDE_MS);
  const quickKeysOverlay = useAutoHide(GAME_MODE_CHROME_HIDE_MS);
  const chromeHidden = gameMode && !chrome.visible;

  // The two facts `auto` and the toolbar contribute, both scoped to ONE Game Mode
  // session. `keyDriven` says a physical key has steered the game since it began;
  // `joystickRequest` is what the user asked for on the toolbar, or `null` if they
  // have not asked. Neither survives leaving Game Mode — see the reset below.
  const [keyDriven, setKeyDriven] = useState(false);
  const [joystickRequest, setJoystickRequest] = useState<JoystickVisibility | null>(null);
  const joystickVisibility = resolveJoystickVisibility({
    setting: joystickSetting,
    keyDriven,
    requested: joystickRequest,
    videoLive: showMirrorScreen,
  });

  useEffect(() => {
    if (gameMode) return;
    // A launch inherits neither: the last game's keys say nothing about how this one
    // is about to be played, and an explicit ask was made about that game.
    setKeyDriven(false);
    setJoystickRequest(null);
  }, [gameMode]);

  // Showing is immediate. Hiding waits, unless the user asked for it: controls that
  // vanish mid-tap would be worse than controls that linger for a moment after the
  // first physical key, and that risk is only there when the app is GUESSING that
  // the hand about to tap them has moved to the keypad.
  const [joystickHidden, setJoystickHidden] = useState(false);
  const hidingWasAskedFor = joystickRequest === "hidden" || joystickSetting === "hidden";
  useEffect(() => {
    if (!gameMode || joystickVisibility === "visible") {
      setJoystickHidden(false);
      return;
    }
    if (hidingWasAskedFor) {
      setJoystickHidden(true);
      return;
    }
    const timer = setTimeout(() => setJoystickHidden(true), CONTROLS_HIDE_MS);
    return () => clearTimeout(timer);
  }, [gameMode, joystickVisibility, hidingWasAskedFor]);
  const showInputControls = !gameMode || !joystickHidden;

  // Rehydrate the persisted preferences when the sheet opens.
  useEffect(() => {
    if (!open) return;
    setControlSize(loadRemoteInputControlSize());
    setShowAutofire(loadShowAutofireButton());
    setJoystickBinding(bindingForLayout(loadJoystickLayout(), loadCustomBinding()));
    setJoystickSetting(loadGameModeJoystick());
  }, [open]);

  // The sheet is mounted for the life of the page, so a Settings change made between two
  // Game Mode launches would otherwise not be read until the next open — and a user who has
  // just asked to keep the on-screen joystick would still lose it.
  useEffect(() => {
    const sync = () => setJoystickSetting(loadGameModeJoystick());
    window.addEventListener(GAME_MODE_JOYSTICK_CHANGE_EVENT, sync);
    return () => window.removeEventListener(GAME_MODE_JOYSTICK_CHANGE_EVENT, sync);
  }, []);

  // Hot-swap the autofire-button visibility if the Settings toggle changes while a session is live.
  useEffect(() => {
    const sync = () => setShowAutofire(loadShowAutofireButton());
    window.addEventListener(AUTOFIRE_VISIBILITY_CHANGE_EVENT, sync);
    return () => window.removeEventListener(AUTOFIRE_VISIBILITY_CHANGE_EVENT, sync);
  }, []);

  // A hidden Autofire button must be a STOPPED autofire. The session owns `autofireEnabled`, so
  // merely un-rendering the toggle would leave the dedicated interval pulsing FIRE with no UI left
  // to turn it off.
  const setAutofireEnabled = session.setAutofireEnabled;
  useEffect(() => {
    if (!showAutofire) setAutofireEnabled(false);
  }, [showAutofire, setAutofireEnabled]);

  const changeSize = useCallback((direction: 1 | -1) => {
    setControlSize((current) => {
      const next = stepRemoteInputControlSize(current, direction);
      saveRemoteInputControlSize(next);
      return next;
    });
  }, []);

  const { handleKeyDown, handleKeyUp, clearHeldKeys } = useRemoteInputPhysicalKeys({
    outputMode: session.outputMode,
    heldJoystickInputs: session.heldJoystickInputs,
    setHeldJoystickInputs: session.setHeldJoystickInputs,
    releaseAllEpoch: session.releaseAllEpoch,
    mirrorRef,
    binding: joystickBinding,
    rotation: deviceRotation,
    onHashKey: gameMode ? quickKeysOverlay.toggle : undefined,
    // The one observation `auto` is allowed to act on: a key that reached the C64 as a
    // joystick input, which nothing but a player driving the game does.
    onJoystickKeyRelayed: () => setKeyDriven(true),
  });

  // Smart default: when the connected device's REST API has no machine:input
  // support (keyboard-only), open straight into Type mode rather than a disabled
  // Joystick tab. Gated on `resolved`, not merely `!tierLoading` — the tier also
  // reads as the default kernal-fallback value before any probe has run AND during
  // a transient connection blip mid-session, and `resolved` distinguishes a genuine
  // probed answer from both.
  useEffect(() => {
    if (open && resolved && !tierLoading && !joystickAvailable && session.outputMode === "joystick") {
      session.setOutputMode("type");
    }
  }, [open, resolved, tierLoading, joystickAvailable, session.outputMode, session.setOutputMode]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        clearHeldKeys();
        session.releaseAll();
        releaseLaunchedStreams();
        chrome.hide();
        quickKeysOverlay.hide();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, session.releaseAll, clearHeldKeys, releaseLaunchedStreams, chrome, quickKeysOverlay],
  );

  const handleOutputModeChange = (mode: RemoteInputOutputMode) => {
    if (mode === "joystick" && !joystickAvailable) return;
    session.setOutputMode(mode);
  };

  // The size stepper scales the JOYSTICK action controls; the Type-tab keyboard
  // sizes itself from the measured available space instead, so this control is
  // joystick-only and hidden in Type mode.
  const sizeStepper = (
    <div className="flex items-center gap-1" data-testid="remote-input-size-stepper">
      <span className="mr-1 text-xs text-muted-foreground">Size</span>
      <Button
        size="icon"
        variant="secondary"
        className="h-8 w-8"
        aria-label="Smaller controls"
        data-testid="remote-input-size-decrease"
        disabled={controlSize === "M"}
        onClick={() => changeSize(-1)}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <span className="w-8 text-center text-sm font-semibold" data-testid="remote-input-size-label">
        {REMOTE_INPUT_CONTROL_SIZE_LABEL[controlSize]}
      </span>
      <Button
        size="icon"
        variant="secondary"
        className="h-8 w-8"
        aria-label="Larger controls"
        data-testid="remote-input-size-increase"
        disabled={controlSize === "XXL"}
        onClick={() => changeSize(1)}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );

  // Per session, not persisted: an orientation pinned for one game should not
  // silently still apply to the next launch weeks later. It is also what makes the
  // orientation behaviour testable, and usable, with no sensor at all.
  const selectedRotation: DeviceRotation | "auto" = rotationSource === "auto" ? "auto" : deviceRotation;
  const rotationOverride = (
    <div
      className="flex items-center gap-1"
      data-testid="remote-input-rotation-override"
      data-rotation={deviceRotation}
      data-source={rotationSource}
    >
      <span className="mr-1 text-xs text-muted-foreground">Orientation</span>
      {ROTATION_CHOICES.map(({ label, value }) => (
        <Button
          key={label}
          size="sm"
          variant={selectedRotation === value ? "default" : "secondary"}
          className="h-8 px-2"
          aria-pressed={selectedRotation === value}
          data-testid={`remote-input-rotation-${value}`}
          onClick={() => (value === "auto" ? clearPin() : pin(value))}
        >
          {label}
        </Button>
      ))}
    </div>
  );

  // "Game mode" is the widest control on the row that also carries the size stepper,
  // and on the 320px-wide compact profile the two no longer share a line. The shorter
  // face is compact-only; the wider profiles keep the full name.
  const gameModeLabel = isCompactDisplay ? "Game" : "Game mode";

  const gameModeAvailable = joystickAvailable && session.outputMode === "joystick";

  /**
   * The way INTO Game Mode. The way out is {@link exitGameModeToggle}, which rides the
   * header row instead — the two never render together, and they share one testid so
   * "the Game Mode toggle" stays a single control to a test or a hardware harness.
   */
  const enterGameModeToggle = gameModeAvailable && !immersive && (
    <Button
      size="sm"
      variant="secondary"
      data-testid="remote-input-immersive-toggle"
      aria-pressed={false}
      onClick={() => void startGameMode()}
    >
      <Maximize2 className="mr-1.5 h-4 w-4" />
      {gameModeLabel}
    </Button>
  );

  /**
   * The way OUT of Game Mode, on the header row beside the "Game mode" heading rather
   * than on the row below it — where it used to sit, spending a whole line of a screen
   * that has few to spare. The face is just "Exit"; the accessible name stays the full
   * "Exit game mode", and the ordinary Button sizing keeps it at the 44px target size.
   */
  const exitGameModeToggle = gameModeAvailable && immersive && (
    <Button
      size="sm"
      variant="default"
      className="shrink-0"
      data-testid="remote-input-immersive-toggle"
      aria-pressed
      aria-label="Exit game mode"
      onClick={() => exitGameMode()}
    >
      <Minimize2 className="mr-1.5 h-4 w-4" />
      Exit
    </Button>
  );

  /**
   * The explicit answer to the question `auto` is otherwise guessing at.
   *
   * Offered only while there IS a picture, because that is the only time hiding the
   * joystick means anything — with the mirror off the sheet would simply be empty. It
   * is the route back for a player whose joystick the guess took away, and the route
   * forward for one who wants the picture now; either way, pressing it settles the
   * question for the rest of this Game Mode session.
   *
   * Named for the joystick rather than the picture so it reads the same way round as
   * the Settings control, and so it cannot be mistaken for the floating **Controls**
   * handle beside it, which brings back this toolbar rather than the joystick.
   *
   * It reads what is DRAWN, not what the rule decided. Hiding is deliberately delayed
   * when the rule is guessing, so the two disagree for a couple of seconds after the
   * first physical key — and a button that offered to "show" a joystick the user can
   * still see, while reporting itself pressed, would be describing a state that is not
   * on the screen.
   */
  const joystickDrawn = showInputControls;
  const joystickVisibilityToggle = showMirrorScreen && (
    <Button
      size="sm"
      variant="secondary"
      data-testid="remote-input-joystick-visibility-toggle"
      aria-pressed={!joystickDrawn}
      onClick={() => setJoystickRequest(joystickDrawn ? "hidden" : "visible")}
    >
      {!joystickDrawn ? (
        <>
          <Joystick className="mr-1.5 h-4 w-4" />
          Show joystick
        </>
      ) : (
        <>
          <Maximize2 className="mr-1.5 h-4 w-4" />
          Hide joystick
        </>
      )}
    </Button>
  );

  const showFooterActions = !gameMode;

  const quickKeysBar = (className?: string) => (
    <QuickKeysBar
      onChar={session.sendChar}
      onKey={session.sendKeyboardInputs}
      onCursor={session.sendCursor}
      onSpecialKey={session.sendSpecialKey}
      heldKeyboardInputs={session.heldKeyboardInputs}
      onHeldKeyboardInputsChange={session.setHeldKeyboardInputs}
      releaseAllEpoch={session.releaseAllEpoch}
      tier={tier}
      scale={scale}
      className={className}
    />
  );

  return (
    <AppSheet open={open} onOpenChange={handleOpenChange}>
      <AppSheetContent
        data-testid="remote-input-sheet"
        data-game-mode={gameMode ? "true" : "false"}
        // Whether the on-screen joystick is actually DRAWN — not what the rule decided,
        // which leads it by the hide delay. On the surface because it is the thing a
        // hardware harness has to read to check the joystick went away when it should
        // have and stayed when it should have, and a harness needs the screen's answer.
        data-joystick={showInputControls ? "visible" : "hidden"}
        // What the transport is currently asked to hold. A direction stuck on the real C64 is
        // this feature's worst failure, so the answer is on the surface rather than only in a
        // log — and it is what lets a test assert the relayed direction rather than a repaint.
        data-held-joystick={[...session.heldJoystickInputs].sort().join(",")}
        // The top-right X is the sole Close; give it a stable testid for
        // keypad-reachability coverage. With the chrome hidden in Game Mode even the
        // X is gone — the floating restore handle brings it, and everything else, back.
        showClose={!chromeHidden}
        closeTestId="remote-input-close"
        // The sheet reserves a 5rem bottom clearance (to sit above the app tab
        // bar), but the tab bar is hidden while any sheet is open. In normal
        // mode there is no footer, so drop that dead space (pb-0) and let the
        // scrollable body own its bottom safe-area padding. Game Mode keeps the
        // default clearance so its edge-anchored controls clear the navigation bar.
        className={showFooterActions ? "pb-0" : undefined}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      >
        {/* Game Mode hides the header, the pinned toolbar and the mirror controls so only the
            live screen and whatever control surface applies remain. A single always-visible
            floating handle brings it all back — "pull the controls down" over the picture. */}
        {/* The handle sits over the picture, where every pixel is the game. A cog says
            "settings for this screen" in the width of an icon; the word "Controls" beside
            it cost about 60px of a 320px-wide screen for a label the icon already
            carries. The accessible name is unchanged, so the focus ring and any screen
            reader still announce "Show controls", and min-h-11/min-w-11 keeps the target
            at the 44px floor now that the text no longer sets the size. */}
        {chromeHidden ? (
          <button
            type="button"
            data-testid="remote-input-restore-chrome"
            aria-label="Show controls"
            title="Show controls"
            onClick={chrome.show}
            className="absolute left-1/2 top-1 z-30 flex min-h-11 min-w-11 -translate-x-1/2 items-center justify-center rounded-full bg-black/55 text-white/90 shadow backdrop-blur transition-colors hover:bg-black/70"
          >
            <Settings2 className="h-5 w-5" />
          </button>
        ) : null}
        {chromeHidden ? null : (
          <AppSheetHeader>
            <AppSheetTitle className="flex items-center gap-2">
              Remote Input
              <span
                className="flex items-center gap-1 text-xs font-normal text-muted-foreground"
                data-testid="remote-input-connection-indicator"
                data-status={session.connectionStatus}
              >
                {session.connectionStatus === "error" ? (
                  <>
                    <WifiOff className="h-3.5 w-3.5" /> Reconnecting…
                  </>
                ) : (
                  <Wifi className="h-3.5 w-3.5" aria-label="Connected" />
                )}
              </span>
            </AppSheetTitle>
          </AppSheetHeader>
        )}
        {/* Pinned chrome: the Joystick/Keys toggle and Release All live OUTSIDE
            the scrollable body (shrink-0), so they never scroll away. Size, Game mode
            and the orientation override ride further pinned rows so the toggle +
            Release All row always fits one line. Chrome keeps the standard px-4 gutter;
            the joystick zone and keyboard grid below stay edge-to-edge. */}
        {chromeHidden ? null : (
          <div
            className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-2"
            {...(gameMode ? chrome.keepAliveProps : {})}
          >
            <div className="flex items-center justify-between gap-2">
              {gameMode ? (
                <span
                  className="text-sm font-semibold text-muted-foreground"
                  data-testid="remote-input-game-mode-title"
                >
                  {gameModeLabel}
                </span>
              ) : (
                <div className="flex min-w-0 items-center gap-2" data-testid="remote-input-output-mode-toggle">
                  <Button
                    size="sm"
                    variant={session.outputMode === "joystick" ? "default" : "secondary"}
                    data-testid="remote-input-mode-joystick"
                    disabled={!joystickAvailable}
                    title={!joystickAvailable ? joystickUnavailableHint : undefined}
                    onClick={() => handleOutputModeChange("joystick")}
                  >
                    {isCompactDisplay ? null : <Joystick className="mr-1.5 h-4 w-4" />}
                    Joystick
                  </Button>
                  <Button
                    size="sm"
                    variant={session.outputMode === "type" ? "default" : "secondary"}
                    data-testid="remote-input-mode-type"
                    onClick={() => handleOutputModeChange("type")}
                  >
                    {isCompactDisplay ? null : <KeyboardIcon className="mr-1.5 h-4 w-4" />}
                    Keys
                  </Button>
                </div>
              )}
              {showFooterActions ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="shrink-0"
                  data-testid="remote-input-panic-button"
                  onClick={() => session.releaseAll()}
                >
                  Release all
                </Button>
              ) : null}
              {/* The way out of Game Mode, right-aligned beside the heading. Release All
                  is deliberately absent in Game Mode, so this row has the space. */}
              {exitGameModeToggle}
            </div>
            {session.outputMode === "joystick" ? (
              // flex-wrap, like the two rows below it: on a 320px screen the stepper
              // and the Game mode button together are wider than the row, and without
              // wrapping the stepper was squeezed until "Size" was set one or two
              // letters to a line.
              <div className="flex flex-wrap items-center justify-between gap-2">
                {sizeStepper}
                {enterGameModeToggle}
              </div>
            ) : null}
            {/* Game Mode's chrome carries the orientation control: it is what makes the
                picture and the keys followable when the sensor cannot answer, and the
                ordinary sheet has no room to spare for a row nobody there is using. The
                joystick toggle rides beside it, where the way out of Game Mode is. */}
            {gameMode ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                {rotationOverride}
                {joystickVisibilityToggle}
              </div>
            ) : null}
            {mirrorEnabled ? (
              <div
                className="flex flex-wrap items-center justify-between gap-2"
                data-testid="remote-input-mirror-controls"
              >
                <AvMirrorControls showAudio={audioMirrorEnabled} showVideo={videoMirrorEnabled} />
                {mirrorAdjust ? (
                  <span className="text-xs font-medium text-amber-500" data-testid="remote-input-mirror-adjust-hint">
                    Physical keys adjust the view
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        <AppSheetBody
          className={cn(
            "flex flex-col gap-4",
            // The footer is gone; give the body its own bottom safe-area
            // clearance in normal mode. Game Mode keeps the sheet's default bottom
            // clearance instead (edge-anchored controls clear the nav bar).
            showFooterActions && "pb-[calc(0.75rem+var(--safe-area-inset-bottom))]",
          )}
        >
          {showMirrorScreen ? (
            // Only Game Mode's mirror claims the leftover height. Outside it the picture
            // sizes to its own aspect and the controls stack below, so a wrapper that
            // flexed here would leave the picture overflowing onto them.
            <div className={cn("relative flex flex-col", gameMode ? "min-h-0 flex-1" : "shrink-0")}>
              <AvMirrorImmersive
                ref={mirrorRef}
                onModeChange={(nextMode) => setMirrorAdjust(nextMode === "adjust")}
                rotation={frameRotation}
                fill={gameMode}
                heldJoystickInputs={session.heldJoystickInputs}
                className={gameMode ? undefined : "mx-4"}
              />
              {/* `#` puts RETURN, SPACE, the other quick keys and the Live View switches over
                  the bottom of the picture — the route to both that survives a handset with no
                  touchscreen and no on-screen controls. */}
              {gameMode && quickKeysOverlay.visible ? (
                <div
                  className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 bg-black/70 px-2 pb-2 pt-1 backdrop-blur"
                  data-testid="remote-input-quick-keys-toggle"
                  {...quickKeysOverlay.keepAliveProps}
                >
                  {quickKeysBar()}
                  {mirrorEnabled ? (
                    <AvMirrorControls showAudio={audioMirrorEnabled} showVideo={videoMirrorEnabled} />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {session.outputMode === "joystick" ? (
            showInputControls ? (
              <VirtualJoystick
                port={session.port}
                onSetPort={session.setPort}
                heldInputs={session.heldJoystickInputs}
                onHeldInputsChange={session.setHeldJoystickInputs}
                autofireEnabled={session.autofireEnabled}
                onAutofireEnabledChange={session.setAutofireEnabled}
                autofireRateHz={session.autofireRateHz}
                onAutofireRateHzChange={session.setAutofireRateHz}
                showAutofire={showAutofire}
                disabled={!joystickAvailable}
                disabledHint={joystickUnavailableHint}
                scale={scale}
                immersive={gameMode}
                fillHeight={!showMirrorScreen}
                releaseAllEpoch={session.releaseAllEpoch}
                // Touching the on-screen joystick withdraws the only evidence `auto`
                // had. Without this a single stray key press during a touch game
                // takes the joystick away and the toolbar is the only way back.
                onPointerInput={() => setKeyDriven(false)}
              />
            ) : null
          ) : (
            <TypeKeyboard
              className="min-h-0 flex-1"
              onChar={session.sendChar}
              onKey={session.sendKeyboardInputs}
              onCursor={session.sendCursor}
              onSpecialKey={session.sendSpecialKey}
              heldKeyboardInputs={session.heldKeyboardInputs}
              onHeldKeyboardInputsChange={session.setHeldKeyboardInputs}
              releaseAllEpoch={session.releaseAllEpoch}
              tier={tier}
            />
          )}

          {/* The quick-keys bar rides alongside the JOYSTICK for one-tap
              SPACE/RETURN/cursor without leaving game control; in Type mode the
              keyboard's own pinned deck already covers these, so it's omitted. */}
          {!gameMode && session.outputMode === "joystick" ? quickKeysBar("border-t border-border pt-3") : null}
        </AppSheetBody>
      </AppSheetContent>
    </AppSheet>
  );
};
