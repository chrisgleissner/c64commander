/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { vibrateTap } from "@/lib/remoteInput/haptics";
import { CursorPad } from "@/components/remoteInput/CursorPad";
import { KeyHoldButton } from "@/components/remoteInput/KeyHoldButton";
import { resolveKeyboardProfile, type KeyboardProfile } from "@/lib/remoteInput/keyboardProfile";
import {
  EXPANDED_FUNCTION_GAP_UNITS,
  EXPANDED_FUNCTION_UNITS,
  EXPANDED_ROW_UNITS,
  getKeyboardLayout,
  SPACE_ROW_LEADING_SPAN,
  SPACE_ROW_SPAN,
  SPACE_ROW_TRAILING_SPAN,
  type KeyDef,
  type KeyTone,
  type StickyModifier,
} from "@/lib/remoteInput/keyboardLayout";
import { toneButtonClass } from "@/lib/remoteInput/keyTone";
import { charToKeyboardInputEvents } from "@/lib/remoteInput/keyboardCharMapping";
import { specialKeyToKeyboardInputEvent } from "@/lib/remoteInput/specialKeyMapping";
import { useKeyboardHoldDispatch } from "@/hooks/useKeyboardHoldDispatch";
import type { HeldKeyboardInputs } from "@/lib/remoteInput/keyboardHeldSet";
import type { KeyboardInputName } from "@/lib/c64api";
import type { CursorDirection } from "@/lib/remoteInput/cursorKeyMapping";
import type { SpecialKeyboardKey } from "@/lib/remoteInput/specialKeyMapping";
import { REMOTE_INPUT_AUTH_REQUIRED_HINT } from "@/lib/remoteInput/capabilityTier";

export type TypeKeyboardTier = "full" | "kernal-fallback" | "auth-required";

export type TypeKeyboardProps = {
  onChar: (char: string) => void;
  onKey: (inputs: KeyboardInputName[]) => void;
  onCursor: (direction: CursorDirection) => void;
  onSpecialKey: (key: SpecialKeyboardKey) => void;
  tier: TypeKeyboardTier;
  /**
   * Real key-hold relay (full tier only): a shared held-inputs set, diffed
   * into press/release `machine:input` calls by the session — the same
   * architecture the joystick already uses — so a key genuinely stays down
   * on the C64 for as long as it is held, instead of an instant tap.
   */
  heldKeyboardInputs: HeldKeyboardInputs;
  onHeldKeyboardInputsChange: (next: HeldKeyboardInputs) => void;
  /** Test/preview seam: force a profile instead of measuring the content box. */
  profile?: KeyboardProfile;
  className?: string;
};

// Plain-language reason shown when a key that needs machine:input (RUN/STOP,
// RESTORE, C=, CTRL) is disabled — no REST/firmware jargon.
const UNAVAILABLE_KEY_HINT = "Not available on this device";
const UNAVAILABLE_KEYS_FOOTER = "RUN/STOP, RESTORE, C= and CTRL aren’t available on this device.";

/** Splits a list into fixed-size groups (used to lay the F-keys out two per row). */
const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
};

// Resolves an ordinary key to the matrix input(s) it presses — the same
// vocabulary the real-hold path (holdDispatch) needs to add/remove from the
// shared held set. Returns null for action kinds with no such resolution
// (cursor keeps its own click-only + repeat-on-hold dispatch). Pure (no
// closure state), so it can be called from the stable top-level hold
// handlers below without becoming a dependency that changes every render.
const resolveOrdinaryKeyInputs = (def: KeyDef): KeyboardInputName[] | null => {
  switch (def.action.kind) {
    case "char": {
      const [event] = charToKeyboardInputEvents(def.action.char);
      return event ? event.inputs : null;
    }
    case "key":
      return def.action.inputs;
    case "special":
      return specialKeyToKeyboardInputEvent(def.action.key).inputs;
    default:
      return null;
  }
};

// The C64's two physical cursor keys are each shared by two directions via
// SHIFT (see cursorKeyMapping.ts): this is that same pairing, used to pick
// the OTHER direction when SHIFT is held while tapping the expanded
// profile's merged cursor key.
const CURSOR_SHIFT_COMPLEMENT: Record<CursorDirection, CursorDirection> = {
  down: "up",
  up: "down",
  left: "right",
  right: "left",
};

type KeyboardKeyButtonProps = {
  def: KeyDef;
  variant: "default" | "secondary" | "outline";
  toneClassName: string;
  heightPx: number | undefined;
  grow: boolean | undefined;
  fill: boolean | undefined;
  label: string;
  showSecondary: boolean;
  keyFontPx: number;
  disabled: boolean;
  latched: boolean;
  isModifierOrShiftLock: boolean;
  hasHoldGesture: boolean;
  onHoldPress: (def: KeyDef) => void;
  onHoldRelease: (def: KeyDef) => void;
  onTap: (def: KeyDef) => void;
};

/**
 * One physical key, split out and `React.memo`-wrapped so pressing ONE key
 * does not force React to re-render and reconcile the other ~59 on the same
 * keyboard. Real-hardware measurement (Pixel 4 + real U64) showed the
 * unmemoized full re-render costing ~13-34ms of press-to-dispatch latency —
 * for this to actually bail, every prop here must be referentially stable
 * across an unrelated key's press: `def` is a module-level constant (see
 * keyboardLayout.ts), the primitives compare by value, and the three
 * callbacks are the stable top-level handlers from TypeKeyboard (never
 * recreated) rather than a fresh closure per render.
 */
const KeyboardKeyButtonImpl = ({
  def,
  variant,
  toneClassName,
  heightPx,
  grow,
  fill,
  label,
  showSecondary,
  keyFontPx,
  disabled,
  latched,
  isModifierOrShiftLock,
  hasHoldGesture,
  onHoldPress,
  onHoldRelease,
  onTap,
}: KeyboardKeyButtonProps) => {
  const Icon = def.icon;
  const iconPx = Math.max(15, Math.round(keyFontPx * 1.35));
  const secondaryEl = showSecondary ? (
    <span
      className={cn(
        "text-[0.6rem] font-normal leading-none",
        // RUN/STOP: RUN and STOP are the same caution-tier action, so the
        // secondary legend inherits the key's own tone colour (e.g.
        // text-warning, set on the button itself) instead of being muted.
        // Every other secondary (digit/symbol shift-legends, the merged
        // edit/cursor/function keys) keeps the existing muted-gray hint look.
        def.secondaryMatchesToneColor ? undefined : "text-muted-foreground",
      )}
      aria-hidden="true"
    >
      {def.secondary}
    </span>
  ) : def.reserveSecondarySlot ? (
    // No real shifted legend, but reserve its exact line height (an invisible
    // 0.6rem line) so the main label lines up with sibling keys that do carry
    // one — e.g. "0" dropping to sit level with "1"-"9".
    <span className="text-[0.6rem] font-normal leading-none" aria-hidden="true" style={{ visibility: "hidden" }}>
      {" "}
    </span>
  ) : null;
  const isMultiline = label.includes("\n");
  const mainEl = (
    <span
      style={{
        // Explicit two-line labels (e.g. "SHIFT\nLOCK") keep exactly their own
        // break and NEVER re-wrap: `pre` preserves the newline without allowing
        // a soft wrap that would split a line mid-word on a narrow (1u) key
        // (`pre-line` did, turning "SHFT LOCK" into a clipped "SH/T/LOC/K").
        // Everything else stays on one line.
        whiteSpace: isMultiline ? "pre" : "nowrap",
        // A stacked two-line label has to fit its widest line inside a single
        // 1u key, so it renders a step smaller than a single-glyph key.
        fontSize: isMultiline ? Math.max(8, keyFontPx - 2) : keyFontPx,
        fontWeight: 600,
        lineHeight: 1.05,
      }}
    >
      {label}
    </span>
  );
  return (
    <KeyHoldButton
      size="sm"
      variant={variant}
      className={cn(
        "min-w-0 overflow-hidden px-1",
        grow ? "flex-1" : undefined,
        // `fill` always makes the key occupy its wrapper's full WIDTH (so the
        // wrapper's flex-grow sizing wins over the button's intrinsic text
        // width). HEIGHT is only filled (`h-full`) when no explicit height is
        // given — the expanded rows DO pass a fixed `heightPx`, and letting
        // `h-full` win there is exactly what made every row size to its own
        // content (ragged heights, F-keys collapsing to one text line). With a
        // fixed height instead, every expanded key is identical height and
        // top-aligned, and the F-key column lines up row-for-row.
        fill ? (heightPx === undefined ? "h-full w-full flex-1" : "w-full flex-1") : undefined,
        toneClassName,
      )}
      style={{
        height: heightPx,
        minWidth: 30,
        flexBasis: grow ? 0 : undefined,
        // A key with span:2 (CTRL/SHIFT/RESTORE/RETURN/merged F-keys on the
        // expanded profile) grows twice as much as an ordinary span-1
        // sibling within the same flex row, shrinking the others to make
        // room — see keyboardLayout.ts's KeyDef.span doc comment.
        flexGrow: grow ? (def.span ?? 1) : undefined,
      }}
      data-testid={def.testId}
      data-key-height={heightPx}
      aria-label={def.ariaLabel}
      aria-pressed={isModifierOrShiftLock ? latched : undefined}
      disabled={disabled}
      title={disabled ? UNAVAILABLE_KEY_HINT : undefined}
      onHoldPress={hasHoldGesture ? () => onHoldPress(def) : undefined}
      onHoldRelease={hasHoldGesture ? () => onHoldRelease(def) : undefined}
      onTap={() => onTap(def)}
    >
      {Icon ? (
        <Icon style={{ width: iconPx, height: iconPx }} />
      ) : def.cursorArrows ? (
        // The real C64 cursor keycap: "CRSR" in the middle (same size as
        // every other key's label) with a very small arrow above and
        // another below, centered and never overlapping the label.
        <span className="flex flex-col items-center justify-center leading-none">
          <span className="text-[0.5rem] leading-none text-muted-foreground" aria-hidden="true">
            {def.cursorArrows.above}
          </span>
          {mainEl}
          <span className="text-[0.5rem] leading-none text-muted-foreground" aria-hidden="true">
            {def.cursorArrows.below}
          </span>
        </span>
      ) : def.secondaryPosition === "below" ? (
        // Merged expanded function keys: main "fN" on top, the shifted "fN+1"
        // stacked directly beneath it as a smaller muted legend (secondaryEl is
        // already muted for these keys, so the shift half reads clearly).
        <span className="flex flex-col items-center leading-none">
          {mainEl}
          {secondaryEl}
        </span>
      ) : (
        <span className="flex flex-col items-center leading-none">
          {secondaryEl}
          {mainEl}
        </span>
      )}
    </KeyHoldButton>
  );
};
const KeyboardKeyButton = memo(KeyboardKeyButtonImpl);

const toneVariant = (tone: KeyTone | undefined, latched: boolean): "default" | "secondary" | "outline" => {
  if (tone === "modifier") return latched ? "default" : "secondary";
  // SHIFT/SHIFT-LOCK keep a light base so their primary colour reads; the latch
  // ring (toneButtonClass) marks the active state.
  if (tone === "shift" || tone === "character" || tone === "function-primary") return "outline";
  if (tone === "action" || tone === "edit" || tone === "function" || tone === "caution" || tone === "danger") {
    return "secondary";
  }
  return "outline";
};

/**
 * The profile-aware Keys-tab keyboard. One declarative layout model
 * (`keyboardLayout`) drives three renderings — compact/medium as a pinned
 * high-value deck (cursor pad + immediate/edit/function/system groups) above a
 * scrollable alphanumeric grid, expanded as the physical C64 rows — and one
 * shared `dispatch` routes EVERY key through the same session handlers, so no
 * behaviour is duplicated per profile. SHIFT/CBM/CTRL latch on tap and apply
 * to the next ordinary key, then auto-clear (SHIFT LOCK latches persistently);
 * the high-value shifted operations (CLR, INS, the cursor keys, F2/4/6/8) are
 * atomic one-tap actions that never depend on a latch and never leave a modifier
 * stuck.
 */
export const TypeKeyboard = ({
  onChar,
  onKey,
  onCursor,
  onSpecialKey,
  tier,
  heldKeyboardInputs,
  onHeldKeyboardInputsChange,
  profile: profileOverride,
  className,
}: TypeKeyboardProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  // Kernal-fallback tier only (no held-set relay exists below full tier): the
  // original one-shot latch, applied to the next ordinary key then cleared.
  const [activeModifiers, setActiveModifiers] = useState<ReadonlySet<StickyModifier>>(new Set());
  // SHIFT LOCK: a persistent shift, separate from the one-shot `activeModifiers`
  // latch so it survives key presses (and mode/keyboard remounts reset it).
  const [shiftLocked, setShiftLocked] = useState(false);
  // Full tier: real press/release relay, mirroring the joystick's held-set
  // architecture. SHIFT/CTRL/C= support both a genuine physical hold-and-chord
  // and today's tap-then-tap one-shot convenience (see the hook's doc comment).
  const holdDispatch = useKeyboardHoldDispatch(heldKeyboardInputs, onHeldKeyboardInputsChange);
  const isFullTier = tier === "full";

  // Full-tier hold/release/tap, hoisted to stable top-level callbacks (see
  // KeyboardKeyButtonImpl's doc comment): each depends only on holdDispatch's
  // methods, which are themselves permanently stable (useKeyboardHoldDispatch
  // reads current state via refs), so these never change identity across a
  // TypeKeyboard re-render. Cursor keys resolve to `null` from
  // resolveOrdinaryKeyInputs and are handled inline via `onCursor` directly —
  // NOT via the (unstable, kernal-fallback-only) `dispatch` — so pulling
  // `dispatch` into these deps doesn't reintroduce an unstable identity for
  // every ordinary key. `dispatch`'s own no-op modifier-latch clear for a
  // cursor tap in full tier (activeModifiers is always empty there) means
  // calling onCursor directly here is behaviourally identical. Declared
  // before the auth-required early return below (rules-of-hooks: every hook
  // must run unconditionally on every render).
  const handleKeyHoldPress = useCallback(
    (def: KeyDef) => {
      if (def.action.kind === "modifier") {
        vibrateTap(8);
        holdDispatch.pressModifier(def.action.modifier);
        return;
      }
      const inputs = resolveOrdinaryKeyInputs(def);
      if (inputs) {
        vibrateTap(10);
        holdDispatch.pressKey(inputs);
      }
    },
    [holdDispatch.pressModifier, holdDispatch.pressKey],
  );

  const handleKeyHoldRelease = useCallback(
    (def: KeyDef) => {
      if (def.action.kind === "modifier") {
        holdDispatch.releaseModifier(def.action.modifier);
        return;
      }
      const inputs = resolveOrdinaryKeyInputs(def);
      if (inputs) holdDispatch.releaseKey(inputs);
    },
    [holdDispatch.releaseModifier, holdDispatch.releaseKey],
  );

  const handleKeyTap = useCallback(
    (def: KeyDef) => {
      if (def.action.kind === "modifier") {
        vibrateTap(8);
        holdDispatch.pressModifier(def.action.modifier);
        holdDispatch.releaseModifier(def.action.modifier);
        return;
      }
      if (def.action.kind === "shift_lock") {
        vibrateTap(8);
        holdDispatch.toggleShiftLock();
        return;
      }
      if (def.action.kind === "cursor") {
        vibrateTap(10);
        // The expanded profile's merged cursor keys (CURSOR_UP_DOWN_MERGED /
        // CURSOR_LEFT_RIGHT_MERGED) encode only the unshifted direction in
        // their action; holding SHIFT while tapping reaches the physical
        // key's other (shifted) direction - purely a UI-layer choice of
        // WHICH direction to report, since onCursor/sendCursor already
        // handles both correctly (real wire shift-composition, and a
        // dedicated PETSCII byte per direction on the fallback tier).
        const shiftHeld = holdDispatch.isModifierActive("left_shift");
        onCursor(shiftHeld ? CURSOR_SHIFT_COMPLEMENT[def.action.direction] : def.action.direction);
        return;
      }
      // char/key/special all resolve to a non-null chord in practice (every
      // real KeyDef in keyboardLayout.ts maps to one) - only `cursor` (handled
      // above) legitimately returns null here, so there is deliberately no
      // `dispatch(def)` fallback: adding one would pull the unstable
      // kernal-fallback `dispatch` into this callback's deps and defeat the
      // per-key memoization for every ordinary key, to cover a branch that
      // never actually executes.
      const inputs = resolveOrdinaryKeyInputs(def);
      if (inputs) {
        vibrateTap(10);
        holdDispatch.pressKey(inputs);
        holdDispatch.releaseKey(inputs);
      }
    },
    [
      holdDispatch.pressModifier,
      holdDispatch.releaseModifier,
      holdDispatch.toggleShiftLock,
      holdDispatch.pressKey,
      holdDispatch.releaseKey,
      onCursor,
    ],
  );

  // Measure the available Type-tab content box and derive the profile from it
  // (width AND height), so the layout adapts to real space rather than a device
  // name. Falls back to `medium` until first measured / when unavailable.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setMeasured({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Lead F3: the fallback keyboard-buffer injection needs the same
  // authenticated REST calls the capability probe already failed with
  // 403 on - every key here would silently fail per keystroke, so show why
  // instead of a keyboard that looks live but cannot send anything.
  if (tier === "auth-required") {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 px-4 text-center",
          className,
        )}
        data-testid="remote-input-type-keyboard"
      >
        <p className="text-sm text-muted-foreground" data-testid="remote-input-auth-required-hint">
          {REMOTE_INPUT_AUTH_REQUIRED_HINT}
        </p>
      </div>
    );
  }

  const profile = profileOverride ?? resolveKeyboardProfile(measured.width, measured.height);
  const layout = getKeyboardLayout(profile);

  // Keys with no kernal-fallback equivalent (RUN/STOP, RESTORE, C=, CTRL) are
  // shown but disabled when the device lacks machine:input, with a plain-language
  // reason (footer + per-key tooltip) rather than REST/firmware jargon.
  const keyUnavailable = (def: KeyDef) => def.requiresFullTier === true && tier !== "full";
  const anyKeyUnavailable =
    tier !== "full" &&
    (layout.kind === "deck" ? layout.system.some(keyUnavailable) : layout.rows.flat().some(keyUnavailable));

  const cursorSizePx = measured.width > 0 ? Math.max(132, Math.min(210, Math.round(measured.width * 0.44))) : 150;
  // Expanded profile only: the physical C64's proportions, measured off a real
  // unit. The main rows (a 16-unit grid), a gap, and the function-key cluster
  // (~3u wide) sit side by side, so the content width splits as
  // 16 : EXPANDED_FUNCTION_GAP_UNITS : EXPANDED_FUNCTION_UNITS. The function
  // column lives in its OWN flex sibling (not a shared row), so its width and
  // the gap to it are computed as exact pixels here rather than a `span`.
  const CONTAINER_PADDING_PX = 8; // this container's own px-1 (4px each side)
  const ROW_GAP_PX = 4; // Tailwind's `gap-1` (0.25rem) between keys within a row
  const EXPANDED_TOTAL_UNITS = EXPANDED_ROW_UNITS + EXPANDED_FUNCTION_GAP_UNITS + EXPANDED_FUNCTION_UNITS;
  const contentWidthPx = measured.width > 0 ? Math.max(0, measured.width - CONTAINER_PADDING_PX) : 0;
  const functionBoxWidthPx =
    contentWidthPx > 0 ? (contentWidthPx * EXPANDED_FUNCTION_UNITS) / EXPANDED_TOTAL_UNITS : 112;
  const functionGapPx = contentWidthPx > 0 ? (contentWidthPx * EXPANDED_FUNCTION_GAP_UNITS) / EXPANDED_TOTAL_UNITS : 8;
  const rowsColumnWidthPx = (contentWidthPx * EXPANDED_ROW_UNITS) / EXPANDED_TOTAL_UNITS;
  // RETURN must match the combined width of the two merged CRSR keys directly
  // beneath it, INCLUDING the gap-1 between them — a plain flex-grow span ratio
  // can't express that extra internal gap. Row 4 (the CRSR row) has 16 keys /
  // 15 gaps, so its unit width is (rows-column width − 15 gaps) / 16; RETURN =
  // two of those units plus the one gap the CRSR pair straddles. Falls back to
  // the (very close but not exact) RETURN span ratio until first measured.
  const row4UnitWidthPx = rowsColumnWidthPx > 0 ? (rowsColumnWidthPx - 15 * ROW_GAP_PX) / EXPANDED_ROW_UNITS : 0;
  const returnWidthPx = row4UnitWidthPx > 0 ? 2 * row4UnitWidthPx + ROW_GAP_PX : undefined;
  const gridKeyHeightPx = profile === "compact" ? 40 : 38;
  const deckKeyHeightPx = 42;
  // The special keys (edit + system: CLR/HOME/INS/DEL, RUN-STOP/SHIFT-LOCK/
  // RESTORE/C=/CTRL/SHIFT) render taller than the character grid so they are
  // easy to hit and read.
  const systemKeyHeightPx = 54;
  // The expanded layout packs a full C64's worth of ~1u keys per row, so its
  // labels get a smaller font; the deck profiles have roomier keys. Labels
  // never wrap (nowrap), so long ones stay on one line instead of breaking into
  // "RES/TOR/E". 10px keeps the widest single-key labels (RESTORE at 1.5u,
  // RETURN at 2u) clear of the key borders at the authentic 1u key width.
  const keyFontPx = profile === "expanded" ? 10 : 13;

  const toggleModifier = (modifier: StickyModifier) => {
    vibrateTap(8);
    setActiveModifiers((prev) => {
      const next = new Set(prev);
      if (next.has(modifier)) next.delete(modifier);
      else next.add(modifier);
      return next;
    });
  };

  const toggleShiftLock = () => {
    vibrateTap(8);
    setShiftLocked((locked) => !locked);
  };

  // Kernal-fallback tier only: no held-set relay exists below full tier, so
  // this is the original one-shot-latch dispatch, untouched.
  const dispatch = (def: KeyDef) => {
    const action = def.action;
    if (action.kind === "modifier") {
      toggleModifier(action.modifier);
      return;
    }
    if (action.kind === "shift_lock") {
      toggleShiftLock();
      return;
    }
    vibrateTap(10);
    switch (action.kind) {
      case "char":
        onChar(action.char);
        break;
      case "key": {
        // One-shot latches plus the persistent SHIFT LOCK, deduped by the Set.
        const modifiers = new Set<StickyModifier>(activeModifiers);
        if (shiftLocked) modifiers.add("left_shift");
        onKey([...action.inputs, ...modifiers]);
        break;
      }
      case "cursor": {
        // HARD19-001: the expanded profile's merged CRSR keys encode only the
        // unshifted direction (down/right). Honor a pending SHIFT latch / SHIFT
        // LOCK so cursor up/left are reachable on the kernal-fallback tier too
        // (sendCursor sends a dedicated PETSCII byte per direction). The latch is
        // still consumed by the clear below, mirroring the full-tier handler.
        const shiftHeld = activeModifiers.has("left_shift") || shiftLocked;
        onCursor(shiftHeld ? CURSOR_SHIFT_COMPLEMENT[action.direction] : action.direction);
        break;
      }
      case "special":
        onSpecialKey(action.key);
        break;
    }
    // Any ordinary key consumes a one-shot modifier latch, so SHIFT/CBM/CTRL
    // apply to exactly the next key and never stick. SHIFT LOCK is intentionally
    // NOT cleared here — it persists until the user toggles it off.
    if (activeModifiers.size > 0) setActiveModifiers(new Set());
  };

  const renderKey = (def: KeyDef, options: { heightPx?: number; grow?: boolean; fill?: boolean } = {}) => {
    const isModifier = def.action.kind === "modifier";
    const isShiftLock = def.action.kind === "shift_lock";
    const modifier = isModifier ? (def.action as { modifier: StickyModifier }).modifier : undefined;
    const latched = isFullTier
      ? (modifier !== undefined && holdDispatch.isModifierActive(modifier)) || (isShiftLock && holdDispatch.shiftLocked)
      : (modifier !== undefined && activeModifiers.has(modifier)) || (isShiftLock && shiftLocked);
    const disabled = keyUnavailable(def);
    // Only the expanded profile packs keys tightly enough to need the short cap
    // (RESTORE -> "REST."); compact and medium both have room for the full word,
    // so they render `label` as-is.
    const label = profile === "expanded" && def.compactLabel ? def.compactLabel : def.label;
    // Shifted legend printed ABOVE the main label (smaller, fainter) like a real
    // C64 keycap. Hidden on compact, and never shown on pictographic keys.
    const showSecondary =
      Boolean(def.secondary) && !def.icon && (profile !== "compact" || def.secondaryAlwaysVisible === true);

    // Full tier: real hold for modifiers and ordinary keys alike; SHIFT LOCK
    // and cursor keys stay tap-only (no hold gesture — cursor's repeat-on-hold
    // lives in the dedicated CursorPad). Below full tier there is no held-set
    // relay, so every key falls back to the original one-shot `dispatch`
    // (intentionally NOT memo-friendly — a separate, lower-traffic tier).
    const hasHoldGesture =
      isFullTier && !isShiftLock && (modifier !== undefined || resolveOrdinaryKeyInputs(def) !== null);

    return (
      <KeyboardKeyButton
        key={def.id}
        def={def}
        variant={toneVariant(def.tone, latched)}
        toneClassName={toneButtonClass(def.tone, latched)}
        // An explicit `heightPx` always wins, even alongside `fill` (the
        // expanded rows rely on this for a single uniform key height). Only a
        // `fill` with NO explicit height stretches to the wrapper (`h-full`);
        // everything else falls back to the deck default.
        heightPx={options.heightPx ?? (options.fill ? undefined : deckKeyHeightPx)}
        grow={options.grow}
        fill={options.fill}
        label={label}
        showSecondary={showSecondary}
        keyFontPx={keyFontPx}
        disabled={disabled}
        latched={latched}
        isModifierOrShiftLock={isModifier || isShiftLock}
        hasHoldGesture={hasHoldGesture}
        onHoldPress={isFullTier ? handleKeyHoldPress : dispatch}
        onHoldRelease={isFullTier ? handleKeyHoldRelease : dispatch}
        onTap={isFullTier ? handleKeyTap : dispatch}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      // px-1 keeps the leftmost/rightmost keys off the sheet edge so their
      // labels are never clipped (the sheet body itself is edge-to-edge).
      className={cn("flex h-full min-h-0 w-full flex-col gap-2 px-1", className)}
      data-testid="remote-input-type-keyboard"
      data-profile={profile}
    >
      {layout.kind === "deck" ? (
        // The WHOLE keyboard scrolls as one surface (deck + grid together), so on
        // short viewports every key is reachable by scrolling instead of only the
        // sliver beneath the system row. The bottom padding keeps the last row
        // clear of the sheet's bottom action bar.
        <div
          className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-6 pr-0.5"
          data-testid="remote-input-keyboard-scroll"
        >
          {/* Scroll order for the 8020: cursor pad + immediate RETURN/SPACE, then
              the function keys, then the high-value special keys (edit + system)
              directly below them, then the character grid, and finally a second
              full-width SPACE anchored at the very bottom. */}
          <div className="flex flex-col gap-2" data-testid="remote-input-keyboard-deck">
            {/* Cursor pad (largest, visually isolated) + immediate RETURN/SPACE beside it. */}
            <div className="flex items-stretch gap-3">
              <div className="shrink-0" data-testid="remote-input-cursor-pad-group">
                <CursorPad onCursor={onCursor} sizePx={cursorSizePx} />
              </div>
              <div
                className="flex min-w-0 flex-1 flex-col gap-2"
                data-testid="remote-input-keyboard-immediate"
                style={{ height: cursorSizePx }}
              >
                {layout.immediate.map((def) => (
                  <div key={def.id} className="flex min-h-0 flex-1">
                    {renderKey(def, { fill: true })}
                  </div>
                ))}
              </div>
            </div>

            {/* Divider: a clear boundary so a shaky cursor tap cannot reach the
                function keys below. */}
            <div className="border-t border-border" role="separator" />

            {/* Function keys — always two rows (F1–F4 / F5–F8) on compact and medium. */}
            <div className="flex flex-col gap-1" data-testid="remote-input-keyboard-function">
              {chunk(layout.functionKeys, 4).map((row, rowIndex) => (
                <div key={rowIndex} className="flex gap-1">
                  {row.map((def) => renderKey(def, { heightPx: deckKeyHeightPx, grow: true }))}
                </div>
              ))}
            </div>

            {/* High-value special keys, larger and immediately below the F-keys.
                Edit row, then the system keys split into two rows: RUN/STOP,
                SHIFT-LOCK, RESTORE / C=, CTRL, SHIFT. */}
            <div className="flex flex-wrap gap-1" data-testid="remote-input-keyboard-edit">
              {layout.edit.map((def) => renderKey(def, { heightPx: systemKeyHeightPx, grow: true }))}
            </div>
            <div className="flex flex-col gap-1" data-testid="remote-input-keyboard-system">
              {chunk(layout.system, 3).map((row, rowIndex) => (
                <div key={rowIndex} className="flex gap-1">
                  {row.map((def) => renderKey(def, { heightPx: systemKeyHeightPx, grow: true }))}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border" role="separator" />

          <div className="space-y-1" data-testid="remote-input-keyboard-grid">
            {layout.grid.map((row, rowIndex) => (
              <div key={rowIndex} className="flex gap-1">
                {row.map((def) => renderKey(def, { heightPx: gridKeyHeightPx, grow: true }))}
              </div>
            ))}
          </div>

          {/* Bottom row: SHIFT (left) — a wide SPACE — RETURN (right). */}
          <div
            className="flex items-stretch gap-1"
            style={{ height: deckKeyHeightPx }}
            data-testid="remote-input-keyboard-bottom-row"
          >
            <div className="flex flex-1">{renderKey(layout.bottomRow[0], { fill: true })}</div>
            <div className="flex flex-[2]">{renderKey(layout.bottomRow[1], { fill: true })}</div>
            <div className="flex flex-1">{renderKey(layout.bottomRow[2], { fill: true })}</div>
          </div>
        </div>
      ) : (
        // Expanded: the physical C64 rows on the left; F1–F8 as a bounded box on
        // the right (shared X origin, uniform width/height) rather than tacked on
        // to the ragged ends of the main rows. The pb-6 keeps the last row clear
        // of the bottom action bar. HARD16-008: the flex spacers vertically CENTER
        // the block when the sheet is taller than the keyboard needs (tablet /
        // desktop), and collapse to zero on short viewports so the single-scroll
        // container behaviour (a3a185e0) is preserved.
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-6"
          data-testid="remote-input-keyboard-grid"
        >
          <div className="min-h-0 flex-1" aria-hidden="true" />
          <div className="flex shrink-0 items-start" style={{ gap: functionGapPx }}>
            <div className="min-w-0 flex-1 space-y-1">
              {layout.rows.map((row, rowIndex) => {
                const isSpaceRow = rowIndex === layout.rows.length - 1;
                if (isSpaceRow) {
                  // SPACE starts below the middle of Z and ends where "."
                  // ends, exactly like a real C64 keyboard - the leading/
                  // trailing <div>s are invisible spacers (not real keys)
                  // carrying the proportional width either side (see
                  // SPACE_ROW_*_SPAN's derivation in keyboardLayout.ts).
                  return (
                    <div key={rowIndex} className="flex gap-1">
                      <div aria-hidden="true" style={{ flexGrow: SPACE_ROW_LEADING_SPAN, flexBasis: 0, minWidth: 0 }} />
                      <div className="flex min-w-0" style={{ flexGrow: SPACE_ROW_SPAN, flexBasis: 0 }}>
                        {renderKey(row[0], { heightPx: gridKeyHeightPx, fill: true })}
                      </div>
                      <div
                        aria-hidden="true"
                        style={{ flexGrow: SPACE_ROW_TRAILING_SPAN, flexBasis: 0, minWidth: 0 }}
                      />
                    </div>
                  );
                }
                const isReturnRow = row[row.length - 1]?.id === "return";
                return (
                  <div key={rowIndex} className="flex gap-1">
                    {row.map((def, defIndex) => (
                      // A plain wrapper div (not the <button> itself) carries
                      // the flex-grow sizing: the button's OWN base styling is
                      // `inline-flex` + `white-space:nowrap`, which lets a
                      // key's text length/weight (e.g. bold "RESTORE" vs
                      // "CTRL") silently win over an explicit min-width and
                      // grab more than its fair share, throwing off every
                      // OTHER key's width in the same row (measured on real
                      // hardware - see the RETURN/RESTORE width bug this
                      // fixed). `fill` makes the button just occupy 100% of
                      // this wrapper instead, sidestepping that entirely.
                      // `flex` (not a plain block) makes the button a
                      // block-level flex child rather than an inline-flex box
                      // sitting in a baseline-aligned line box: without it,
                      // keys with taller content (2-line shift legends, the
                      // 3-line CRSR arrow stack) baseline-shift DOWN relative
                      // to single-glyph keys, so a row's keys no longer share
                      // one top edge. As a flex child every key top-aligns to
                      // the row regardless of its content height.
                      <div
                        key={def.id}
                        className="flex min-w-0"
                        style={
                          isReturnRow && defIndex === row.length - 1 && returnWidthPx !== undefined
                            ? { flexGrow: 0, flexShrink: 0, flexBasis: returnWidthPx }
                            : { flexGrow: def.span ?? 1, flexBasis: 0 }
                        }
                      >
                        {renderKey(def, { heightPx: gridKeyHeightPx, fill: true })}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div
              className="flex shrink-0 flex-col gap-1"
              style={{ width: functionBoxWidthPx }}
              data-testid="remote-input-keyboard-function"
            >
              {/* One merged key per row (F1/F2, F3/F4, F5/F6, F7/F8) - a single
                  column, mirroring the real C64's physical function-key
                  cluster and giving each key the box's full width. */}
              {layout.functionKeys.map((def) => (
                <div key={def.id} className="flex min-w-0 gap-1">
                  {renderKey(def, { heightPx: gridKeyHeightPx, fill: true })}
                </div>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1" aria-hidden="true" />
        </div>
      )}

      {anyKeyUnavailable ? (
        <p
          className="shrink-0 text-center text-xs text-muted-foreground"
          data-testid="remote-input-modifier-unavailable-hint"
        >
          {UNAVAILABLE_KEYS_FOOTER}
        </p>
      ) : null}
    </div>
  );
};
