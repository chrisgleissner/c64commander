/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="min-w-0 space-y-2" data-testid="sound-user-presets">
      <div className="flex min-h-11 items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medium">My sounds</h3>
          <p className="text-sm text-muted-foreground">Save this sound by name, up to {MAX_USER_PRESETS}.</p>
        </div>
        {naming ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="-mr-2 min-h-11 shrink-0 gap-1.5 rounded-full px-3 text-sm font-medium"
            disabled={disabled || full}
            onClick={() => open({ kind: "new" })}
            aria-label={full ? undefined : "Save current sound"}
            data-testid="sound-save-preset"
          >
            {full ? (
              "Limit reached"
            ) : (
              <>
                <Plus className="size-4" aria-hidden />
                Save
              </>
            )}
          </Button>
        )}
      </div>
      {record.userPresets.map((preset) => (
        <div key={preset.id} className="flex min-h-11 items-center gap-2" data-testid={`sound-user-${preset.id}`}>
          <span className="min-w-0 flex-1 truncate text-sm">{preset.name}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-11 text-sm text-muted-foreground"
            disabled={disabled}
            onClick={() => open({ kind: "rename", id: preset.id, name: preset.name })}
            data-testid={`sound-user-${preset.id}-rename`}
          >
            Rename
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-11 text-sm text-muted-foreground"
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
      ) : null}
    </div>
  );
};
