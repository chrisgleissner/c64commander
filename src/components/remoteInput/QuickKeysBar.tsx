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
import { vibrateTap } from "@/lib/remoteInput/haptics";
import type { CursorDirection } from "@/lib/remoteInput/cursorKeyMapping";
import type { SpecialKeyboardKey } from "@/lib/remoteInput/specialKeyMapping";

export type QuickKeysBarProps = {
  onChar: (char: string) => void;
  onCursor: (direction: CursorDirection) => void;
  onSpecialKey: (key: SpecialKeyboardKey) => void;
  tier: "full" | "kernal-fallback" | "auth-required";
  /** Control-size multiplier (shared remote-control size preference). */
  scale?: number;
  className?: string;
};

/**
 * Always-visible in both output modes: one tap covers "jumping game intro
 * screens" (SPACE/RETURN) and most high-score confirms without opening the
 * full on-screen keyboard. Keys scale with the shared control-size preference
 * and pulse haptically on press.
 */
export const QuickKeysBar = ({ onChar, onCursor, onSpecialKey, tier, scale = 1, className }: QuickKeysBarProps) => {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const keyStyle = { height: Math.round(40 * safeScale), fontSize: Math.round(13 * safeScale) };
  const iconStyle = { width: Math.round(40 * safeScale), height: Math.round(40 * safeScale) };
  const iconPx = Math.round(18 * safeScale);
  // Lead F3: every one of these keys routes through the kernal-fallback
  // injection on a non-full tier, which needs the exact same authenticated
  // REST calls the capability probe already failed with 403 on - unlike
  // RUN/STOP (gated below on the broader `tier !== "full"`, since it has no
  // fallback equivalent at all), these keys DO work on kernal-fallback, just
  // not on auth-required specifically.
  const authRequiredHint = "This device's password must be entered in Settings first";
  const disabledOnAuthRequired = tier === "auth-required";

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

  return (
    <div
      className={cn("flex flex-wrap items-center justify-center gap-1.5", className)}
      data-testid="remote-input-quick-keys-bar"
    >
      <Button
        size="sm"
        variant="secondary"
        style={keyStyle}
        data-testid="remote-input-key-space"
        disabled={disabledOnAuthRequired}
        title={disabledOnAuthRequired ? authRequiredHint : undefined}
        onClick={() => tapChar(" ")}
      >
        SPACE
      </Button>
      <Button
        size="sm"
        variant="secondary"
        style={keyStyle}
        data-testid="remote-input-key-return"
        disabled={disabledOnAuthRequired}
        title={disabledOnAuthRequired ? authRequiredHint : undefined}
        onClick={() => tapChar("\n")}
      >
        RETURN
      </Button>
      <Button
        size="sm"
        variant="secondary"
        style={keyStyle}
        data-testid="remote-input-key-run-stop"
        disabled={tier !== "full"}
        title={tier !== "full" ? "RUN/STOP requires machine:input firmware support" : undefined}
        onClick={() => tapSpecial("run_stop")}
      >
        RUN/STOP
      </Button>
      {(["f1", "f3", "f5", "f7"] as const).map((key) => (
        <Button
          key={key}
          size="sm"
          variant="secondary"
          style={keyStyle}
          data-testid={`remote-input-key-${key}`}
          disabled={disabledOnAuthRequired}
          title={disabledOnAuthRequired ? authRequiredHint : undefined}
          onClick={() => tapSpecial(key)}
        >
          {key.toUpperCase()}
        </Button>
      ))}
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="secondary"
          style={iconStyle}
          data-testid="remote-input-key-cursor-up"
          disabled={disabledOnAuthRequired}
          title={disabledOnAuthRequired ? authRequiredHint : undefined}
          onClick={() => tapCursor("up")}
        >
          <ArrowUp style={{ width: iconPx, height: iconPx }} />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          style={iconStyle}
          data-testid="remote-input-key-cursor-down"
          disabled={disabledOnAuthRequired}
          title={disabledOnAuthRequired ? authRequiredHint : undefined}
          onClick={() => tapCursor("down")}
        >
          <ArrowDown style={{ width: iconPx, height: iconPx }} />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          style={iconStyle}
          data-testid="remote-input-key-cursor-left"
          disabled={disabledOnAuthRequired}
          title={disabledOnAuthRequired ? authRequiredHint : undefined}
          onClick={() => tapCursor("left")}
        >
          <ArrowLeft style={{ width: iconPx, height: iconPx }} />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          style={iconStyle}
          data-testid="remote-input-key-cursor-right"
          disabled={disabledOnAuthRequired}
          title={disabledOnAuthRequired ? authRequiredHint : undefined}
          onClick={() => tapCursor("right")}
        >
          <ArrowRight style={{ width: iconPx, height: iconPx }} />
        </Button>
      </div>
    </div>
  );
};
