/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { memo, useCallback, useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { vibrateTap } from "@/lib/remoteInput/haptics";
import { toneButtonClass } from "@/lib/remoteInput/keyTone";
import type { KeyTone } from "@/lib/remoteInput/keyboardLayout";
import { specialKeyToKeyboardInputEvent } from "@/lib/remoteInput/specialKeyMapping";
import { KeyHoldButton } from "@/components/remoteInput/KeyHoldButton";
import { useKeyboardHoldDispatch } from "@/hooks/useKeyboardHoldDispatch";
import type { HeldKeyboardInputs } from "@/lib/remoteInput/keyboardHeldSet";
import type { KeyboardInputName } from "@/lib/c64api";
import type { CursorDirection } from "@/lib/remoteInput/cursorKeyMapping";
import type { SpecialKeyboardKey } from "@/lib/remoteInput/specialKeyMapping";

export type QuickKeysBarProps = {
  onChar: (char: string) => void;
  onKey: (inputs: KeyboardInputName[]) => void;
  onCursor: (direction: CursorDirection) => void;
  onSpecialKey: (key: SpecialKeyboardKey) => void;
  /**
   * Real key-hold relay (full tier only): a shared held-inputs set, diffed
   * into press/release `machine:input` calls by the session — the same
   * architecture the joystick already uses — so a key genuinely stays down
   * on the C64 for as long as it is held, instead of an instant tap.
   */
  heldKeyboardInputs: HeldKeyboardInputs;
  onHeldKeyboardInputsChange: (next: HeldKeyboardInputs) => void;
  tier: "full" | "kernal-fallback" | "auth-required";
  /** Control-size multiplier (shared remote-control size preference). */
  scale?: number;
  className?: string;
};

// Plain-language reasons — no REST/firmware jargon.
const AUTH_REQUIRED_HINT = "This device's password must be entered in Settings first";
const UNAVAILABLE_HINT = "Not available on this device";

// Module-level (not per-render) so these array references stay stable
// forever — required for the memoized QuickKeyButton below to actually bail
// when an UNRELATED key is pressed (see its doc comment).
const SPACE_INPUTS: KeyboardInputName[] = ["space"];
const RETURN_INPUTS: KeyboardInputName[] = ["return"];
const RUN_STOP_INPUTS: KeyboardInputName[] = specialKeyToKeyboardInputEvent("run_stop").inputs;

// f 1 … f 8, odd keys tinted (see the Keys tab's `function-primary`). Hoisted
// to a module constant (pure data, no closure deps) for the same reason.
const F_KEYS: ReadonlyArray<{
  key: SpecialKeyboardKey;
  testId: string;
  label: string;
  tone: KeyTone | undefined;
  inputs: KeyboardInputName[];
}> = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => {
  const key = `f${n}` as SpecialKeyboardKey;
  return {
    key,
    testId: `remote-input-key-f${n}`,
    label: `f${"  "}${n}`,
    tone: n % 2 === 1 ? ("function-primary" as const) : undefined,
    inputs: specialKeyToKeyboardInputEvent(key).inputs,
  };
});

type QuickKeyButtonProps = {
  testId: string;
  label?: ReactNode;
  icon?: ComponentType<{ style?: React.CSSProperties }>;
  tone?: KeyTone;
  ariaLabel?: string;
  disabled: boolean;
  hint?: string;
  latched?: boolean;
  hasHoldGesture: boolean;
  keyStyle: { height: number; fontSize: number };
  iconPx: number;
  onHoldPress?: () => void;
  onHoldRelease?: () => void;
  onTap: () => void;
};

/**
 * One quick-keys button, `React.memo`-wrapped so pressing one key (e.g. FIRE
 * during a game) does not force React to re-render the other ~19 buttons on
 * this always-visible bar — the same real-hardware-measured latency problem
 * as the Keys-tab keyboard (see TypeKeyboard's KeyboardKeyButtonImpl), and
 * arguably more important here since this bar is what's on screen during
 * actual gameplay. Every prop must stay referentially/value-stable across an
 * unrelated key's press for the memo to bail: `keyStyle` is memoized by the
 * caller, callbacks are the stable per-button closures built once in
 * `modifierCallbacks`/`holdableCallbacks` below, not fresh closures per render.
 */
const QuickKeyButtonImpl = ({
  testId,
  label,
  icon: Icon,
  tone,
  ariaLabel,
  disabled,
  hint,
  latched,
  hasHoldGesture,
  keyStyle,
  iconPx,
  onHoldPress,
  onHoldRelease,
  onTap,
}: QuickKeyButtonProps) => (
  <KeyHoldButton
    size="sm"
    variant="secondary"
    style={keyStyle}
    className={cn("min-w-0 flex-1 overflow-hidden px-1", tone ? toneButtonClass(tone, latched) : undefined)}
    data-testid={testId}
    aria-pressed={hasHoldGesture ? latched : undefined}
    disabled={disabled}
    title={disabled ? hint : undefined}
    aria-label={ariaLabel}
    onHoldPress={hasHoldGesture ? onHoldPress : undefined}
    onHoldRelease={hasHoldGesture ? onHoldRelease : undefined}
    onTap={onTap}
  >
    {Icon ? <Icon style={{ width: iconPx, height: iconPx }} /> : label}
  </KeyHoldButton>
);
const QuickKeyButton = memo(QuickKeyButtonImpl);

/**
 * The always-visible companion bar beside the joystick — a fixed five-row deck
 * that mirrors the physical C64 keyboard clusters most useful mid-game without
 * leaving joystick control or opening the full Keys tab:
 *
 *   RUN/STOP · CTRL · SPACE · RETURN     (control + confirm)
 *   f 1 · f 2 · f 3 · f 4                 (function keys, split two rows)
 *   f 5 · f 6 · f 7 · f 8
 *   ← ↑ ↓ →                               (cursor cluster)
 *   C= · SHIFT · SPACE · SHIFT            (bottom modifier row)
 *
 * The function keys are printed lower-case with a space (f 1, f 3 …) exactly as
 * on the real keycaps, and the odd (unshifted) ones carry the same subtle tint
 * as on the Keys tab. Modifier taps (CTRL / C= / SHIFT) and RUN/STOP have no
 * kernal-buffer fallback, so they disable off the `full` tier; the ordinary
 * keys (SPACE/RETURN/f-keys/cursors) work on kernal-fallback too and only
 * disable when the device still needs a password (`auth-required`).
 */
export const QuickKeysBar = ({
  onChar,
  onKey,
  onCursor,
  onSpecialKey,
  heldKeyboardInputs,
  onHeldKeyboardInputsChange,
  tier,
  scale = 1,
  className,
}: QuickKeysBarProps) => {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  // Memoized (not a fresh object every render): passed straight through to
  // the memoized QuickKeyButton below, so a new object identity here would
  // defeat its memo bail on every keystroke even though the values never
  // change between ordinary re-renders (scale is fixed per session).
  const keyStyle = useMemo(
    () => ({ height: Math.round(40 * safeScale), fontSize: Math.round(13 * safeScale) }),
    [safeScale],
  );
  const iconPx = Math.round(18 * safeScale);

  // SPACE/RETURN/f-keys/cursors are injectable on the kernal-fallback tier, so
  // they only go dark when the device still needs a password. RUN/STOP and the
  // CTRL/C=/SHIFT modifiers have no fallback, so they need the full tier.
  const disabledNoAuth = tier === "auth-required";
  const disabledNoFull = tier !== "full";
  const isFullTier = tier === "full";

  // Real key-hold relay (full tier only), mirroring the joystick's held-set
  // architecture and TypeKeyboard's Keys-tab dispatch: a key genuinely stays
  // down on the C64 for as long as it is held, and SHIFT/CTRL/C= support both
  // a physical hold-and-chord and a tap-then-tap one-shot latch.
  const holdDispatch = useKeyboardHoldDispatch(heldKeyboardInputs, onHeldKeyboardInputsChange);

  const tapChar = useCallback(
    (char: string) => {
      vibrateTap(10);
      onChar(char);
    },
    [onChar],
  );
  const tapCursor = useCallback(
    (direction: CursorDirection) => {
      vibrateTap(10);
      onCursor(direction);
    },
    [onCursor],
  );
  const tapSpecial = useCallback(
    (key: SpecialKeyboardKey) => {
      vibrateTap(10);
      onSpecialKey(key);
    },
    [onSpecialKey],
  );
  const tapKey = useCallback(
    (inputs: KeyboardInputName[]) => {
      vibrateTap(10);
      onKey(inputs);
    },
    [onKey],
  );

  // Full tier: hold a modifier for as long as it's physically pressed (a real
  // chord with whatever else is held meanwhile), or latch it onto the next
  // key on a bare tap — see useKeyboardHoldDispatch's doc comment. These are
  // generic (take the modifier/inputs as an argument) and depend only on
  // holdDispatch's methods, which are themselves permanently stable — so
  // they never change identity across a QuickKeysBar re-render, letting
  // QuickKeyButton's memo bail for every button OTHER than the one pressed.
  const handleModifierHoldPress = useCallback(
    (modifier: KeyboardInputName) => holdDispatch.pressModifier(modifier),
    [holdDispatch.pressModifier],
  );
  const handleModifierHoldRelease = useCallback(
    (modifier: KeyboardInputName) => holdDispatch.releaseModifier(modifier),
    [holdDispatch.releaseModifier],
  );
  const handleModifierTap = useCallback(
    (modifier: KeyboardInputName) => {
      holdDispatch.pressModifier(modifier);
      holdDispatch.releaseModifier(modifier);
    },
    [holdDispatch.pressModifier, holdDispatch.releaseModifier],
  );
  const handleHoldableHoldPress = useCallback(
    (inputs: KeyboardInputName[]) => {
      vibrateTap(10);
      holdDispatch.pressKey(inputs);
    },
    [holdDispatch.pressKey],
  );
  const handleHoldableHoldRelease = useCallback(
    (inputs: KeyboardInputName[]) => holdDispatch.releaseKey(inputs),
    [holdDispatch.releaseKey],
  );
  const handleHoldableTap = useCallback(
    (inputs: KeyboardInputName[]) => {
      vibrateTap(10);
      holdDispatch.pressKey(inputs);
      holdDispatch.releaseKey(inputs);
    },
    [holdDispatch.pressKey, holdDispatch.releaseKey],
  );

  // Per-instance stable callbacks, built ONCE (the generic handlers above
  // never change identity, so this useMemo never recomputes) rather than as
  // fresh closures inside modifierKeyBtn/holdableKeyBtn on every render.
  const modifierCallbacks = useMemo(() => {
    const build = (modifier: KeyboardInputName) => ({
      onHoldPress: () => handleModifierHoldPress(modifier),
      onHoldRelease: () => handleModifierHoldRelease(modifier),
      onTap: () => handleModifierTap(modifier),
    });
    return {
      ctrl: build("ctrl"),
      commodore: build("commodore"),
      shiftLeft: build("left_shift"),
      shiftRight: build("right_shift"),
    };
  }, [handleModifierHoldPress, handleModifierHoldRelease, handleModifierTap]);

  const holdableCallbacks = useMemo(() => {
    const build = (inputs: KeyboardInputName[]) => ({
      onHoldPress: () => handleHoldableHoldPress(inputs),
      onHoldRelease: () => handleHoldableHoldRelease(inputs),
      onTap: () => handleHoldableTap(inputs),
    });
    return {
      runStop: build(RUN_STOP_INPUTS),
      space: build(SPACE_INPUTS),
      return: build(RETURN_INPUTS),
      f: F_KEYS.map((f) => build(f.inputs)),
    };
  }, [handleHoldableHoldPress, handleHoldableHoldRelease, handleHoldableTap]);

  const keyBtn = (opts: {
    testId: string;
    onTap: () => void;
    onHoldPress?: () => void;
    onHoldRelease?: () => void;
    hasHoldGesture?: boolean;
    latched?: boolean;
    disabled: boolean;
    hint?: string;
    tone?: KeyTone;
    label?: ReactNode;
    icon?: ComponentType<{ style?: React.CSSProperties }>;
    ariaLabel?: string;
  }) => (
    <QuickKeyButton
      key={opts.testId}
      testId={opts.testId}
      label={opts.label}
      icon={opts.icon}
      tone={opts.tone}
      ariaLabel={opts.ariaLabel}
      disabled={opts.disabled}
      hint={opts.hint}
      latched={opts.latched}
      hasHoldGesture={opts.hasHoldGesture ?? false}
      keyStyle={keyStyle}
      iconPx={iconPx}
      onHoldPress={opts.onHoldPress}
      onHoldRelease={opts.onHoldRelease}
      onTap={opts.onTap}
    />
  );

  // CTRL/C=/SHIFT are disabled entirely below full tier (no kernal-buffer
  // fallback exists for them), so the fallback tap is unreachable in
  // practice - its instability doesn't matter (see TypeKeyboard's `dispatch`
  // for the same reasoning).
  const modifierKeyBtn = (opts: {
    testId: string;
    modifier: KeyboardInputName;
    callbacks: { onHoldPress: () => void; onHoldRelease: () => void; onTap: () => void };
    label: ReactNode;
    tone: KeyTone;
    ariaLabel: string;
  }) =>
    keyBtn({
      testId: opts.testId,
      label: opts.label,
      tone: opts.tone,
      ariaLabel: opts.ariaLabel,
      latched: holdDispatch.isModifierActive(opts.modifier),
      hasHoldGesture: isFullTier,
      onHoldPress: isFullTier ? opts.callbacks.onHoldPress : undefined,
      onHoldRelease: isFullTier ? opts.callbacks.onHoldRelease : undefined,
      onTap: isFullTier ? opts.callbacks.onTap : () => tapKey([opts.modifier]),
      disabled: disabledNoFull,
      hint: UNAVAILABLE_HINT,
    });

  // Full tier: real hold for an ordinary key resolved to its matrix inputs.
  // Below full tier, falls back to the original one-shot tap dispatch.
  const holdableKeyBtn = (opts: {
    testId: string;
    label: ReactNode;
    tone?: KeyTone;
    ariaLabel?: string;
    callbacks: { onHoldPress: () => void; onHoldRelease: () => void; onTap: () => void };
    fallbackOnPress: () => void;
    disabled: boolean;
    hint: string;
  }) =>
    keyBtn({
      testId: opts.testId,
      label: opts.label,
      tone: opts.tone,
      ariaLabel: opts.ariaLabel,
      hasHoldGesture: isFullTier,
      onHoldPress: isFullTier ? opts.callbacks.onHoldPress : undefined,
      onHoldRelease: isFullTier ? opts.callbacks.onHoldRelease : undefined,
      onTap: isFullTier ? opts.callbacks.onTap : opts.fallbackOnPress,
      disabled: opts.disabled,
      hint: opts.hint,
    });

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="remote-input-quick-keys-bar">
      {/* Row 1: RUN/STOP · CTRL · SPACE · RETURN. RUN/STOP keeps the double-border
          warning-token caution treatment (shape + colour, never colour alone)
          it has on the Keys tab so a mistap can never look ordinary. */}
      <div className="flex gap-1.5">
        {holdableKeyBtn({
          testId: "remote-input-key-run-stop",
          label: "RUN/STOP",
          tone: "caution",
          callbacks: holdableCallbacks.runStop,
          fallbackOnPress: () => tapSpecial("run_stop"),
          disabled: disabledNoFull,
          hint: UNAVAILABLE_HINT,
        })}
        {modifierKeyBtn({
          testId: "remote-input-key-ctrl",
          label: "CTRL",
          tone: "modifier",
          modifier: "ctrl",
          callbacks: modifierCallbacks.ctrl,
          ariaLabel: "Ctrl",
        })}
        {holdableKeyBtn({
          testId: "remote-input-key-space",
          label: "SPACE",
          callbacks: holdableCallbacks.space,
          fallbackOnPress: () => tapChar(" "),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
        {holdableKeyBtn({
          testId: "remote-input-key-return",
          label: "RETURN",
          callbacks: holdableCallbacks.return,
          fallbackOnPress: () => tapChar("\n"),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
      </div>

      {/* Rows 2-3: the function keys, split f 1-f 4 / f 5-f 8. */}
      <div className="flex gap-1.5">
        {F_KEYS.slice(0, 4).map((f, i) =>
          holdableKeyBtn({
            testId: f.testId,
            label: f.label,
            tone: f.tone,
            callbacks: holdableCallbacks.f[i],
            fallbackOnPress: () => tapSpecial(f.key),
            disabled: disabledNoAuth,
            hint: AUTH_REQUIRED_HINT,
          }),
        )}
      </div>
      <div className="flex gap-1.5">
        {F_KEYS.slice(4).map((f, i) =>
          holdableKeyBtn({
            testId: f.testId,
            label: f.label,
            tone: f.tone,
            callbacks: holdableCallbacks.f[i + 4],
            fallbackOnPress: () => tapSpecial(f.key),
            disabled: disabledNoAuth,
            hint: AUTH_REQUIRED_HINT,
          }),
        )}
      </div>

      {/* Row 4: the cursor cluster (up - down - left - right). */}
      <div className="flex gap-1.5">
        {keyBtn({
          testId: "remote-input-key-cursor-up",
          icon: ArrowUp,
          ariaLabel: "Cursor up",
          onTap: () => tapCursor("up"),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
        {keyBtn({
          testId: "remote-input-key-cursor-down",
          icon: ArrowDown,
          ariaLabel: "Cursor down",
          onTap: () => tapCursor("down"),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
        {keyBtn({
          testId: "remote-input-key-cursor-left",
          icon: ArrowLeft,
          ariaLabel: "Cursor left",
          onTap: () => tapCursor("left"),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
        {keyBtn({
          testId: "remote-input-key-cursor-right",
          icon: ArrowRight,
          ariaLabel: "Cursor right",
          onTap: () => tapCursor("right"),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
      </div>

      {/* Row 5: the physical bottom row - C= - SHIFT - SPACE - SHIFT. Both SHIFTs
          carry the same primary-token treatment as everywhere else. */}
      <div className="flex gap-1.5">
        {modifierKeyBtn({
          testId: "remote-input-key-commodore",
          label: "C=",
          tone: "modifier",
          modifier: "commodore",
          callbacks: modifierCallbacks.commodore,
          ariaLabel: "Commodore",
        })}
        {modifierKeyBtn({
          testId: "remote-input-key-shift-left",
          label: "SHIFT",
          tone: "shift",
          modifier: "left_shift",
          callbacks: modifierCallbacks.shiftLeft,
          ariaLabel: "Left shift",
        })}
        {holdableKeyBtn({
          testId: "remote-input-key-space-bottom",
          label: "SPACE",
          callbacks: holdableCallbacks.space,
          fallbackOnPress: () => tapChar(" "),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
        {modifierKeyBtn({
          testId: "remote-input-key-shift-right",
          label: "SHIFT",
          tone: "shift",
          ariaLabel: "Right shift",
          // Sends the distinct right_shift wire code (both C64 shift keys drive
          // the same matrix line, but the label says "right", so match it).
          modifier: "right_shift",
          callbacks: modifierCallbacks.shiftRight,
        })}
      </div>
    </div>
  );
};
