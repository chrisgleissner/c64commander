/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { vibrateTap } from "@/lib/remoteInput/haptics";
import { CursorPad } from "@/components/remoteInput/CursorPad";
import { resolveKeyboardProfile, type KeyboardProfile } from "@/lib/remoteInput/keyboardProfile";
import { getKeyboardLayout, type KeyDef, type KeyTone, type StickyModifier } from "@/lib/remoteInput/keyboardLayout";
import type { KeyboardInputName } from "@/lib/c64api";
import type { CursorDirection } from "@/lib/remoteInput/cursorKeyMapping";
import type { SpecialKeyboardKey } from "@/lib/remoteInput/specialKeyMapping";

export type TypeKeyboardTier = "full" | "kernal-fallback" | "auth-required";

export type TypeKeyboardProps = {
  onChar: (char: string) => void;
  onKey: (inputs: KeyboardInputName[]) => void;
  onCursor: (direction: CursorDirection) => void;
  onSpecialKey: (key: SpecialKeyboardKey) => void;
  tier: TypeKeyboardTier;
  /** Test/preview seam: force a profile instead of measuring the content box. */
  profile?: KeyboardProfile;
  className?: string;
};

const FULL_TIER_HINT = "Requires Ultimate firmware with machine:input support";

/** Splits a list into fixed-size groups (used to lay the F-keys out two per row). */
const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
};

const toneButtonClass = (tone: KeyTone | undefined, latched: boolean): string => {
  switch (tone) {
    case "danger":
      // RESTORE — shape (double solid border) + colour, never colour alone.
      return "border-2 border-destructive text-destructive font-semibold";
    case "caution":
      // RUN/STOP — shape (dashed border) + colour, kept clear of the cursor pad.
      return "border-2 border-dashed border-amber-500 text-amber-600 dark:border-amber-400 dark:text-amber-300";
    case "modifier":
      return latched ? "ring-2 ring-primary" : "";
    default:
      return "";
  }
};

const toneVariant = (tone: KeyTone | undefined, latched: boolean): "default" | "secondary" | "outline" => {
  if (tone === "modifier") return latched ? "default" : "secondary";
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
  profile: profileOverride,
  className,
}: TypeKeyboardProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [activeModifiers, setActiveModifiers] = useState<ReadonlySet<StickyModifier>>(new Set());
  // SHIFT LOCK: a persistent shift, separate from the one-shot `activeModifiers`
  // latch so it survives key presses (and mode/keyboard remounts reset it).
  const [shiftLocked, setShiftLocked] = useState(false);

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

  const profile = profileOverride ?? resolveKeyboardProfile(measured.width, measured.height);
  const layout = getKeyboardLayout(profile);

  const cursorSizePx = measured.width > 0 ? Math.max(132, Math.min(210, Math.round(measured.width * 0.44))) : 150;
  const gridKeyHeightPx = profile === "compact" ? 40 : 38;
  const deckKeyHeightPx = 42;
  // The expanded layout packs ~18 keys per row, so its labels get a smaller
  // font; the deck profiles have roomier keys. Labels never wrap (nowrap), so
  // long ones stay on one line instead of breaking into "RES/TOR/E".
  const keyFontPx = profile === "expanded" ? 11 : 13;

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

  // The single shared dispatch path for every key in every profile.
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
      case "cursor":
        onCursor(action.direction);
        break;
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
    const latched =
      (isModifier && activeModifiers.has((def.action as { modifier: StickyModifier }).modifier)) ||
      (isShiftLock && shiftLocked);
    const disabled = def.requiresFullTier === true && tier !== "full";
    const label = profile === "compact" && def.compactLabel ? def.compactLabel : def.label;
    const Icon = def.icon;
    const iconPx = Math.max(15, Math.round(keyFontPx * 1.35));
    // Shifted legend printed ABOVE the main label (smaller, fainter) like a real
    // C64 keycap. Hidden on compact, and never shown on pictographic keys.
    const showSecondary = profile !== "compact" && Boolean(def.secondary) && !Icon;

    return (
      <Button
        key={def.id}
        size="sm"
        variant={toneVariant(def.tone, latched)}
        className={cn(
          "min-w-0 overflow-hidden px-1",
          options.grow ? "flex-1" : undefined,
          options.fill ? "h-full w-full flex-1" : undefined,
          toneButtonClass(def.tone, latched),
        )}
        style={{
          height: options.fill ? undefined : (options.heightPx ?? deckKeyHeightPx),
          minWidth: 30,
          flexBasis: options.grow ? 0 : undefined,
        }}
        data-testid={def.testId}
        data-key-height={options.fill ? undefined : (options.heightPx ?? deckKeyHeightPx)}
        aria-label={def.ariaLabel}
        aria-pressed={isModifier || isShiftLock ? latched : undefined}
        disabled={disabled}
        title={disabled ? FULL_TIER_HINT : undefined}
        onClick={() => dispatch(def)}
      >
        {Icon ? (
          <Icon style={{ width: iconPx, height: iconPx }} />
        ) : (
          <span className="flex flex-col items-center leading-none">
            {showSecondary ? (
              <span className="text-[0.6rem] font-normal leading-none text-muted-foreground" aria-hidden="true">
                {def.secondary}
              </span>
            ) : null}
            <span
              style={{
                // Explicit two-line labels (e.g. "RUN\nSTOP") keep their break;
                // everything else stays on one line rather than wrapping.
                whiteSpace: label.includes("\n") ? "pre-line" : "nowrap",
                fontSize: keyFontPx,
                fontWeight: 600,
                lineHeight: 1.05,
              }}
            >
              {label}
            </span>
          </span>
        )}
      </Button>
    );
  };

  const anyFullTierGated =
    tier !== "full" &&
    (layout.kind === "deck"
      ? [...layout.system].some((k) => k.requiresFullTier)
      : [...layout.rows.flat(), ...layout.functionKeys].some((k) => k.requiresFullTier));

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
        <>
          {/* Pinned high-value deck — stays visible while the grid scrolls. */}
          <div className="flex shrink-0 flex-col gap-2" data-testid="remote-input-keyboard-deck">
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
                edit / system / modifier keys below. */}
            <div className="border-t border-border" role="separator" />

            <div className="flex flex-wrap gap-1" data-testid="remote-input-keyboard-edit">
              {layout.edit.map((def) => renderKey(def, { heightPx: deckKeyHeightPx, grow: true }))}
            </div>
            <div className="flex flex-wrap gap-1" data-testid="remote-input-keyboard-function">
              {layout.functionKeys.map((def) => renderKey(def, { heightPx: deckKeyHeightPx, grow: true }))}
            </div>
            <div className="flex flex-wrap gap-1" data-testid="remote-input-keyboard-system">
              {layout.system.map((def) => renderKey(def, { heightPx: deckKeyHeightPx, grow: true }))}
            </div>
          </div>

          <div className="border-t border-border" role="separator" />

          {/* Only the alphanumeric / symbol grid scrolls. The bottom padding keeps
              the last row clear of the persistent bottom action bar so every key
              stays comfortably reachable on small screens. */}
          <div
            className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pb-6 pr-0.5"
            data-testid="remote-input-keyboard-grid"
          >
            {layout.grid.map((row, rowIndex) => (
              <div key={rowIndex} className="flex gap-1">
                {row.map((def) => renderKey(def, { heightPx: gridKeyHeightPx, grow: true }))}
              </div>
            ))}
          </div>
        </>
      ) : (
        // Expanded: the physical C64 rows on the left; F1–F8 as a bounded box on
        // the right (shared X origin, uniform width/height) rather than tacked on
        // to the ragged ends of the main rows. The pb-6 keeps the last row clear
        // of the bottom action bar.
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6"
          data-testid="remote-input-keyboard-grid"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              {layout.rows.map((row, rowIndex) => (
                <div key={rowIndex} className="flex gap-1">
                  {row.map((def) => renderKey(def, { heightPx: gridKeyHeightPx, grow: true }))}
                </div>
              ))}
            </div>
            <div
              className="flex shrink-0 flex-col gap-1"
              style={{ width: 112 }}
              data-testid="remote-input-keyboard-function"
            >
              {chunk(layout.functionKeys, 2).map((pair, rowIndex) => (
                <div key={rowIndex} className="flex gap-1">
                  {pair.map((def) => renderKey(def, { heightPx: gridKeyHeightPx, grow: true }))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {anyFullTierGated ? (
        <p
          className="shrink-0 text-center text-xs text-muted-foreground"
          data-testid="remote-input-modifier-unavailable-hint"
        >
          RUN/STOP, RESTORE, CTRL and C= need Ultimate firmware with machine:input support.
        </p>
      ) : null}
    </div>
  );
};
