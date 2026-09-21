/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { HelperText } from "@/components/ui/HelperText";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  APP_SETTINGS_KEYS,
  loadRemoteFunction1Action,
  loadRemoteFunction3Action,
  REMOTE_FUNCTION_ACTIONS,
  restoreRemoteFunctionActionDefaults,
  saveRemoteFunctionActions,
  type RemoteFunctionAction,
} from "@/lib/config/appSettings";
import { REMOTE_FUNCTION_ACTION_LABELS } from "@/lib/input/functionKeyShortcuts";

/** C64U Remote-only assignments for neutral handset F1/F3 events. */
export const RemoteFunctionSettingsSection = () => {
  const [function1Action, setFunction1Action] = useState<RemoteFunctionAction>(loadRemoteFunction1Action);
  const [function3Action, setFunction3Action] = useState<RemoteFunctionAction>(loadRemoteFunction3Action);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (
        detail?.key !== APP_SETTINGS_KEYS.REMOTE_FUNCTION_1_ACTION_KEY &&
        detail?.key !== APP_SETTINGS_KEYS.REMOTE_FUNCTION_3_ACTION_KEY
      ) {
        return;
      }
      setFunction1Action(loadRemoteFunction1Action());
      setFunction3Action(loadRemoteFunction3Action());
      setError(null);
    };
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);

  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="settings-remote-function-actions">
      <div>
        <Label className="text-sm">Remote function keys</Label>
        <HelperText>
          F1 and F3 run these assignments in normal navigation. C64 input surfaces always send literal C64 F1/F3.
        </HelperText>
      </div>
      {([1, 3] as const).map((key) => {
        const current = key === 1 ? function1Action : function3Action;
        const other = key === 1 ? function3Action : function1Action;
        return (
          <div className="space-y-2" key={key}>
            <Label htmlFor={`settings-remote-function-${key}`} className="text-sm">
              F{key} assignment
            </Label>
            <Select
              value={current}
              onValueChange={(raw) => {
                const next = raw as RemoteFunctionAction;
                const next1 = key === 1 ? next : other;
                const next3 = key === 3 ? next : other;
                if (!saveRemoteFunctionActions(next1, next3)) {
                  setError("F1 and F3 cannot use the same assigned action.");
                }
              }}
            >
              <SelectTrigger id={`settings-remote-function-${key}`} data-testid={`settings-remote-function-${key}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REMOTE_FUNCTION_ACTIONS.map((action) => (
                  <SelectItem key={action} value={action} disabled={action !== "unassigned" && action === other}>
                    {REMOTE_FUNCTION_ACTION_LABELS[action]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button
        type="button"
        variant="outline"
        onClick={restoreRemoteFunctionActionDefaults}
      >
        Restore defaults
      </Button>
    </div>
  );
};
