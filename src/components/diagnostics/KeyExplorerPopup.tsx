/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Keyboard } from "lucide-react";

import { AnalyticPopup } from "@/components/diagnostics/AnalyticPopup";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { addErrorLog } from "@/lib/logging";
import { resolveInputProfile } from "@/lib/input";
import {
  KEY_OBSERVATION_LIMIT,
  foldObservation,
  formatObservations,
  observeKey,
  type KeyObservation,
} from "@/lib/diagnostics/keyExplorer";
import {
  KEYMAP_OVERRIDE_DIRECTORY,
  getKeymapOverrideReport,
  loadKeymapOverrides,
  subscribeKeymapOverrideReport,
} from "@/lib/input/keymapOverrideFiles";

/**
 * What a key on this device actually emits (spec.md section 9.4).
 *
 * The Commodore key ships unbound, because keymap.ts requires an exact code, key or keyCode and
 * there is no placeholder that later becomes the right value. This is how someone reads the real
 * value off real hardware; binding it is then one row in a keymap override file (see
 * docs/keyboard-input.md), which the reload button below applies without a rebuild.
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
    const onKeyDown = (event: KeyboardEvent) => {
      const observation = observeKey(event, resolveInputProfile(KEYPAD_PROFILE_ID));
      setObservations((current) => foldObservation(current, observation));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const overrideReport = useSyncExternalStore(
    subscribeKeymapOverrideReport,
    getKeymapOverrideReport,
    getKeymapOverrideReport,
  );
  const [reloading, setReloading] = useState(false);
  const reloadOverrides = useCallback(() => {
    setReloading(true);
    void loadKeymapOverrides()
      .then((report) =>
        toast({
          title: "Keymap files reloaded",
          description: `${report.applied.length} applied, ${report.skipped.length} skipped.`,
        }),
      )
      .catch((error: unknown) => {
        addErrorLog("Failed to reload keymap files", {
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
        toast({ title: "Could not reload keymap files", description: (error as Error).message });
      })
      .finally(() => setReloading(false));
  }, []);

  const copy = useCallback(() => {
    const text = formatObservations(observations);
    // Optional chaining alone did nothing at all where the API is absent — no copy, no message.
    // The text goes in the toast instead, which is the only way left to get it off the screen.
    if (!navigator.clipboard) {
      toast({ title: "Clipboard not available here", description: text });
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: "Key list copied" }))
      .catch((error: unknown) => {
        addErrorLog("Failed to copy the key list", { error: (error as Error).message });
        toast({ title: "Could not copy the key list", description: text });
      });
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

        <section className="space-y-2 rounded-md border border-border p-3" data-testid="key-explorer-overrides">
          <h3 className="text-sm font-medium">Keymap files</h3>
          <p className="text-sm text-muted-foreground" data-testid="key-explorer-device">
            {overrideReport.identity
              ? `This device: manufacturer "${overrideReport.identity.manufacturer}", model "${overrideReport.identity.model}".`
              : "This device did not report its make and model."}
          </p>
          <p className="text-sm text-muted-foreground">
            JSON files in the app&apos;s <code>{KEYMAP_OVERRIDE_DIRECTORY}/</code> folder add or replace key bindings.
          </p>
          {overrideReport.unavailable ? (
            <p className="text-sm text-muted-foreground" data-testid="key-explorer-overrides-unavailable">
              Not read: {overrideReport.unavailable}.
            </p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="key-explorer-overrides-list">
              {overrideReport.applied.length === 0 && overrideReport.skipped.length === 0 ? (
                <li className="text-muted-foreground">No keymap files found.</li>
              ) : null}
              {overrideReport.applied.map((file) => (
                <li key={`applied-${file}`}>
                  <span className="font-mono">{file}</span> — applied
                </li>
              ))}
              {overrideReport.skipped.map((entry) => (
                <li key={`skipped-${entry.file}`} className="text-muted-foreground">
                  <span className="font-mono">{entry.file}</span> — skipped: {entry.reason}
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="outline"
            onClick={reloadOverrides}
            disabled={reloading}
            data-testid="key-explorer-reload-keymaps"
            className="min-h-11"
          >
            Reload keymap files
          </Button>
        </section>

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
