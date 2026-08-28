/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState } from "react";
import { Keyboard } from "lucide-react";

import { AnalyticPopup } from "@/components/diagnostics/AnalyticPopup";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { resolveInputProfile } from "@/lib/input";
import {
  KEY_OBSERVATION_LIMIT,
  foldObservation,
  formatObservations,
  observeKey,
  type KeyObservation,
} from "@/lib/diagnostics/keyExplorer";

/**
 * What a key on this device actually emits (spec.md section 9.4).
 *
 * The Commodore key ships unbound, because keymap.ts requires an exact code, key or keyCode and
 * there is no placeholder that later becomes the right value. This is how someone reads the real
 * value off real hardware; binding it is then a single row in profiles/keypad.ts.
 *
 * It installs its own capture listener, active only while the panel is open. It cannot reuse the
 * existing key diagnostics: those emit only when debug logging is on, events on editable targets
 * are deliberately never logged, and an event inside an open overlay returns before diagnostics
 * are emitted — which is exactly where this panel sits.
 */

const KEYPAD_PROFILE_ID = "keypad";

export function KeyExplorerPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [observations, setObservations] = useState<readonly KeyObservation[]>([]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return undefined;
    const keymap = resolveInputProfile(KEYPAD_PROFILE_ID);
    const onKeyDown = (event: KeyboardEvent) => {
      setObservations((current) => foldObservation(current, observeKey(event, keymap)));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const copy = useCallback(() => {
    const text = formatObservations(observations);
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast({ title: "Key list copied" }))
      .catch(() => toast({ title: "Could not copy the key list", description: text }));
  }, [observations]);

  return (
    <AnalyticPopup
      open={open}
      onClose={onClose}
      title="Key Explorer"
      contentClassName="h-auto max-h-[min(72dvh,38rem)]"
      data-testid="key-explorer-popup"
    >
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">
          Press any key on this device. The last {KEY_OBSERVATION_LIMIT} are listed newest first, with what the app
          resolves each one to. Only the key&apos;s identity is recorded — never the character it produced, and never
          anything you have typed.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={copy}
            disabled={observations.length === 0}
            data-testid="key-explorer-copy"
            className="min-h-11"
          >
            Copy as text
          </Button>
          <Button
            variant="ghost"
            onClick={() => setObservations([])}
            disabled={observations.length === 0}
            data-testid="key-explorer-clear"
            className="min-h-11"
          >
            Clear
          </Button>
        </div>

        {observations.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" data-testid="key-explorer-empty">
            <Keyboard className="h-4 w-4 shrink-0" aria-hidden />
            Nothing pressed yet.
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid="key-explorer-list">
            {observations.map((observation) => (
              <li key={`${observation.at}-${observation.code}-${observation.keyCode}`} className="py-2 text-sm">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs">
                  <span>key={observation.key}</span>
                  <span>code={observation.code === "" ? "<empty>" : observation.code}</span>
                  <span>keyCode={observation.keyCode}</span>
                </div>
                <div className="text-xs text-muted-foreground" data-testid="key-explorer-action">
                  {observation.action === null ? "resolves to nothing" : `resolves to ${observation.action}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AnalyticPopup>
  );
}
