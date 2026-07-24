/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { saveSidRadioEnabled, saveSidRankingEnabled } from "@/lib/config/appSettings";
import { clearAllRankings } from "@/lib/sidRadio/rankingStore";
import { useSidRadioFlags } from "@/lib/sidRadio/useSidRadioFlags";

type ToggleRowProps = {
  id: string;
  testId: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
};

const ToggleRow = ({ id, testId, label, description, checked, onChange }: ToggleRowProps) => (
  <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 p-3 min-w-0">
    <div className="min-w-0">
      <Label htmlFor={id} className="font-medium">
        {label}
      </Label>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
    <Checkbox id={id} data-testid={testId} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
  </div>
);

/**
 * The "SID Radio" Settings group (spec §6.4): the master + ranking enable
 * toggles and the "Clear my rankings" action. The two-version bundle status
 * line is added in M4.
 */
export const SidRadioSettingsSection = () => {
  const { sidRadioEnabled, sidRankingEnabled } = useSidRadioFlags();
  const [cleared, setCleared] = useState(false);

  const handleClear = async () => {
    await clearAllRankings();
    setCleared(true);
    window.setTimeout(() => setCleared(false), 2000);
  };

  return (
    <div
      className="profile-card bg-card border border-border rounded-xl p-4 space-y-4"
      data-testid="settings-sid-radio"
    >
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Radio className="h-5 w-5 text-primary" />
        </div>
        <h2 className="font-medium">SID Radio</h2>
      </div>

      <div className="space-y-3">
        <ToggleRow
          id="sid-radio-enabled"
          testId="settings-sid-radio-enabled"
          label="Enable SID Radio"
          description="Endless stations of similar SIDs from HVSC and the tunes you like."
          checked={sidRadioEnabled}
          onChange={saveSidRadioEnabled}
        />
        {sidRadioEnabled ? (
          <ToggleRow
            id="sid-ranking-enabled"
            testId="settings-sid-ranking-enabled"
            label="Show ♥ / ✕ ranking"
            description="Rate the current tune while it plays; steers your stations."
            checked={sidRankingEnabled}
            onChange={saveSidRankingEnabled}
          />
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3 min-w-0">
          <div className="min-w-0">
            <Label className="text-sm font-medium">Clear my rankings</Label>
            <p className="text-xs text-muted-foreground">Remove every ♥ / ✕ you have given.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            data-testid="settings-clear-rankings"
            onClick={handleClear}
          >
            {cleared ? "Cleared" : "Clear"}
          </Button>
        </div>
      </div>
    </div>
  );
};
