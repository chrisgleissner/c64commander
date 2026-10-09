/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";

import { HelperText } from "@/components/ui/HelperText";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadC64SeekMute, saveC64SeekMute, type C64SeekMute } from "@/lib/config/appSettings";

/** When the C64 is silenced while Previous, Next or the progress bar move it through a SID tune. */
export const C64SeekMuteRow = () => {
  const [mode, setMode] = useState<C64SeekMute>(() => loadC64SeekMute());
  return (
    <div className="space-y-2">
      <Label htmlFor="settings-c64-seek-mute" className="text-sm">
        Mute C64 seeking
      </Label>
      <Select
        value={mode}
        onValueChange={(value) => {
          const next = value as C64SeekMute;
          setMode(next);
          saveC64SeekMute(next);
        }}
      >
        <SelectTrigger id="settings-c64-seek-mute" data-testid="settings-c64-seek-mute">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="always">Always</SelectItem>
          <SelectItem value="rewind">Rewind only</SelectItem>
          <SelectItem value="never">Never</SelectItem>
        </SelectContent>
      </Select>
      <HelperText>
        Silences the C64 while it fast forwards or rewinds a SID tune. Playback on your phone is silent while it seeks,
        whatever this is set to.
      </HelperText>
    </div>
  );
};
