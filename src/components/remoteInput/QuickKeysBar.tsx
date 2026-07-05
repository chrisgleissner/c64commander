/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
  const keyStyle = { height: Math.round(40 * safeScale), fontSize: Math.round(13 * safeScale) };
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

  const tapChar = (char: string) => {
    vibrateTap(10);
    onChar(char);
  };
  const tapCursor = (direction: CursorDirection) => {
    vibrateTap(10);
    onCursor(direction);
  };
  const tapSpecial = (key: SpecialKeyboardKey) => {
    vibrateTap(10);
    onSpecialKey(key);
  };
  const tapKey = (inputs: KeyboardInputName[]) => {
    vibrateTap(10);
    onKey(inputs);
  };

  const keyBtn = (opts: {
    testId: string;
    onPress: () => void;
    onHoldPress?: () => void;
    onHoldRelease?: () => void;
    latched?: boolean;
    disabled: boolean;
    hint?: string;
    tone?: KeyTone;
    label?: ReactNode;
    icon?: ComponentType<{ style?: React.CSSProperties }>;
    ariaLabel?: string;
  }) => {
    const Icon = opts.icon;
    return (
      <KeyHoldButton
        key={opts.testId}
        size="sm"
        variant="secondary"
        style={keyStyle}
        className={cn(
          "min-w-0 flex-1 overflow-hidden px-1",
          opts.tone ? toneButtonClass(opts.tone, opts.latched) : undefined,
        )}
        data-testid={opts.testId}
        aria-pressed={opts.onHoldPress ? opts.latched : undefined}
        disabled={opts.disabled}
        title={opts.disabled ? opts.hint : undefined}
        aria-label={opts.ariaLabel}
        onHoldPress={opts.onHoldPress}
        onHoldRelease={opts.onHoldRelease}
        onTap={opts.onPress}
      >
        {Icon ? <Icon style={{ width: iconPx, height: iconPx }} /> : opts.label}
      </KeyHoldButton>
    );
  };

  // f 1 … f 8, odd keys tinted (see the Keys tab's `function-primary`).
  const fKeys = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => ({
    key: `f${n}` as SpecialKeyboardKey,
    testId: `remote-input-key-f${n}`,
    label: `f${"\u00a0\u00a0"}${n}`,
    tone: (n % 2 === 1 ? "function-primary" : undefined) as KeyTone | undefined,
  }));

  // Full tier: hold a modifier for as long as it's physically pressed (a real
  // chord with whatever else is held meanwhile), or latch it onto the next
  // key on a bare tap — see useKeyboardHoldDispatch's doc comment. CTRL/C=/
  // SHIFT are disabled entirely below full tier (no kernal-buffer fallback
  // exists for them), so the fallback tap is unreachable in practice.
  const modifierKeyBtn = (opts: {
    testId: string;
    modifier: KeyboardInputName;
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
      onHoldPress: isFullTier ? () => holdDispatch.pressModifier(opts.modifier) : undefined,
      onHoldRelease: isFullTier ? () => holdDispatch.releaseModifier(opts.modifier) : undefined,
      onPress: isFullTier
        ? () => {
            holdDispatch.pressModifier(opts.modifier);
            holdDispatch.releaseModifier(opts.modifier);
          }
        : () => tapKey([opts.modifier]),
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
    inputs: KeyboardInputName[];
    fallbackOnPress: () => void;
    disabled: boolean;
    hint: string;
  }) =>
    keyBtn({
      testId: opts.testId,
      label: opts.label,
      tone: opts.tone,
      ariaLabel: opts.ariaLabel,
      onHoldPress: isFullTier
        ? () => {
            vibrateTap(10);
            holdDispatch.pressKey(opts.inputs);
          }
        : undefined,
      onHoldRelease: isFullTier ? () => holdDispatch.releaseKey(opts.inputs) : undefined,
      onPress: isFullTier
        ? () => {
            vibrateTap(10);
            holdDispatch.pressKey(opts.inputs);
            holdDispatch.releaseKey(opts.inputs);
          }
        : opts.fallbackOnPress,
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
          inputs: specialKeyToKeyboardInputEvent("run_stop").inputs,
          fallbackOnPress: () => tapSpecial("run_stop"),
          disabled: disabledNoFull,
          hint: UNAVAILABLE_HINT,
        })}
        {modifierKeyBtn({
          testId: "remote-input-key-ctrl",
          label: "CTRL",
          tone: "modifier",
          modifier: "ctrl",
          ariaLabel: "Ctrl",
        })}
        {holdableKeyBtn({
          testId: "remote-input-key-space",
          label: "SPACE",
          inputs: ["space"],
          fallbackOnPress: () => tapChar(" "),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
        {holdableKeyBtn({
          testId: "remote-input-key-return",
          label: "RETURN",
          inputs: ["return"],
          fallbackOnPress: () => tapChar("\n"),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
      </div>

      {/* Rows 2-3: the function keys, split f 1–f 4 / f 5–f 8. */}
      <div className="flex gap-1.5">
        {fKeys.slice(0, 4).map((f) =>
          holdableKeyBtn({
            testId: f.testId,
            label: f.label,
            tone: f.tone,
            inputs: specialKeyToKeyboardInputEvent(f.key).inputs,
            fallbackOnPress: () => tapSpecial(f.key),
            disabled: disabledNoAuth,
            hint: AUTH_REQUIRED_HINT,
          }),
        )}
      </div>
      <div className="flex gap-1.5">
        {fKeys.slice(4).map((f) =>
          holdableKeyBtn({
            testId: f.testId,
            label: f.label,
            tone: f.tone,
            inputs: specialKeyToKeyboardInputEvent(f.key).inputs,
            fallbackOnPress: () => tapSpecial(f.key),
            disabled: disabledNoAuth,
            hint: AUTH_REQUIRED_HINT,
          }),
        )}
      </div>

      {/* Row 4: the cursor cluster (up · down · left · right). */}
      <div className="flex gap-1.5">
        {keyBtn({
          testId: "remote-input-key-cursor-up",
          icon: ArrowUp,
          ariaLabel: "Cursor up",
          onPress: () => tapCursor("up"),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
        {keyBtn({
          testId: "remote-input-key-cursor-down",
          icon: ArrowDown,
          ariaLabel: "Cursor down",
          onPress: () => tapCursor("down"),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
        {keyBtn({
          testId: "remote-input-key-cursor-left",
          icon: ArrowLeft,
          ariaLabel: "Cursor left",
          onPress: () => tapCursor("left"),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
        {keyBtn({
          testId: "remote-input-key-cursor-right",
          icon: ArrowRight,
          ariaLabel: "Cursor right",
          onPress: () => tapCursor("right"),
          disabled: disabledNoAuth,
          hint: AUTH_REQUIRED_HINT,
        })}
      </div>

      {/* Row 5: the physical bottom row — C= · SHIFT · SPACE · SHIFT. Both SHIFTs
          carry the same primary-token treatment as everywhere else. */}
      <div className="flex gap-1.5">
        {modifierKeyBtn({
          testId: "remote-input-key-commodore",
          label: "C=",
          tone: "modifier",
          modifier: "commodore",
          ariaLabel: "Commodore",
        })}
        {modifierKeyBtn({
          testId: "remote-input-key-shift-left",
          label: "SHIFT",
          tone: "shift",
          modifier: "left_shift",
          ariaLabel: "Left shift",
        })}
        {holdableKeyBtn({
          testId: "remote-input-key-space-bottom",
          label: "SPACE",
          inputs: ["space"],
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
        })}
      </div>
    </div>
  );
};
