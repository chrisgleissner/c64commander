/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CursorDirection } from "@/lib/remoteInput/cursorKeyMapping";
import type { SpecialKeyboardKey } from "@/lib/remoteInput/specialKeyMapping";

export type QuickKeysBarProps = {
  onChar: (char: string) => void;
  onCursor: (direction: CursorDirection) => void;
  onSpecialKey: (key: SpecialKeyboardKey) => void;
  className?: string;
};

/**
 * Always-visible in both output modes: one tap covers "jumping game intro
 * screens" (SPACE/RETURN) and most high-score confirms without opening the
 * full on-screen keyboard.
 */
export const QuickKeysBar = ({ onChar, onCursor, onSpecialKey, className }: QuickKeysBarProps) => (
  <div
    className={cn("flex flex-wrap items-center justify-center gap-1.5", className)}
    data-testid="remote-input-quick-keys-bar"
  >
    <Button size="sm" variant="secondary" data-testid="remote-input-key-space" onClick={() => onChar(" ")}>
      SPACE
    </Button>
    <Button size="sm" variant="secondary" data-testid="remote-input-key-return" onClick={() => onChar("\n")}>
      RETURN
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
    <div className="flex items-center gap-1">
      <Button size="icon" variant="secondary" data-testid="remote-input-key-cursor-up" onClick={() => onCursor("up")}>
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        data-testid="remote-input-key-cursor-down"
        onClick={() => onCursor("down")}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        data-testid="remote-input-key-cursor-left"
        onClick={() => onCursor("left")}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        data-testid="remote-input-key-cursor-right"
        onClick={() => onCursor("right")}
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  </div>
);
