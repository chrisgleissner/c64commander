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
import { Switch } from "@/components/ui/switch";
import { loadSkipRomDependentSongs, saveSkipRomDependentSongs } from "@/lib/config/romDependencySettings";

/** What to do with a song that sounds wrong on this device without the C64's ROMs, when no C64 can play it. */
export const SkipRomDependentSongsRow = () => {
  const [skip, setSkip] = useState(loadSkipRomDependentSongs);
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap min-w-0">
      <div className="min-w-[9rem] flex-1">
        <Label htmlFor="settings-skip-rom-dependent-songs" className="flex min-h-11 items-center font-medium">
          Skip songs that need the C64 ROMs
        </Label>
        <HelperText>
          A few songs sound wrong on this device without the C64&apos;s own ROMs. With no C64 to play them on, they are
          skipped when a playlist or station moves on, and you are asked first when you pick one. Turn off to play them
          anyway; the player then marks them May sound wrong.
        </HelperText>
      </div>
      <Switch
        id="settings-skip-rom-dependent-songs"
        data-testid="settings-skip-rom-dependent-songs"
        checked={skip}
        onCheckedChange={(checked) => {
          const next = checked === true;
          setSkip(next);
          saveSkipRomDependentSongs(next);
        }}
      />
    </div>
  );
};
