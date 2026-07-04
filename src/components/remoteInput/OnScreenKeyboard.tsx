/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { KeyboardInputName } from "@/lib/c64api";
import type { SpecialKeyboardKey } from "@/lib/remoteInput/specialKeyMapping";

export type OnScreenKeyboardProps = {
  onKey: (inputs: KeyboardInputName[]) => void;
  onSpecialKey: (key: SpecialKeyboardKey) => void;
  tier: "full" | "kernal-fallback" | "auth-required";
  className?: string;
};

type StickyModifier = "left_shift" | "commodore" | "ctrl";

const CHAR_ROWS: ReadonlyArray<ReadonlyArray<{ label: string; key: KeyboardInputName }>> = [
  [
    { label: "1", key: "1" },
    { label: "2", key: "2" },
    { label: "3", key: "3" },
    { label: "4", key: "4" },
    { label: "5", key: "5" },
    { label: "6", key: "6" },
    { label: "7", key: "7" },
    { label: "8", key: "8" },
    { label: "9", key: "9" },
    { label: "0", key: "0" },
    { label: "+", key: "plus" },
    { label: "-", key: "minus" },
    { label: "£", key: "pound" },
    { label: "DEL", key: "inst_del" },
  ],
  [
    { label: "Q", key: "q" },
    { label: "W", key: "w" },
    { label: "E", key: "e" },
    { label: "R", key: "r" },
    { label: "T", key: "t" },
    { label: "Y", key: "y" },
    { label: "U", key: "u" },
    { label: "I", key: "i" },
    { label: "O", key: "o" },
    { label: "P", key: "p" },
    { label: "@", key: "at" },
    { label: "*", key: "star" },
    { label: "↑", key: "arrow_up" },
  ],
  [
    { label: "A", key: "a" },
    { label: "S", key: "s" },
    { label: "D", key: "d" },
    { label: "F", key: "f" },
    { label: "G", key: "g" },
    { label: "H", key: "h" },
    { label: "J", key: "j" },
    { label: "K", key: "k" },
    { label: "L", key: "l" },
    { label: ":", key: "colon" },
    { label: ";", key: "semicolon" },
    { label: "=", key: "equals" },
    { label: "RETURN", key: "return" },
  ],
  [
    { label: "Z", key: "z" },
    { label: "X", key: "x" },
    { label: "C", key: "c" },
    { label: "V", key: "v" },
    { label: "B", key: "b" },
    { label: "N", key: "n" },
    { label: "M", key: "m" },
    { label: ",", key: "comma" },
    { label: ".", key: "period" },
    { label: "/", key: "slash" },
    { label: "↓/↑", key: "cursor_up_down" },
    { label: "→/←", key: "cursor_left_right" },
  ],
];

const MODIFIER_UNAVAILABLE_ON_FALLBACK: ReadonlySet<StickyModifier> = new Set(["commodore", "ctrl"]);

/**
 * The faithful on-screen C64 keyboard: full physical layout, sticky
 * SHIFT/CBM/CTRL (latch on tap, apply to the next key, then auto-clear) — the
 * primary Type surface per HARD12-017 (the Android IME is fast-ASCII
 * convenience only, since it cannot express RUN/STOP, RESTORE, the Commodore
 * key, CTRL, or PETSCII graphics). Reachable by touch and, via the app's
 * existing focus-ring auto-discovery, by physical D-pad/T9 navigation too.
 */
export const OnScreenKeyboard = ({ onKey, onSpecialKey, tier, className }: OnScreenKeyboardProps) => {
  const [activeModifiers, setActiveModifiers] = useState<ReadonlySet<StickyModifier>>(new Set());

  const toggleModifier = (modifier: StickyModifier) => {
    const next = new Set(activeModifiers);
    if (next.has(modifier)) next.delete(modifier);
    else next.add(modifier);
    setActiveModifiers(next);
  };

  const pressCharKey = (key: KeyboardInputName) => {
    onKey([key, ...activeModifiers]);
    setActiveModifiers(new Set());
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="remote-input-on-screen-keyboard">
      {CHAR_ROWS.map((row, rowIndex) => (
        <div key={rowIndex} className="flex flex-wrap justify-center gap-1">
          {row.map(({ label, key }) => (
            <Button
              key={key}
              size="sm"
              variant="outline"
              className="min-w-9"
              data-testid={`remote-input-key-${key}`}
              onClick={() => pressCharKey(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap justify-center gap-1">
        <Button
          size="sm"
          variant={activeModifiers.has("ctrl") ? "default" : "secondary"}
          data-testid="remote-input-key-ctrl"
          disabled={tier !== "full"}
          title={tier !== "full" ? "CTRL requires machine:input firmware support" : undefined}
          onClick={() => toggleModifier("ctrl")}
        >
          CTRL
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="remote-input-key-restore"
          onClick={() => onSpecialKey("restore")}
        >
          RESTORE
        </Button>
        <Button
          size="sm"
          variant={activeModifiers.has("left_shift") ? "default" : "secondary"}
          data-testid="remote-input-key-shift"
          onClick={() => toggleModifier("left_shift")}
        >
          SHIFT
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="remote-input-key-space"
          onClick={() => pressCharKey("space")}
        >
          SPACE
        </Button>
        <Button
          size="sm"
          variant={activeModifiers.has("commodore") ? "default" : "secondary"}
          data-testid="remote-input-key-commodore"
          disabled={tier !== "full"}
          title={tier !== "full" ? "Commodore key requires machine:input firmware support" : undefined}
          onClick={() => toggleModifier("commodore")}
        >
          C=
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="remote-input-key-run-stop"
          onClick={() => onSpecialKey("run_stop")}
        >
          RUN/STOP
        </Button>
        {(["f1", "f3", "f5", "f7"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant="secondary"
            data-testid={`remote-input-key-${key}`}
            onClick={() => onSpecialKey(key)}
          >
            {key.toUpperCase()}
          </Button>
        ))}
      </div>
      {[...activeModifiers].some((modifier) => MODIFIER_UNAVAILABLE_ON_FALLBACK.has(modifier)) && tier !== "full" ? (
        <p className="text-center text-xs text-muted-foreground" data-testid="remote-input-modifier-unavailable-hint">
          CTRL/C= need Ultimate firmware with machine:input support.
        </p>
      ) : null}
    </div>
  );
};
