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
import { toneButtonClass } from "@/lib/remoteInput/keyTone";
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

const toneVariant = (tone: KeyTone | undefined, latched: boolean): "default" | "secondary" | "outline" => {
  if (tone === "modifier") return latched ? "default" : "secondary";
  // SHIFT/SHIFT-LOCK keep a light base so their violet colour reads; the latch
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
  const gridKeyHeightPx = profile === "compact" ? 40 : 38;
  const deckKeyHeightPx = 42;
  // The special keys (edit + system: CLR/HOME/INS/DEL, RUN-STOP/SHIFT-LOCK/
  // RESTORE/C=/CTRL/SHIFT) render taller than the character grid so they are
  // easy to hit and read.
  const systemKeyHeightPx = 54;
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
    const disabled = keyUnavailable(def);
    // Only the expanded profile packs keys tightly enough to need the short cap
    // (RESTORE -> "REST."); compact and medium both have room for the full word,
    // so they render `label` as-is.
    const label = profile === "expanded" && def.compactLabel ? def.compactLabel : def.label;
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
        title={disabled ? UNAVAILABLE_KEY_HINT : undefined}
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
          <div className="flex shrink-0 items-start gap-2">
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
