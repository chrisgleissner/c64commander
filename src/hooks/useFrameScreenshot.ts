/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, type RefObject } from "react";
import { toast } from "@/hooks/use-toast";
import { addLog } from "@/lib/logging";
import { shareFrameScreenshot } from "@/lib/streams/frameScreenshot";

/** Saves the picture on the canvas, and says so or says why not. */
export const useFrameScreenshot = (canvasRef: RefObject<HTMLCanvasElement | null>) =>
  useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const { filename, outcome } = await shareFrameScreenshot(canvas);
      if (outcome === "downloaded") toast({ title: "Screenshot saved", description: filename, alwaysVisible: true });
    } catch (error) {
      addLog("error", "Live View screenshot failed", {
        error: (error as Error)?.message ?? String(error),
        stack: (error as Error)?.stack,
      });
      toast({ title: "Could not save the screenshot", variant: "destructive" });
    }
  }, [canvasRef]);
