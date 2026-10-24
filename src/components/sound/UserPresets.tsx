/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_PRESET_NAME_LENGTH,
  MAX_USER_PRESETS,
  deleteUserPreset,
  renameUserPreset,
  saveUserPreset,
  type AudioProcessingRecord,
} from "@/lib/config/audioProcessingSettings";

type NameTarget = { kind: "new" } | { kind: "rename"; id: string; name: string };

/** Saving the current sound under a name, and renaming and deleting the saved ones. */
export const UserPresets = ({ record, disabled }: { record: AudioProcessingRecord; disabled?: boolean }) => {
  const [naming, setNaming] = useState<NameTarget | null>(null);
  const [name, setName] = useState("");
  const full = record.userPresets.length >= MAX_USER_PRESETS;

  const open = (target: NameTarget) => {
    setNaming(target);
    setName(target.kind === "rename" ? target.name : "");
  };
  const commit = () => {
    if (!naming) return;
    const saved = naming.kind === "new" ? saveUserPreset(name) : renameUserPreset(naming.id, name);
    if (saved) setNaming(null);
  };

  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border/70 p-3" data-testid="sound-user-presets">
      <Label className="text-sm font-medium">My sounds</Label>
      <p className="text-sm text-muted-foreground">
        Save the current sound under a name. Up to {MAX_USER_PRESETS} can be kept.
      </p>
      {record.userPresets.map((preset) => (
        <div key={preset.id} className="flex min-h-11 items-center gap-2" data-testid={`sound-user-${preset.id}`}>
          <span className="min-w-0 flex-1 truncate text-sm">{preset.name}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 text-sm"
            disabled={disabled}
            onClick={() => open({ kind: "rename", id: preset.id, name: preset.name })}
            data-testid={`sound-user-${preset.id}-rename`}
          >
            Rename
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 text-sm"
            disabled={disabled}
            onClick={() => deleteUserPreset(preset.id)}
            data-testid={`sound-user-${preset.id}-delete`}
          >
            Delete
          </Button>
        </div>
      ))}
      {naming ? (
        <div className="space-y-2">
          <Input
            value={name}
            maxLength={MAX_PRESET_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && commit()}
            aria-label="Sound name"
            className="min-h-11 text-base"
            data-testid="sound-preset-name"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11 text-sm"
              disabled={name.trim() === ""}
              onClick={commit}
              data-testid="sound-preset-name-save"
            >
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 text-sm"
              onClick={() => setNaming(null)}
              data-testid="sound-preset-name-cancel"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 w-full text-sm"
          disabled={disabled || full}
          onClick={() => open({ kind: "new" })}
          data-testid="sound-save-preset"
        >
          {full ? "Limit reached" : "Save current sound"}
        </Button>
      )}
    </div>
  );
};
